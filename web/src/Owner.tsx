import { useEffect, useMemo, useState } from 'react';
import { money } from '../../core/src/price.ts';
import {
  type Books,
  type Contact,
  type Tester,
  type TesterStage,
  NO_BOOKS,
} from '../../core/src/owner.ts';
import {
  describeBooks,
  describeGrant,
  gatherTroubles,
  giveBatch,
  giveGrant,
  markRedeemed,
  pullGrant,
  readMonth,
  readTakings,
  runsOut,
  whereTheyGotTo,
} from '../../core/src/books.ts';
import {
  foldIn,
  readEventReport,
  readMoneyReport,
  takingsFrom,
} from '../../core/src/apple-reports.ts';

/**
 * The owner's screen. Sam's, and nobody else's.
 *
 * > "im going to need a dashboard to manage members and be able to give free
 * >  months of the subsription and for how long. and for other back end needs."
 *
 * Asked what else it should carry he said all four: the money, what comes back
 * off people's phones when something breaks, who is on TestFlight and who has
 * actually installed it, and a record per contractor of what they got in touch
 * about. Asked how the free months should work he said both: batches for
 * marketing, named ones for people he knows.
 *
 * ## The line this screen does not cross
 *
 * **A contractor's work never appears here.** Not a room, not a measurement,
 * not a client's name, not a photograph, not a price he quoted. Everything on
 * this page is one of exactly two things: something out of a report Apple
 * produced, or something Sam typed. There is no network call in this file, and
 * the report is a file he downloads from App Store Connect and opens the way a
 * scan is opened.
 *
 * ## And the one it says out loud
 *
 * Apple reports that a code was redeemed. It does not report **who** redeemed
 * it. So every grant on this screen carries two chips of different colours: the
 * green one is Apple's report and the violet one is Sam's own note about who he
 * handed it to. It is the app's existing vocabulary -- green is a checked fact
 * everywhere else in it, violet is somebody's own hand -- pointed at the one
 * distinction this screen exists to keep. The sentence under each grant is
 * written by `describeGrant` in the model rather than here, so the screen and
 * anything else that ever reads these books cannot word the same fact two
 * different ways.
 *
 * A grant Apple has not reported redeemed is **not** an unused one. Apple's
 * reports lag by days. The screen says that in words rather than leaving a
 * blank to be read as an answer.
 *
 * ## How it is guarded, and exactly what that does not stop
 *
 * Three things, and only the first of them is a wall.
 *
 * **1. There is nothing here to take.** No server holds these books; they are
 * in this browser's own storage on this device. A stranger who reaches this
 * screen on his own phone gets an empty one, because his phone has never had a
 * report read into it. That is the only guarantee on this page that does not
 * depend on a secret, and it is the reason the whole design has no back end.
 *
 * **2. A phrase.** The books do not draw until one is typed. What is stored is
 * a SHA-256 digest of a random salt and the phrase, never the phrase, and the
 * unlock is not remembered -- closing the page locks it again. This is what
 * stops somebody picking the phone up off a table.
 *
 * **3. No door on anybody else's app.** `ownerLockIsSet` is false on a device
 * that has never had a phrase set, and the app draws no control that leads here
 * on such a device. On a contractor's phone there is nothing in the chrome that
 * points at this screen at all.
 *
 * **What none of that stops, stated plainly.** The check runs in the browser.
 * Anybody can read the shipped bundle, find the fragment, and load this page;
 * anybody with the developer tools open can set the flag that draws it. Neither
 * gets them a single figure -- the books are not in the bundle and not on a
 * server -- but both get them the *screen*. And on the device where the books
 * do live, anyone who can open the developer tools can read them straight out
 * of storage without going near the phrase. The lock is against a person
 * holding the phone, not against the person who owns it. A gate that actually
 * withstood the second case needs a server, an account and a session, and this
 * product deliberately has none of those.
 */

/* ----------------------------------------------------------------- the lock */

const LOCK = 'trueline.owner.lock';
const BOOKS = 'trueline.owner.books';

/** The shortest phrase this will accept. Short enough to type, long enough to matter. */
const SHORTEST_PHRASE = 8;

