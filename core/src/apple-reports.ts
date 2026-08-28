import { type Cents, parseMoney } from './price.ts';
import { type Takings, OwnerError } from './owner.ts';
import { readMonth } from './books.ts';

/**
 * Reading App Store Connect's own report files, and refusing everything else.
 *
 * ## What this talks to
 *
 * Nothing. There is no network call in this file and there is not going to be
 * one. Sam signs in to App Store Connect, downloads the report, and opens the
 * file -- exactly the way a scan is opened, and for the same reason: a server
 * that holds an API key to the account the business lives in is a thing that
 * can be broken into, and nothing here is worth that.
 *
 * ## WHICH FORMAT THIS IMPLEMENTS, AND HOW FAR IT WAS VERIFIED
 *
 * Two of Apple's Sales and Trends reports, both **version 1_3**, both
 * tab-separated:
 *
 *   * the **Subscriber Report**, for the money -- what customers were charged,
 *     what Apple says it will pay out, and what came back as a refund;
 *   * the **Subscription Event Report**, for the counts -- what started, what
 *     renewed and what was cancelled.
 *
 * Neither report carries both, which is why there are two readers and a
 * function that joins them: `Takings` in `owner.ts` is one month of money *and*
 * one month of counts, and no single file Apple produces has both in it.
 *
 * **The column lists below were transcribed from Apple's own published
 * reference pages for those two reports, read on 2026-08-28:**
 *
 *   developer.apple.com/help/app-store-connect/reference/reporting/subscriber-report/
 *   developer.apple.com/help/app-store-connect/reference/reporting/subscription-event-report/
 *
 * **They have not been checked against a real downloaded file.** There is no
 * App Store Connect export anywhere in this repository or on the machine this
 * was written on, so nobody has held a real header line beside these lists.
 * Four things below are this file's own reading rather than anything Apple
 * states, and each is marked where it appears: that `Customer Price` and
 * `Developer Proceeds` are per unit and are multiplied by `Units`; that the
 * `Refund` column reads `Yes` or `No`; that an empty money field is nought
 * rather than a fault; and what each `Event` value means for a count of starts,
 * renewals and cancellations.
 *
 * ## Which is why every one of them is a refusal rather than an assumption
 *
 * The header must match a declared layout **exactly, column for column, in
 * order**. A value in the `Refund` column that is not one of the two known ones
 * stops the file. An `Event` name that is not in the table stops the file. A
 * date that is not in a shape this can read stops the file. A row with the
 * wrong number of fields stops the file. A currency that is not the one being
 * summed stops the file.
 *
 * That is the whole design. A guessed layout that parses is a wrong number on
 * the screen Sam runs a business off, and a wrong number that arrived quietly
 * is worse than no screen at all. A guessed layout that **refuses** is twenty
 * minutes of correcting a list of column names against a real file -- and the
 * refusal prints the header it actually saw, so the correction is mechanical.
 *
 * When Apple moves to 1_4, this stops. That is the intended behaviour and it is
 * why the version is in the constant's name: the alternative is a parser that
 * carries on reading a file whose columns have shifted by one and produces a
 * total nobody can tell is wrong.
 */

/* --------------------------------------------------------- the layouts */

/**
 * The Subscriber Report, version 1_3, in order.
 *
 * Transcribed from Apple's published reference page, not from a file. See the
 * paragraph above before trusting it.
 */
export const SUBSCRIBER_REPORT_1_3: readonly string[] = [
  'Event Date',
  'App Name',
  'App Apple ID',
  'Subscription Name',
  'Subscription Apple ID',
  'Subscription Group ID',
  'Standard Subscription Duration',
  'Subscription Offer Name',
  'Promotional Offer ID',
  'Subscription Offer Type',
  'Subscription Offer Duration',
  'Marketing Opt-In Duration',
  'Customer Price',
  'Customer Currency',
  'Developer Proceeds',
  'Proceeds Currency',
  'Preserved Pricing',
  'Proceeds Reason',
  'Client',
  'Device',
  'Country',
  'Subscriber ID',
  'Subscriber ID Reset',
  'Refund',
  'Purchase Date',
  'Units',
];

