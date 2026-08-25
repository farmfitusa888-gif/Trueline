import { type Invoice } from './invoice.ts';
import { splitCsv } from './pricelist.ts';

/**
 * The invoice, in a shape QuickBooks will take.
 *
 * ## Why a file and not an integration
 *
 * QuickBooks has an API. Using it means an app registration, OAuth tokens to
 * store and refresh, a developer account, and a connection that breaks when
 * Intuit changes something -- and none of it makes the numbers any more
 * correct. QuickBooks has imported CSV invoices for as long as it has existed,
 * the format is stable, and a file works whether the contractor is on Online,
 * Desktop, or something else entirely.
 *
 * It also cannot break. A file on disk is a file on disk; an integration is a
 * thing that stops working on a Tuesday.
 *
 * The columns are the ones QuickBooks Online's own invoice import expects. A
 * bookkeeper who wants different ones opens it in a spreadsheet, which is the
 * other reason this is a file.
 */

const COLUMNS = [
  'InvoiceNo',
  'Customer',
  'InvoiceDate',
  'DueDate',
  'Item(Product/Service)',
  'ItemDescription',
  'ItemAmount',
  'Memo',
] as const;

/** A field, quoted the way a spreadsheet expects. */
function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Cents as a plain decimal. No currency symbol: this is a number in a column. */
function amount(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${`${abs % 100n}`.padStart(2, '0')}`;
}

/**
 * One row per line, all sharing the invoice's number.
 *
 * That repetition is the format: QuickBooks groups rows by InvoiceNo, so an
 * invoice with three lines is three rows carrying the same number. Writing one
 * row per invoice would import three invoices as one line each.
 */
export function quickbooksCsv(invoices: readonly Invoice[]): string {
  const rows: string[] = [COLUMNS.join(',')];
  for (const invoice of invoices) {
    for (const line of invoice.lines) {
      rows.push(
        [
          invoice.number,
          invoice.client.name,
          invoice.issuedAt.slice(0, 10),
          invoice.dueAt.slice(0, 10),
          line.what,
          line.detail,
          amount(line.amount),
          invoice.note,
        ].map(cell).join(',')
      );
    }
  }
  return rows.join('\r\n') + '\r\n';
}

export function quickbooksName(jobName: string): string {
  const safe = jobName.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-') || 'job';
  return `${safe}-quickbooks.csv`;
}

/**
 * Reads back what was written, so the writer can be checked against a reader.
 *
 * Exists for the tests rather than for the app: a CSV writer nobody parses is a
 * CSV writer nobody has checked. It reuses the same splitter the supplier price
 * list import uses, which was written against 21,251 rows of somebody's real
 * price file and knows what a quoted field is.
 */
export function readQuickbooks(text: string): Record<string, string>[] {
  // `splitCsv` parses the whole document at once -- it has to, because a quoted
  // field may contain a newline and splitting on lines first would cut one in
  // half. That is exactly the case a per-line reader gets wrong.
  const rows = splitCsv(text).filter((row) => row.some((cell) => cell !== ''));
  const header = rows[0] ?? [];
  return rows.slice(1).map((cells) =>
    Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']))
  );
}