interface Lock {
  readonly salt: string;
  readonly digest: string;
}

function storedLock(): Lock | null {
  try {
    const text = window.localStorage.getItem(LOCK);
    if (!text) return null;
    const said = JSON.parse(text) as Partial<Lock>;
    return typeof said.salt === 'string' && typeof said.digest === 'string'
      ? { salt: said.salt, digest: said.digest }
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether this device has ever had the owner's phrase set on it.
 *
 * The app reads this to decide whether to draw a door to this screen in its own
 * chrome. False on every phone but Sam's, which is the point: a control that
 * leads somewhere a contractor cannot go is a control that invites him to try.
 */
export function ownerLockIsSet(): boolean {
  return storedLock() !== null;
}

/**
 * The phrase, as a digest, or nothing at all.
 *
 * `crypto.subtle` is only there in a secure context. Where it is missing this
 * returns null and the screen **refuses to unlock** and says why, rather than
 * falling back to comparing the phrase itself -- a lock that keeps the thing it
 * is locking in plain sight is not a lock, and one that quietly stops being a
 * lock is worse than none.
 */
async function digestOf(salt: string, phrase: string): Promise<string | null> {
  const engine = globalThis.crypto?.subtle;
  if (!engine) return null;
  const bytes = new TextEncoder().encode(`${salt}:${phrase}`);
  const out = await engine.digest('SHA-256', bytes);
  return [...new Uint8Array(out)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function freshSalt(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------------------------------------------------------- the books */

/**
 * The books, in this browser's storage, with the cents kept exact.
 *
 * `JSON.stringify` throws on a `bigint` rather than writing one, which is the
 * right behaviour and means every amount has to be written as a string and read
 * back with `BigInt`. Never through `Number`: a subscription business that runs
 * for long enough puts more than nine quadrillion cents through this, and long
 * before that a float would have started rounding somebody's month.
 */
function readBooks(): Books {
  try {
    const text = window.localStorage.getItem(BOOKS);
    if (!text) return NO_BOOKS;
    const said = JSON.parse(text) as Books;
    return {
      ...NO_BOOKS,
      ...said,
      takings: (said.takings ?? []).map((line) => ({
        ...line,
        charged: BigInt(line.charged as unknown as string),
        proceeds: BigInt(line.proceeds as unknown as string),
        refunded: BigInt(line.refunded as unknown as string),
      })),
    };
  } catch {
    return NO_BOOKS;
  }
}

function writeBooks(books: Books): void {
  try {
    window.localStorage.setItem(
      BOOKS,
      JSON.stringify(books, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
    );
  } catch {
    // A browser with storage turned off. The books stay in this page for as
    // long as it is open and say so under the heading; there is nowhere else
    // for them to go, because there is no server.
  }
}

/* --------------------------------------------------------------- the pieces */

function Card({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className="font-mono text-lead font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  wide = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly placeholder?: string;
  readonly wide?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={`mt-1 min-h-11 rounded-md border border-slate-300 px-3 py-2
                    focus:border-sky-500 focus:outline-none ${wide ? 'w-full' : 'w-28'}`}
      />
    </label>
  );
}

function Said({ trouble }: { readonly trouble: string | null }) {
  if (!trouble) return null;
  return (
    <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm leading-relaxed text-red-700">
      {trouble}
    </p>
  );
}

/** Apple's own report says this. */
function ApplesFact({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-sm bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
      {children}
    </span>
  );
}

/** Sam typed this. */
function YourNote({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-sm bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-800">
      {children}
    </span>
  );
}

/* ==================================================================== screen */

export function Owner() {
  const [lock, setLock] = useState<Lock | null>(() => storedLock());
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const [books, setBooks] = useState<Books>(NO_BOOKS);

  // The books are read only once the phrase has been accepted, so a locked page
  // never has them in memory at all.
  useEffect(() => {
    if (open) setBooks(readBooks());
  }, [open]);

  function keep(next: Books) {
    setBooks(next);
    writeBooks(next);
  }

  async function setThePhrase() {
    if (phrase.trim().length < SHORTEST_PHRASE) {
      setRefused(
        `That phrase is ${phrase.trim().length} characters. It wants at least ${SHORTEST_PHRASE} — ` +
          'this is the only thing between the books and whoever picks the phone up.'
      );
      return;
    }
    const salt = freshSalt();
    const digest = await digestOf(salt, phrase.trim());
    if (!digest) {
      setRefused(NO_CRYPTO);
      return;
    }
    const made = { salt, digest };
    window.localStorage.setItem(LOCK, JSON.stringify(made));
    setLock(made);
    setPhrase('');
    setRefused(null);
    setOpen(true);
  }

  async function openTheBooks() {
    if (!lock) return;
    const digest = await digestOf(lock.salt, phrase.trim());
    if (!digest) {
      setRefused(NO_CRYPTO);
      return;
    }
    if (digest !== lock.digest) {
      setRefused('That is not the phrase. Nothing about the books has been shown.');
      return;
    }
    setPhrase('');
    setRefused(null);
    setOpen(true);
  }

  if (!open) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">The books</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {lock
            ? 'Type the phrase. Nothing is drawn until it matches, and closing this page locks it again.'
            : 'Nothing has been locked on this device yet. Set a phrase and the books open behind it.'}
        </p>
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-700">The phrase</span>
            <input
              type="password"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              aria-label="The phrase"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2
                         focus:border-sky-500 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => void (lock ? openTheBooks() : setThePhrase())}
            className="mt-3 min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                       active:bg-slate-700"
          >
            {lock ? 'Open the books' : 'Lock it to a phrase'}
          </button>
          <Said trouble={refused} />
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            What is kept is a digest of the phrase and a random salt, never the phrase. It stops
            somebody picking this phone up. It does not stop anybody who can open the developer
            tools on the device the books are actually on — there is no server here to ask, which
            is the same reason no contractor's work is on this screen either.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">The books</h1>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setBooks(NO_BOOKS);
          }}
          aria-label="Lock the books"
          className="inline-flex min-h-11 items-center text-sm text-slate-500 underline underline-offset-4"
        >
          Lock it
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Apple's own reports and your own notes. Nothing on this page came off anybody's job: no
        room, no measurement, no client, no price anybody quoted. Those stay on the phone they were
        made on.
      </p>

      <div className="mt-5 space-y-5">
        <WholePicture books={books} />
        <ApplesReports books={books} onKeep={keep} />
        <FreeMonths books={books} onKeep={keep} />
        <TestFlight books={books} onKeep={keep} />
        <WhatBroke books={books} onKeep={keep} />
        <InTouch books={books} onKeep={keep} />
      </div>
    </main>
  );
}

const NO_CRYPTO =
  'This browser will not do the hashing this needs, so the phrase cannot be checked and the ' +
  'books stay shut. That is deliberate: comparing the phrase itself would mean keeping it in ' +
  'plain sight, and a lock that quietly stops being one is worse than none. Open this page over ' +
  'https, or on localhost.';

/* ------------------------------------------------------------ what it says */

function WholePicture({ books }: { readonly books: Books }) {
  // Read once for the whole render, so nothing on this page can show two
  // different todays if it is left open over midnight.
  const now = new Date().toISOString();
  const sum = useMemo(() => readTakings(books.takings), [books.takings]);

  return (
    <Card title="The whole picture">
      <p className="mt-1 text-sm leading-relaxed text-slate-700">{describeBooks(books, now)}</p>

      {/* No report read in means no figures, not eight noughts.
          $0.00 across four boxes is a month in which nothing was taken, and a
          month in which nothing was taken is a different thing from a month
          nobody has downloaded yet. The two would look identical, and the one
          Sam would act on is the one that is not true. `describeBooks` already
          refuses to print a nought here; the grid has to refuse as well or the
          sentence and the boxes disagree. */}
      {sum.months === 0 ? (
        <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
          There are no figures yet, rather than figures of nought. Read Apple's two reports in
          below and every one of them appears here.
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            <Figure label="Charged" value={money(sum.charged)} />
            <Figure label="To be paid out" value={money(sum.proceeds)} />
            <Figure label="Apple and tax" value={money(sum.appleAndTax)} />
            <Figure label="Refunded" value={money(sum.refunded)} />
            <Figure label="Started" value={String(sum.started)} />
            <Figure label="Renewed" value={String(sum.renewed)} />
            <Figure label="Cancelled" value={String(sum.cancelled)} />
            <Figure label="Months reported" value={String(sum.months)} />
          </dl>

          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Every figure is summed from months Apple has reported, in exact cents. Nothing here is
            a year, an average or a forecast, because no report says one.
          </p>
        </>
      )}
    </Card>
  );
}

/* -------------------------------------------------------- Apple's reports */

function ApplesReports({
  books,
  onKeep,
}: {
  readonly books: Books;
  readonly onKeep: (books: Books) => void;
}) {
  const [currency, setCurrency] = useState('USD');
  const [moneyText, setMoneyText] = useState<{ name: string; text: string } | null>(null);
  const [eventText, setEventText] = useState<{ name: string; text: string } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  function readThemIn() {
    setSaid(null);
    try {
      if (!moneyText || !eventText) {
        throw new Error(
          'Both files are needed. Neither of Apple’s reports carries the money and the ' +
            'counts on its own, so one of them alone would leave half of every month blank.'
        );
      }
      const from = `${moneyText.name} and ${eventText.name}`;
      const lines = takingsFrom(
        readMoneyReport(moneyText.text, currency),
        readEventReport(eventText.text),
        from
      );
      onKeep({ ...books, takings: [...foldIn(books.takings, lines)] });
      setRefused(null);
      setSaid(
        `${lines.length} month${lines.length === 1 ? '' : 's'} read in from ${from}: ` +
          lines.map((line) => readMonth(line.month)).join(', ') + '.'
      );
    } catch (error) {
      setRefused(error instanceof Error ? error.message : String(error));
    }
  }

  async function take(
    file: File | undefined,
    put: (said: { name: string; text: string } | null) => void
  ) {
    if (!file) {
      put(null);
      return;
    }
    put({ name: file.name, text: await file.text() });
    setRefused(null);
    setSaid(null);
  }

  return (
    <Card title="What Apple has reported">
      <p className="mt-1 text-sm leading-relaxed text-slate-700">
        Download both reports out of App Store Connect and open them here. Nothing on this page
        talks to Apple — there is no key to your account anywhere in this app, and there is not
        going to be one.
      </p>

      <div className="mt-3 grid gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">The Subscriber Report</span>
          <input
            type="file"
            accept=".txt,.tsv,text/plain,text/tab-separated-values"
            aria-label="The Subscriber Report"
            onChange={(event) => void take(event.target.files?.[0], setMoneyText)}
            className="mt-1 block w-full text-sm text-slate-700"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">The Subscription Event Report</span>
          <input
            type="file"
            accept=".txt,.tsv,text/plain,text/tab-separated-values"
            aria-label="The Subscription Event Report"
            onChange={(event) => void take(event.target.files?.[0], setEventText)}
            className="mt-1 block w-full text-sm text-slate-700"
          />
        </label>
        <Field
          label="The currency being summed"
          value={currency}
          onChange={setCurrency}
          placeholder="USD"
        />
        <button
          type="button"
          onClick={readThemIn}
          className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
        >
          Read them in
        </button>
      </div>

      <Said trouble={refused} />
      {said && (
        <p role="status" className="mt-3 text-sm font-medium text-slate-700">
          {said}
        </p>
      )}

      {books.takings.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
          {books.takings.map((line) => (
            <li key={line.month} className="py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium text-slate-900">{readMonth(line.month)}</span>
                <span className="font-mono text-sm tabular-nums text-slate-700">
                  {money(line.charged)} charged · {money(line.proceeds)} out
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {line.started} started · {line.renewed} renewed · {line.cancelled} cancelled ·{' '}
                {money(line.refunded)} refunded · from {line.from}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        A report whose columns are not the ones this was written against is refused rather than
        read, and it prints the header it found. A month already read in is refused too — the same
        download twice would double it and every total would still add up.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------ free months */

function FreeMonths({
  books,
  onKeep,
}: {
  readonly books: Books;
  readonly onKeep: (books: Books) => void;
}) {
  const now = new Date().toISOString();
  const [who, setWho] = useState('');
  const [code, setCode] = useState('');
  const [months, setMonths] = useState('3');
  const [batch, setBatch] = useState('');
  const [codes, setCodes] = useState('');
  const [batchMonths, setBatchMonths] = useState('1');
  const [why, setWhy] = useState<Record<string, string>>({});
  const [redeemed, setRedeemed] = useState<Record<string, string>>({});
  const [refused, setRefused] = useState<string | null>(null);

  function tryIt(what: () => Books) {
    try {
      onKeep(what());
      setRefused(null);
      return true;
    } catch (error) {
      setRefused(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  return (
    <Card title="Free months">
      <p className="mt-1 text-sm leading-relaxed text-slate-700">
        Green is what Apple's own report says. Violet is your note. They are never shown as the
        same kind of thing, because Apple reports that a code was redeemed and never who redeemed
        it.
      </p>

      <div className="mt-4 rounded-md bg-slate-50 p-3">
        <h3 className="text-sm font-medium text-slate-700">One for somebody you know</h3>
        <div className="mt-2 grid gap-2">
          <Field label="Who it went to" value={who} onChange={setWho} placeholder="Gilbert Ruiz" wide />
          <Field label="The offer code" value={code} onChange={setCode} placeholder="GILBERT3" wide />
          <Field label="How many months" value={months} onChange={setMonths} placeholder="3" />
          <button
            type="button"
            onClick={() => {
              if (
                tryIt(() =>
                  giveGrant(
                    books,
                    { code, how: 'named', given: who, months: Number(months) },
                    new Date().toISOString()
                  )
                )
              ) {
                setWho('');
                setCode('');
              }
            }}
            className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
          >
            Give a named one
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-md bg-slate-50 p-3">
        <h3 className="text-sm font-medium text-slate-700">A batch, for a push</h3>
        <div className="mt-2 grid gap-2">
          <Field label="What the batch is called" value={batch} onChange={setBatch} placeholder="trade night" wide />
          <label className="block">
            <span className="text-xs font-medium text-slate-700">The codes, one to a line</span>
            <textarea
              value={codes}
              onChange={(event) => setCodes(event.target.value)}
              rows={3}
              aria-label="The codes, one to a line"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm
                         focus:border-sky-500 focus:outline-none"
            />
          </label>
          <Field
            label="How many months in the batch"
            value={batchMonths}
            onChange={setBatchMonths}
            placeholder="1"
          />
          <button
            type="button"
            onClick={() => {
              if (
                tryIt(() =>
                  giveBatch(
                    books,
                    batch,
                    codes.split('\n').map((one) => one.trim()).filter((one) => one !== ''),
                    Number(batchMonths),
                    new Date().toISOString()
                  )
                )
              ) {
                setCodes('');
              }
            }}
            className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
          >
            Give a batch
          </button>
        </div>
      </div>

      <Said trouble={refused} />

      {books.grants.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">Nothing has been given away yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
          {books.grants.map((grant) => {
            const ends = runsOut(grant, now);
            return (
              <li key={grant.code} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  {grant.redeemedAt ? (
                    <ApplesFact>Apple: redeemed {grant.redeemedAt.slice(0, 10)}</ApplesFact>
                  ) : (
                    <span className="inline-block rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                      Apple: no report of it being redeemed
                    </span>
                  )}
                  {grant.given ? (
                    <YourNote>Your note: {grant.given}</YourNote>
                  ) : (
                    <YourNote>Your note: the {grant.batch} batch</YourNote>
                  )}
                  {ends && !ends.over && (
                    <span className="inline-block rounded-sm bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                      {ends.daysLeft} days left
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-slate-700">
                  {describeGrant(grant, now)}
                </p>
                {/* Neither report Apple produces carries the offer code, so the
                    day a particular one was redeemed is read off App Store
                    Connect's own offer-code page and typed. Still Apple's
                    fact, and still never a claim about WHO: there is no box
                    here for that, on purpose. */}
                {!grant.redeemedAt && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Field
                      label={`When Apple reported ${grant.code} redeemed`}
                      value={redeemed[grant.code] ?? ''}
                      onChange={(text) => setRedeemed({ ...redeemed, [grant.code]: text })}
                      placeholder="2026-07-02"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        tryIt(() => markRedeemed(books, grant.code, redeemed[grant.code] ?? ''))
                      }
                      aria-label={`Apple reported ${grant.code} redeemed`}
                      className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                                 text-slate-700 active:bg-slate-100"
                    >
                      Apple says redeemed
                    </button>
                  </div>
                )}
                {!grant.redeemedAt && !grant.pulled && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Field
                      label={`Why ${grant.code} is being withdrawn`}
                      value={why[grant.code] ?? ''}
                      onChange={(text) => setWhy({ ...why, [grant.code]: text })}
                      wide
                    />
                    <button
                      type="button"
                      onClick={() =>
                        tryIt(() =>
                          pullGrant(
                            books,
                            grant.code,
                            why[grant.code] ?? '',
                            new Date().toISOString()
                          )
                        )
                      }
                      aria-label={`Withdraw ${grant.code}`}
                      className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                                 text-slate-700 active:bg-slate-100"
                    >
                      Withdraw it
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- TestFlight */

function TestFlight({
  books,
  onKeep,
}: {
  readonly books: Books;
  readonly onKeep: (books: Books) => void;
}) {
  const [who, setWho] = useState('');
  const [stage, setStage] = useState<TesterStage>('asked');
  const funnel = whereTheyGotTo(books.testers);
  const most = Math.max(1, funnel[0]?.reached ?? 1);

  return (
    <Card title="Who is on TestFlight">
      <p className="mt-1 text-sm leading-relaxed text-slate-700">
        Between hearing about it and using it. The gap beside each step is how many did not get
        from the one above to it — a number rather than a percentage, because before launch a
        percentage of five people is two blokes to ring.
      </p>

      <ul className="mt-3 space-y-2">
        {funnel.map((step) => (
          <li key={step.stage}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-slate-700">{STAGE_SAYS[step.stage]}</span>
              <span className="font-mono text-sm tabular-nums text-slate-900">
                {step.reached}
                {step.lost > 0 && (
                  <span className="ml-2 text-xs text-slate-600">{step.lost} did not</span>
                )}
              </span>
            </div>
            <div className="mt-1 h-2 w-full rounded-sm bg-slate-100">
              <div
                className="h-2 rounded-sm bg-slate-300"
                style={{ width: `${Math.round((step.reached / most) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-2 rounded-md bg-slate-50 p-3">
        <Field label="Who they are" value={who} onChange={setWho} placeholder="Gilbert Ruiz" wide />
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Where they got to</span>
          <select
            value={stage}
            onChange={(event) => setStage(event.target.value as TesterStage)}
            aria-label="Where they got to"
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2
                       focus:border-sky-500 focus:outline-none"
          >
            {(Object.keys(STAGE_SAYS) as TesterStage[]).map((one) => (
              <option key={one} value={one}>
                {STAGE_SAYS[one]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            const name = who.trim();
            if (name === '') return;
            const one: Tester = { who: name, stage, at: new Date().toISOString() };
            onKeep({ ...books, testers: [...books.testers, one] });
            setWho('');
          }}
          className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
        >
          Put them on the list
        </button>
      </div>
    </Card>
  );
}

const STAGE_SAYS: Readonly<Record<TesterStage, string>> = {
  asked: 'Asked for it',
  invited: 'Invited',
  installed: 'Installed it',
  opened: 'Opened it',
};

/* ----------------------------------------------------------- what is broken */

function WhatBroke({
  books,
  onKeep,
}: {
  readonly books: Books;
  readonly onKeep: (books: Books) => void;
}) {
  const [what, setWhat] = useState('');
  const [where, setWhere] = useState('');
  const gathered = gatherTroubles(books.troubles);

  return (
    <Card title="What is going wrong">
      <p className="mt-1 text-sm leading-relaxed text-slate-700">
        What came back off people's phones, folded so the commonest is at the top. The error's own
        text and the file it came from, and nothing else — no room, no measurement, no file name
        off anybody's job, because none of that is ever sent.
      </p>

      {gathered.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">Nothing has been reported broken.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
          {gathered.map((one) => (
            <li key={`${one.what}|${one.where}`} className="py-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="rounded-sm bg-red-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-red-800">
                  {one.times}
                </span>
                <span className="text-sm text-slate-900">{one.what}</span>
              </div>
              <p className="mt-0.5 break-words font-mono text-xs text-slate-500">
                {one.where} · {one.firstAt.slice(0, 10)} to {one.lastAt.slice(0, 10)}
                {one.version ? ` · ${one.version}` : ' · several versions'}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-2 rounded-md bg-slate-50 p-3">
        <Field label="What it said" value={what} onChange={setWhat} wide placeholder="Cannot read properties of undefined" />
        <Field label="Where it came from" value={where} onChange={setWhere} wide placeholder="index-4f2a.js:812:19" />
        <button
          type="button"
          onClick={() => {
            const said = what.trim();
            if (said === '') return;
            const now = new Date().toISOString();
            onKeep({
              ...books,
              troubles: [
                ...books.troubles,
                { what: said, where: where.trim(), times: 1, firstAt: now, lastAt: now },
              ],
            });
            setWhat('');
            setWhere('');
          }}
          className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
        >
          Write it down
        </button>
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- in touch */

function InTouch({
  books,
  onKeep,
}: {
  readonly books: Books;
  readonly onKeep: (books: Books) => void;
}) {
  const [who, setWho] = useState('');
  const [about, setAbout] = useState('');
  const [did, setDid] = useState<Record<string, string>>({});

  return (
    <Card title="Contractors in touch">
      <p className="mt-1 text-sm leading-relaxed text-slate-700">
        A note per person, so the next message is not started cold. If somebody sends a room file
        to look at, it is opened in the app like any other and it is not stored here.
      </p>

      {books.contacts.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">Nobody has been in touch.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
          {books.contacts.map((one, index) => (
            <li key={`${one.who}|${one.at}|${index}`} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium text-slate-900">{one.who}</span>
                <span className="font-mono text-xs tabular-nums text-slate-500">
                  {one.at.slice(0, 10)}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-slate-700">{one.about}</p>
              {one.settled ? (
                <p className="mt-1 text-xs text-slate-600">
                  Dealt with {one.settled.at.slice(0, 10)}: {one.settled.did}
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Field
                    label={`What was done about ${one.who}`}
                    value={did[one.who] ?? ''}
                    onChange={(text) => setDid({ ...did, [one.who]: text })}
                    wide
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const done = (did[one.who] ?? '').trim();
                      if (done === '') return;
                      const settled: Contact['settled'] = {
                        at: new Date().toISOString(),
                        did: done,
                      };
                      onKeep({
                        ...books,
                        contacts: books.contacts.map((each, at) =>
                          at === index ? { ...each, settled } : each
                        ),
                      });
                    }}
                    aria-label={`Settle ${one.who}`}
                    className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                               text-slate-700 active:bg-slate-100"
                  >
                    Settle it
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-2 rounded-md bg-slate-50 p-3">
        <Field label="Who got in touch" value={who} onChange={setWho} placeholder="Gilbert Ruiz" wide />
        <Field
          label="What it was about"
          value={about}
          onChange={setAbout}
          placeholder="the plan would not print"
          wide
        />
        <button
          type="button"
          onClick={() => {
            const name = who.trim();
            if (name === '') return;
            onKeep({
              ...books,
              contacts: [
                ...books.contacts,
                { who: name, at: new Date().toISOString(), about: about.trim() },
              ],
            });
            setWho('');
            setAbout('');
          }}
          className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
        >
          Keep the note
        </button>
      </div>
    </Card>
  );
}