/**
 * The Subscription Event Report, version 1_3, in order.
 *
 * Transcribed from Apple's published reference page, not from a file.
 */
export const SUBSCRIPTION_EVENT_REPORT_1_3: readonly string[] = [
  'Event Date',
  'Event',
  'App Name',
  'App Apple ID',
  'Subscription Name',
  'Subscription Apple ID',
  'Subscription Group ID',
  'Standard Subscription Duration',
  'Subscription Offer Type',
  'Subscription Offer Duration',
  'Marketing Opt-In',
  'Marketing Opt-In Duration',
  'Preserved Pricing',
  'Proceeds Reason',
  'Subscription Offer Name',
  'Promotional Offer ID',
  'Consecutive Paid Periods',
  'Original Start Date',
  'Device',
  'Client',
  'State',
  'Country',
  'Previous Subscription Name',
  'Previous Subscription Apple ID',
  'Days Before Canceling',
  'Cancellation Reason',
  'Days Canceled',
  'Quantity',
  'Paid Service Days Recovered',
];

/**
 * What each event in the Subscription Event Report counts as.
 *
 * **This mapping is this file's own reading, not something Apple states.** Each
 * line below is a judgement, and the ones that could reasonably have gone the
 * other way say why:
 *
 *   * an upgrade, a downgrade and a crossgrade are `none`, because the same
 *     person is still subscribed on the other side of one. Counting them as a
 *     cancellation and a start would show one man moving from monthly to yearly
 *     as a customer lost and a customer won, on the same day;
 *   * a refund is `none`, because it is money rather than a count, and the
 *     money side of it comes out of the Subscriber Report. Counting it here as
 *     well would take the same event off the books twice;
 *   * a billing retry is `none` -- nothing has happened yet -- while the two
 *     outcomes of one are counted for what they turned out to be.
 *
 * An event name that is not in this table is a refusal, not a zero. That is the
 * safety net under the whole list: if any of these names is wrong, or Apple
 * adds one, the file stops rather than quietly counting a month short.
 */
const EVENT_MEANS: Readonly<Record<string, 'started' | 'renewed' | 'cancelled' | 'none'>> = {
  'Start Introductory Price': 'started',
  'Start Promotional Offer': 'started',
  Reactivate: 'started',
  'Reactivation to Promotional Offer': 'started',
  Renew: 'renewed',
  'Paid Subscription from Introductory Price': 'renewed',
  'Renewal from Billing Retry': 'renewed',
  Cancel: 'cancelled',
  'Canceled from Billing Retry': 'cancelled',
  Refund: 'none',
  Upgrade: 'none',
  Downgrade: 'none',
  Crossgrade: 'none',
  'Billing Retry from Paid Subscription': 'none',
};

/**
 * What the `Refund` column of the Subscriber Report reads.
 *
 * **This file's own reading.** Apple's reference page names the column and this
 * has never been held beside a real file, so anything that is not one of these
 * three stops the report rather than being taken as "not a refund" -- which is
 * the reading that would quietly lose every refund in the month.
 */
const REFUND_MEANS: Readonly<Record<string, boolean>> = {
  '': false,
  No: false,
  Yes: true,
};

/* ---------------------------------------------------------- the reading */

/** One month of money, out of the Subscriber Report. */
export interface MonthMoney {
  readonly month: string;
  readonly charged: Cents;
  readonly proceeds: Cents;
  readonly refunded: Cents;
}

/** One month of counts, out of the Subscription Event Report. */
export interface MonthCounts {
  readonly month: string;
  readonly started: number;
  readonly cancelled: number;
  readonly renewed: number;
}

interface Row {
  readonly at: number;
  readonly field: (name: string) => string;
}

/**
 * The header, checked column for column, and the rows behind it.
 *
 * Exact and ordered, deliberately. A layout check that only looked for the
 * columns it needed would go on working when Apple inserted a column in the
 * middle -- which is the case that matters, because that is the one where every
 * field still parses and every number is read out of the wrong place.
 */
function rowsOf(text: string, layout: readonly string[], report: string): readonly Row[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    throw new OwnerError(`That file is empty. It is not ${report}.`);
  }
  const header = (lines[0] as string).split('\t');
  if (header.length === 1 && (lines[0] as string).includes(',')) {
    throw new OwnerError(
      `${report} is tab-separated and that file is not - the first line has commas in it and no ` +
        'tabs at all. Download the report itself rather than something a spreadsheet saved.'
    );
  }
  if (header.join('\t') !== layout.join('\t')) {
    const wrongAt = layout.findIndex((name, i) => header[i] !== name);
    const said =
      wrongAt === -1
        ? `it has ${header.length} columns where ${report} has ${layout.length}`
        : `column ${wrongAt + 1} is "${header[wrongAt] ?? 'missing'}" where ${report} has ` +
          `"${layout[wrongAt]}"`;
    throw new OwnerError(
      `That file is not ${report}, or Apple has changed it: ${said}. Nothing has been read in. ` +
        'This refuses rather than reading the columns it recognises, because a report whose ' +
        'columns have shifted by one still parses and produces a total nobody can tell is ' +
        `wrong. The header it actually has: ${header.join(' | ')}`
    );
  }
  const where = new Map(layout.map((name, i) => [name, i]));
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = (lines[i] as string).split('\t');
    if (cells.length !== layout.length) {
      throw new OwnerError(
        `Line ${i + 1} of ${report} has ${cells.length} fields where the header has ` +
          `${layout.length}. Nothing has been read in.`
      );
    }
    rows.push({
      at: i + 1,
      field: (name: string) => cells[where.get(name) as number] as string,
    });
  }
  return rows;
}

/**
 * The month a row belongs to, `YYYY-MM`.
 *
 * Two shapes are read, `2026-07-02` and `07/02/2026`, and nothing else. The
 * slashed one is the ambiguous one: `03/04/2026` is March in Apple's format and
 * April in half the world's, and the month is the entire thing this function
 * exists to produce. So a slashed date whose first field is over twelve -- a
 * date that cannot be month-first -- stops the whole file rather than being
 * read the other way round, and one file of real dates almost always contains
 * such a day.
 */
function monthOf(date: string, report: string, at: number): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date.trim());
  if (slashed) {
    const first = Number(slashed[1]);
    if (first > 12) {
      throw new OwnerError(
        `Line ${at} of ${report} has the date ${date}, whose first field is ${first}. Apple ` +
          'writes these month first, so that file is written day first and every month in it ' +
          'would be read wrong. Nothing has been read in.'
      );
    }
    return `${slashed[3]}-${String(first).padStart(2, '0')}`;
  }
  throw new OwnerError(
    `Line ${at} of ${report} has the date "${date}", which is neither 2026-07-02 nor 07/02/2026. ` +
      'Nothing has been read in.'
  );
}

function wholeNumber(text: string, what: string, report: string, at: number): number {
  // An empty field is refused rather than read as nought, which is what
  // `Number('')` would quietly make of it. A month whose every quantity was
  // blank would otherwise come back as a month in which nothing happened.
  const n = text.trim() === '' ? Number.NaN : Number(text.trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new OwnerError(
      `Line ${at} of ${report} has "${text}" under ${what}, which is not a whole number of ` +
        'them. Nothing has been read in.'
    );
  }
  return n;
}

/**
 * A money column, as exact cents.
 *
 * An empty field is nought. **That is this file's own reading**, and the one
 * assumption here that is not a refusal: a row for something given away has
 * nothing under `Customer Price`, and refusing the file over it would make the
 * parser useless on the first month with a free trial in it. Anything else that
 * is not an exact amount of money -- a third of a cent included -- still stops
 * the file rather than being rounded.
 */
function cents(text: string, what: string, report: string, at: number): Cents {
  try {
    return parseMoney(text.trim() === '' ? '0' : text);
  } catch {
    throw new OwnerError(
      `Line ${at} of ${report} has "${text}" under ${what}, which is not an amount of money ` +
        'this can hold exactly. Nothing has been read in.'
    );
  }
}

/**
 * The money, month by month, out of the Subscriber Report.
 *
 * ## The currency
 *
 * `currency` is the one being summed, and every row has to be in it -- both the
 * price the customer paid and the proceeds Apple will pay out. A report
 * covering several storefronts has several customer currencies in it, and
 * adding a euro to a dollar produces a number that is not money at all. So it
 * refuses and names the row, and Sam sums one currency at a time. There is no
 * exchange rate here and there is not going to be one: a rate is a number from
 * somewhere else, on a day nobody recorded.
 *
 * ## Units, and what is this file's own reading
 *
 * `Customer Price` and `Developer Proceeds` are multiplied by `Units`. That is
 * a reading of Apple's columns, not something its reference page states in
 * those words -- and it is the single most likely thing in this file to be
 * wrong against a real report. It is called out here, in the test, and in the
 * note at the top for exactly that reason.
 *
 * A row marked as a refund adds to `refunded` and to neither of the other two.
 * A refund is money going back, and folding it into what was charged would show
 * a month that was handed back in full as a month that took money.
 */
export function readMoneyReport(text: string, currency: string): readonly MonthMoney[] {
  const report = 'the Subscriber Report (version 1_3)';
  const wanted = currency.trim().toUpperCase();
  if (wanted === '') {
    throw new OwnerError('Say which currency is being summed. There is no default and there should not be.');
  }
  const months = new Map<string, { charged: Cents; proceeds: Cents; refunded: Cents }>();
  for (const row of rowsOf(text, SUBSCRIBER_REPORT_1_3, report)) {
    for (const column of ['Customer Currency', 'Proceeds Currency']) {
      const said = row.field(column).trim().toUpperCase();
      if (said !== wanted) {
        throw new OwnerError(
          `Line ${row.at} of ${report} is in ${said || 'no currency at all'} under ${column}, ` +
            `and ${wanted} is what is being summed. Adding one to the other would produce a ` +
            'number that is not money. Nothing has been read in - sum one currency at a time.'
        );
      }
    }
    const refundSaid = row.field('Refund').trim();
    const refunded = REFUND_MEANS[refundSaid];
    if (refunded === undefined) {
      throw new OwnerError(
        `Line ${row.at} of ${report} says "${refundSaid}" under Refund, and this only knows ` +
          '"Yes", "No" and an empty field. Reading it as "not a refund" would quietly lose the ' +
          'refund. Nothing has been read in.'
      );
    }
    const units = wholeNumber(row.field('Units'), 'Units', report, row.at);
    const each = cents(row.field('Customer Price'), 'Customer Price', report, row.at);
    const mine = cents(row.field('Developer Proceeds'), 'Developer Proceeds', report, row.at);
    const month = monthOf(row.field('Event Date'), report, row.at);
    const sum = months.get(month) ?? { charged: 0n, proceeds: 0n, refunded: 0n };
    months.set(
      month,
      refunded
        ? { ...sum, refunded: sum.refunded + each * BigInt(units) }
        : {
            ...sum,
            charged: sum.charged + each * BigInt(units),
            proceeds: sum.proceeds + mine * BigInt(units),
          }
    );
  }
  return [...months.entries()]
    .map(([month, sum]) => ({ month, ...sum }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * The counts, month by month, out of the Subscription Event Report.
 *
 * `Quantity` is how many subscriptions the row stands for, so it is added
 * rather than counting the row as one. An event this does not have a meaning
 * for stops the file: see `EVENT_MEANS`.
 */
export function readEventReport(text: string): readonly MonthCounts[] {
  const report = 'the Subscription Event Report (version 1_3)';
  const months = new Map<string, { started: number; cancelled: number; renewed: number }>();
  for (const row of rowsOf(text, SUBSCRIPTION_EVENT_REPORT_1_3, report)) {
    const event = row.field('Event').trim();
    const means = EVENT_MEANS[event];
    if (means === undefined) {
      throw new OwnerError(
        `Line ${row.at} of ${report} has the event "${event}", which this does not have a ` +
          'meaning for. Ignoring it would leave a month short by however many of them there ' +
          'are. Nothing has been read in.'
      );
    }
    const quantity = wholeNumber(row.field('Quantity'), 'Quantity', report, row.at);
    const month = monthOf(row.field('Event Date'), report, row.at);
    const sum = months.get(month) ?? { started: 0, cancelled: 0, renewed: 0 };
    months.set(month, means === 'none' ? sum : { ...sum, [means]: sum[means] + quantity });
  }
  return [...months.entries()]
    .map(([month, sum]) => ({ month, ...sum }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * The two reports, joined into the month lines the dashboard reads.
 *
 * ## Why the two files have to cover the same months
 *
 * Because outside the months both cover, a zero is a guess. A month with events
 * and no money genuinely did take nothing -- but only if the money report
 * covered that month at all; if it did not, the zero means "not reported" and
 * there is nothing on a screen that could tell those two apart. So the first
 * and last month of each file must match, and they are refused when they do
 * not, naming both spans.
 *
 * Inside that span a month missing from one file is a real zero and is written
 * down as one. A month missing from **both** is not written down at all: for
 * that month "nothing happened" and "nobody reported" look identical, and this
 * does not guess between them.
 */
export function takingsFrom(
  money: readonly MonthMoney[],
  counts: readonly MonthCounts[],
  from: string
): readonly Takings[] {
  if (money.length === 0 && counts.length === 0) {
    throw new OwnerError('Neither report had a single row in it, so there is nothing to write down.');
  }
  const span = (lines: readonly { month: string }[]) =>
    lines.length === 0 ? 'nothing' : `${lines[0]?.month} to ${lines[lines.length - 1]?.month}`;
  const moneySpan = span(money);
  const countsSpan = span(counts);
  if (moneySpan !== countsSpan) {
    throw new OwnerError(
      `The two reports cover different months - the money runs ${moneySpan} and the events run ` +
        `${countsSpan}. Outside the months both of them cover, a zero would be a guess rather ` +
        'than a figure. Download both for the same span.'
    );
  }
  const byMonth = new Map<string, Takings>();
  for (const line of money) {
    byMonth.set(line.month, {
      month: line.month,
      charged: line.charged,
      proceeds: line.proceeds,
      refunded: line.refunded,
      started: 0,
      cancelled: 0,
      renewed: 0,
      from,
    });
  }
  for (const line of counts) {
    const already = byMonth.get(line.month);
    byMonth.set(line.month, {
      month: line.month,
      charged: already?.charged ?? 0n,
      proceeds: already?.proceeds ?? 0n,
      refunded: already?.refunded ?? 0n,
      started: line.started,
      cancelled: line.cancelled,
      renewed: line.renewed,
      from,
    });
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Add months to the ones already read in, and refuse to read one twice.
 *
 * The failure this is for is dropping the same download on the screen twice --
 * which is not a strange thing to do, because Apple's file names are long and
 * two months of them look alike. Every figure on the dashboard would go up, all
 * of it would still add up, and the only sign would be a month that felt good.
 * So a month already in the books stops it, and names the month and the file it
 * came from the first time.
 */
export function foldIn(
  existing: readonly Takings[],
  added: readonly Takings[]
): readonly Takings[] {
  const have = new Map(existing.map((line) => [line.month, line]));
  for (const line of added) {
    const already = have.get(line.month);
    if (already) {
      throw new OwnerError(
        `${readMonth(line.month)} has already been read in, from ${already.from}. Reading it ` +
          'twice would double that month and every total on this screen would still add up. ' +
          'Nothing has been read in.'
      );
    }
    have.set(line.month, line);
  }
  return [...have.values()].sort((a, b) => a.month.localeCompare(b.month));
}
