import {
  type Books,
  type Contact,
  type Grant,
  type Takings,
  type Tester,
  type Trouble,
  NO_BOOKS,
  OwnerError,
} from './owner.ts';

/**
 * Getting the owner's books from one of Sam's devices to another, for nothing,
 * for ever.
 *
 * ## Why a file in his own repository, and not a server
 *
 * Sam asked for a dashboard he can reach from more than one device, and then
 * for the part that decides this: *"figure out a way to do 2 for free and
 * implement that now if you can do it for free forever."*
 *
 * A hosted backend fails that on the last two words. Every free tier is
 * somebody else's promise, revocable, and the day it is withdrawn the thing it
 * was holding is Sam's business record. So the store is **a JSON file in Sam's
 * own private GitHub repository**, read and written through the GitHub contents
 * API. The reasons, in the order they matter:
 *
 *   - It costs nothing and depends on no free-tier promise. It is his
 *     repository, which already holds this code.
 *   - It adds no new party who holds the data. `owner.ts` is built around the
 *     line that a contractor's work never reaches a server; this keeps the
 *     number of servers that hold anything at all the same as it was.
 *   - **The commit history is the audit trail**, free. Grants and takings are
 *     an append-only book, and an append-only book wants a log of who wrote
 *     what and when more than it wants an index.
 *   - `Books` is small — hundreds of rows, not millions. One file is genuinely
 *     the right shape for it rather than a compromise it has been squeezed
 *     into.
 *
 * ## What it is not, said plainly
 *
 * **It is not real time.** Nothing pushes. A device finds out what the other
 * one did when somebody presses sync, and not before.
 *
 * **It is not a database.** There is no query, no index and no partial read.
 * Every read is the whole file and every write is the whole file. That is fine
 * at hundreds of rows and stops being fine at some size nobody has measured; if
 * the file ever outgrows this, the honest move is to say so rather than to
 * bolt pagination onto a git blob.
 *
 * **Two devices can write at the same moment**, and that is handled here rather
 * than hoped about. The write is conditional on the version that was read — see
 * `writeOutcome` — and the merge below is what happens when both devices have
 * added something since they last agreed.
 *
 * ## The one rule the merge is built on: a record is merged whole
 *
 * Never field by field. This is not a simplification, it is `owner.ts`'s second
 * rule enforced in the transport:
 *
 * > `Grant.given` is a claim. `Grant.redeemedAt` is a fact.
 *
 * A field-by-field merge would take Sam's note about who he handed a code to
 * from one device and staple it to Apple's redemption fact from the other, and
 * the result would be a row that reads like Apple confirmed who redeemed it.
 * Apple does not report that and never will. Merging whole records makes that
 * failure unreachable: a record either matches on both sides, or it is a
 * conflict a person looks at.
 *
 * And the same rule keeps this file honest about the first rule too. The format
 * below carries a `Books` and refuses a file with anything else in it —
 * unknown keys and all — so this transport can never quietly become the way a
 * room, a photograph or a client's name reaches a server.
 *
 * ## What this module does and does not know
 *
 * It is pure. No network, no DOM, no clock, no `localStorage`. It is handed the
 * books this device holds, the text and version of what is in the repository,
 * and the time and device name to stamp on the write, and it works out what to
 * write. `web/src/ownerSync.ts` is the half that talks to GitHub, and it makes
 * no decisions — every status code it can receive is turned into an answer by
 * `readOutcome` and `writeOutcome` here, where it can be tested.
 *
 * It also does not check that a record makes business sense. Whether a grant
 * may run for zero months, or whether a date is really ISO 8601 with an offset,
 * belongs to `books.ts` and must have exactly one home. What this checks is
 * that the thing in the repository **is a `Books`** — the right shape, the
 * right types, nothing extra — and that every record can be told apart from
 * every other, because a record that cannot be keyed is a record a merge would
 * drop.
 */

/** Anything that would lose a record, or read one wrong, refuses through this. */
export class BooksSyncError extends OwnerError {}

/**
 * The version of the file format, written into the file itself.
 *
 * ### The rule, and it is a refusal
 *
 * **A reader that meets any format other than its own refuses.** It does not
 * migrate, guess, or read the parts it recognises.
 *
 * The newer-file case is the one this exists for and it is worth spelling out,
 * because guessing there loses data silently rather than loudly. Suppose
 * version 2 adds a field to `Grant`. A version 1 reader that shrugged and read
 * what it understood would merge, drop that field from every grant, and write
 * the result back over the top — and the device running version 2 would find
 * its own data quietly gone, with a clean commit in the history saying nothing
 * happened. So: refuse, say which version wrote it, and tell the person to
 * update the older device. An older file is refused for the same reason from
 * the other direction — there is no migration written, and inventing one at
 * read time is guessing at somebody's books.
 */
export const BOOKS_FORMAT = 1;

/* -------------------------------------------------------- money, exactly */

/**
 * How money survives JSON.
 *
 * `Cents` is a `bigint`, like every figure in this codebase, and
 * `JSON.stringify` throws on one rather than approximating it. So a bigint is
 * written as `{"$cents": "1499"}` — a tagged decimal string, exact in both
 * directions and legible to somebody reading the file on GitHub.
 *
 * This is the same trick `core/src/persist.ts` plays for lengths, and it is
 * deliberately a second, separate copy rather than an import. `persist.ts`
 * pulls in the whole room model to validate what it decodes, and the one thing
 * this module must never do is give the dashboard a reason to hold a
 * contractor's room. The part that could actually drift — a hand-written
 * field-by-field mapper that silently forgets the field somebody added last
 * week — is not what is duplicated here: this is a replacer and a reviver over
 * whatever it is given, so it cannot lose a field it has never heard of.
 */
const CENTS = '$cents';

function tagged(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    CENTS in value
  );
}

/**
 * JSON with the keys in a fixed order, so the same books make the same bytes.
 *
 * It matters twice. Two records are the same record when their canonical text
 * is identical, which is how a merge tells "we both have this" from "we
 * disagree about this" — and a file whose bytes depend on the order a
 * javascript object happened to be built in would produce a commit every sync
 * saying nothing changed.
 */
function canonical(value: unknown): unknown {
  if (typeof value === 'bigint') return { [CENTS]: value.toString() };
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const field = (value as Record<string, unknown>)[key];
      // An absent field and a field set to `undefined` are the same thing in
      // this model -- `Grant.given` is optional -- and only one of them may
      // reach the file, or two devices holding identical books would disagree.
      if (field === undefined) continue;
      out[key] = canonical(field);
    }
    return out;
  }
  return value;
}

function text(value: unknown): string {
  return JSON.stringify(canonical(value));
}

/**
 * The same record laid out the way it sits in the file.
 *
 * Only for showing a person the two sides of a conflict. The comparison that
 * decides whether there is a conflict at all uses the compact form above --
 * one string per record, so equality is a string equality and nothing depends
 * on how many spaces a formatter felt like.
 */
function readable(value: unknown): string {
  return JSON.stringify(canonical(value), null, 2);
}

/* ---------------------------------------------------------- what is in it */

/**
 * The file, as it sits in the repository.
 *
 * `writtenBy` is a name Sam types for each device — "the office Mac", "the
 * iPhone" — and it is his word, not something discovered. It is here so the
 * commit history reads like a history and so a conflict can name which device
 * it is arguing with. Nothing is decided from it.
 */
export interface BooksFile {
  readonly format: number;
  /** When this file was written, as the writing device's clock said. */
  readonly writtenAt: string;
  readonly writtenBy: string;
  readonly books: Books;
}

const FILE_KEYS = ['format', 'writtenAt', 'writtenBy', 'books'] as const;
const BOOKS_KEYS = ['grants', 'takings', 'testers', 'troubles', 'contacts'] as const;

const GRANT_KEYS = [
  'code',
  'how',
  'batch',
  'given',
  'months',
  'madeAt',
  'redeemedAt',
  'pulled',
] as const;
const TAKINGS_KEYS = [
  'month',
  'charged',
  'proceeds',
  'refunded',
  'started',
  'cancelled',
  'renewed',
  'from',
] as const;
const TESTER_KEYS = ['who', 'stage', 'at', 'from'] as const;
const TROUBLE_KEYS = ['what', 'where', 'times', 'firstAt', 'lastAt', 'version'] as const;
const CONTACT_KEYS = ['who', 'at', 'about', 'version', 'sent', 'settled'] as const;

const STAGES = ['asked', 'invited', 'installed', 'opened'] as const;
const HOWS = ['batch', 'named'] as const;

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BooksSyncError(`The books in the repository are damaged: ${where} is not a record.`);
  }
  return value as Record<string, unknown>;
}

/**
 * Refuses a record carrying anything this version has never heard of.
 *
 * Strict on purpose, and it is the first rule of `owner.ts` made mechanical:
 * the only things that may travel in this file are the ones `Books` declares.
 * A field nobody here recognises is either a newer format — which the version
 * check has already refused — or something riding along that has no business
 * on a server, and both are refusals rather than fields to step over.
 */
function onlyKnown(one: Record<string, unknown>, known: readonly string[], where: string): void {
  for (const key of Object.keys(one)) {
    if (known.includes(key)) continue;
    throw new BooksSyncError(
      `The books in the repository carry "${key}" on ${where}, which this version of ` +
        `Trueline does not know about. Nothing has been read and nothing written — a field ` +
        `this app cannot account for is not something to quietly step over in a business record.`
    );
  }
}

function str(from: Record<string, unknown>, key: string, where: string): string {
  const value = from[key];
  if (typeof value !== 'string') {
    throw new BooksSyncError(`The books in the repository are damaged: ${where} has no ${key}.`);
  }
  return value;
}

function named(from: Record<string, unknown>, key: string, where: string): string {
  const value = str(from, key, where);
  if (value.trim() === '') {
    throw new BooksSyncError(
      `The books in the repository have a ${where} whose ${key} is blank. That is refused ` +
        `rather than merged: ${key} is how this record is told apart from every other one, and ` +
        `two records that cannot be told apart is how a merge loses one of them.`
    );
  }
  return value;
}

function whole(from: Record<string, unknown>, key: string, where: string): number {
  const value = from[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BooksSyncError(
      `The books in the repository are damaged: ${where} has a ${key} of ` +
        `"${String(value)}", which is not a whole number.`
    );
  }
  return value;
}

function cents(from: Record<string, unknown>, key: string, where: string): bigint {
  const value = from[key];
  if (typeof value !== 'bigint') {
    throw new BooksSyncError(
      `The books in the repository are damaged: ${where} has a ${key} that is not money. ` +
        `Money is written as {"${CENTS}": "1499"} in this file and nothing else counts — a ` +
        `figure read as an ordinary number would be approximate, and none of the money in ` +
        `this app ever is.`
    );
  }
  return value;
}

function oneOf<T extends string>(
  from: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  where: string
): T {
  const value = str(from, key, where);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BooksSyncError(
      `The books in the repository are damaged: ${where} has a ${key} of "${value}", ` +
        `and the only ones this version knows are ${allowed.join(', ')}.`
    );
  }
  return value as T;
}

function list(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new BooksSyncError(`The books in the repository are damaged: ${where} is not a list.`);
  }
  return value;
}

function readGrant(raw: unknown, at: number): Grant {
  const where = `grant ${at + 1}`;
  const from = record(raw, where);
  onlyKnown(from, GRANT_KEYS, where);
  const pulled = from['pulled'];
  return {
    code: named(from, 'code', where),
    how: oneOf(from, 'how', HOWS, where),
    ...(from['batch'] === undefined ? {} : { batch: str(from, 'batch', where) }),
    ...(from['given'] === undefined ? {} : { given: str(from, 'given', where) }),
    months: whole(from, 'months', where),
    madeAt: str(from, 'madeAt', where),
    ...(from['redeemedAt'] === undefined ? {} : { redeemedAt: str(from, 'redeemedAt', where) }),
    ...(pulled === undefined
      ? {}
      : {
          pulled: (() => {
            const it = record(pulled, `${where}'s withdrawal`);
            onlyKnown(it, ['at', 'because'], `${where}'s withdrawal`);
            return {
              at: str(it, 'at', `${where}'s withdrawal`),
              because: str(it, 'because', `${where}'s withdrawal`),
            };
          })(),
        }),
  };
}

function readTakings(raw: unknown, at: number): Takings {
  const where = `takings line ${at + 1}`;
  const from = record(raw, where);
  onlyKnown(from, TAKINGS_KEYS, where);
  return {
    month: named(from, 'month', where),
    charged: cents(from, 'charged', where),
    proceeds: cents(from, 'proceeds', where),
    refunded: cents(from, 'refunded', where),
    started: whole(from, 'started', where),
    cancelled: whole(from, 'cancelled', where),
    renewed: whole(from, 'renewed', where),
    from: named(from, 'from', where),
  };
}

function readTester(raw: unknown, at: number): Tester {
  const where = `tester ${at + 1}`;
  const from = record(raw, where);
  onlyKnown(from, TESTER_KEYS, where);
  return {
    who: named(from, 'who', where),
    stage: oneOf(from, 'stage', STAGES, where),
    at: str(from, 'at', where),
    ...(from['from'] === undefined ? {} : { from: str(from, 'from', where) }),
  };
}

function readTrouble(raw: unknown, at: number): Trouble {
  const where = `trouble ${at + 1}`;
  const from = record(raw, where);
  onlyKnown(from, TROUBLE_KEYS, where);
  return {
    what: named(from, 'what', where),
    where: named(from, 'where', where),
    times: whole(from, 'times', where),
    firstAt: str(from, 'firstAt', where),
    lastAt: str(from, 'lastAt', where),
    ...(from['version'] === undefined ? {} : { version: str(from, 'version', where) }),
  };
}

function readContact(raw: unknown, at: number): Contact {
  const where = `contact ${at + 1}`;
  const from = record(raw, where);
  onlyKnown(from, CONTACT_KEYS, where);
  const sent = from['sent'];
  const settled = from['settled'];
  return {
    who: named(from, 'who', where),
    at: named(from, 'at', where),
    about: str(from, 'about', where),
    ...(from['version'] === undefined ? {} : { version: str(from, 'version', where) }),
    ...(sent === undefined
      ? {}
      : {
          sent: list(sent, `${where}'s attachments`).map((it, n) => {
            if (typeof it !== 'string') {
              throw new BooksSyncError(
                `The books in the repository are damaged: attachment ${n + 1} on ${where} is ` +
                  `not a name.`
              );
            }
            return it;
          }),
        }),
    ...(settled === undefined
      ? {}
      : {
          settled: (() => {
            const it = record(settled, `${where}'s settlement`);
            onlyKnown(it, ['at', 'did'], `${where}'s settlement`);
            return {
              at: str(it, 'at', `${where}'s settlement`),
              did: str(it, 'did', `${where}'s settlement`),
            };
          })(),
        }),
  };
}

/**
 * Reads what is in the repository, or refuses.
 *
 * Every failure here is Sam's business record, so every message says what was
 * wrong with the file rather than what was wrong with the parser, and nothing
 * is half-read: this either hands back a whole `Books` or throws.
 */
export function readBooksFile(raw: string): BooksFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw, (_key, value: unknown) => {
      if (!tagged(value)) return value;
      const digits = value[CENTS];
      if (typeof digits !== 'string' || !/^-?\d+$/.test(digits)) {
        throw new BooksSyncError(
          `The books in the repository hold "${String(digits)}" where an amount of money ` +
            `should be.`
        );
      }
      return BigInt(digits);
    });
  } catch (error) {
    if (error instanceof BooksSyncError) throw error;
    throw new BooksSyncError(
      `What is in the repository is not readable as the books: ` +
        `${error instanceof Error ? error.message : String(error)}. Nothing has been written ` +
        `over it — a file that cannot be read is still the only copy of whatever is in it.`
    );
  }

  const file = record(parsed, 'the file');
  onlyKnown(file, FILE_KEYS, 'the file');

  const format = file['format'];
  if (typeof format !== 'number' || !Number.isInteger(format)) {
    throw new BooksSyncError(
      `The file in the repository does not say which format it is written in, so there is no ` +
        `way to know whether this version can read it. It is being refused rather than guessed at.`
    );
  }
  if (format > BOOKS_FORMAT) {
    throw new BooksSyncError(
      `Those books were written by a newer version of Trueline (format ${format}; this one ` +
        `reads ${BOOKS_FORMAT}). Nothing has been read and nothing written. Reading what this ` +
        `version happens to recognise would drop whatever the newer one added, and writing the ` +
        `result back would delete it from the other device with a clean commit saying nothing ` +
        `happened. Update this device instead.`
    );
  }
  if (format < BOOKS_FORMAT) {
    throw new BooksSyncError(
      `Those books were written by an older version of Trueline (format ${format}; this one ` +
        `reads ${BOOKS_FORMAT}), and there is no conversion written between the two. It is ` +
        `being refused rather than guessed at.`
    );
  }

  const books = record(file['books'], 'the books');
  onlyKnown(books, BOOKS_KEYS, 'the books');

  return {
    format: BOOKS_FORMAT,
    writtenAt: str(file, 'writtenAt', 'the file'),
    writtenBy: str(file, 'writtenBy', 'the file'),
    books: {
      grants: list(books['grants'], 'the grants').map(readGrant),
      takings: list(books['takings'], 'the takings').map(readTakings),
      testers: list(books['testers'], 'the testers').map(readTester),
      troubles: list(books['troubles'], 'the troubles').map(readTrouble),
      contacts: list(books['contacts'], 'the contacts').map(readContact),
    },
  };
}

/** The books as they go into the repository: sorted, stable, and readable. */
export function encodeBooksFile(books: Books, writtenAt: string, writtenBy: string): string {
  const file: BooksFile = { format: BOOKS_FORMAT, writtenAt, writtenBy, books };
  // Two spaces, because this lands in a git repository and the whole reason for
  // putting it there is that a person can read the diff. One line per field
  // makes a commit that added one grant look like a commit that added one grant.
  return `${JSON.stringify(canonical(file), null, 2)}\n`;
}

/* ----------------------------------------------------------- who is who */

/**
 * What tells one record from another.
 *
 * Each is the record's own natural key — something the record already is,
 * rather than an id invented at write time. An invented id would be the wrong
 * answer here for a specific reason: two devices that both write down the same
 * grant would invent two different ids for it, and the merge would keep both
 * and show Sam the same free month twice.
 *
 *   - A **grant** is its code. App Store Connect generates it and it is unique
 *     there, which makes it unique here.
 *   - A **takings line** is its month and the report it was read out of. Not
 *     the month alone: Apple issues more than one report covering a month, they
 *     do not always agree, and `owner.ts` keeps `from` on every line precisely
 *     so a figure can be pointed back at the report that produced it.
 *   - A **tester** is who they are and the stage they are at. Not the person
 *     alone: `asked` and `installed` for one person are two facts about a
 *     journey and losing the first one loses the gap that is the whole reason
 *     the list exists.
 *   - A **trouble** is the error, the file it came from, and the version it was
 *     reported on. Deliberately not summed across devices — `times` is a count
 *     of reports, both devices may have seen the same reports, and adding them
 *     would invent crashes that did not happen. Two devices that disagree about
 *     a count get a conflict, which is a person looking at it.
 *   - A **contact** is who got in touch and when. One person may be in touch
 *     many times and each is its own note.
 */
interface Kind<T> {
  readonly kind: RecordKind;
  /**
   * The key a merge indexes on. Built with `JSON.stringify` over the parts
   * rather than by joining them with a separator, because a separator can
   * appear inside a part -- a report called `2026-01 / revised` would key
   * to the same string as the January line of a report called `revised`, if a
   * slash were the separator -- and
   * two different records sharing a key is exactly the collision this module
   * refuses to let happen quietly.
   */
  readonly keyOf: (one: T) => string;
  /** The same record said the way a person would say it, for the message. */
  readonly nameOf: (one: T) => string;
}

const GRANTS: Kind<Grant> = {
  kind: 'grant',
  keyOf: (one) => JSON.stringify([one.code]),
  nameOf: (one) => one.code,
};
const TAKINGS: Kind<Takings> = {
  kind: 'takings line',
  keyOf: (one) => JSON.stringify([one.month, one.from]),
  nameOf: (one) => `${one.month} out of ${one.from}`,
};
const TESTERS: Kind<Tester> = {
  kind: 'tester',
  keyOf: (one) => JSON.stringify([one.who, one.stage]),
  nameOf: (one) => `${one.who}, ${one.stage}`,
};
const TROUBLES: Kind<Trouble> = {
  kind: 'trouble',
  keyOf: (one) => JSON.stringify([one.what, one.where, one.version ?? null]),
  nameOf: (one) => `${one.what} in ${one.where}${one.version === undefined ? '' : ` on ${one.version}`}`,
};
const CONTACTS: Kind<Contact> = {
  kind: 'contact',
  keyOf: (one) => JSON.stringify([one.who, one.at]),
  nameOf: (one) => `${one.who} on ${one.at}`,
};

/* ------------------------------------------------------------- the merge */

export type RecordKind = 'grant' | 'takings line' | 'tester' | 'trouble' | 'contact';

/**
 * One record two devices disagree about.
 *
 * Both sides are kept as text rather than as objects, because the only useful
 * thing a screen can do with this is show a person both of them and let them
 * decide. Nothing here suggests a winner: a rule that picked the newer one
 * would be picking whichever device's clock was ahead.
 */
export interface Conflict {
  readonly kind: RecordKind;
  /**
   * The record both sides are arguing about, named the way a person says it.
   * It is the readable form of the key that matched them, not the key itself.
   */
  readonly key: string;
  /** What this device holds, laid out as it would go into the file. */
  readonly here: string;
  /** What the repository holds, laid out the same way, so the two can be read side by side. */
  readonly there: string;
  readonly says: string;
}

/** What a sync brought back, so a screen can say what happened without guessing. */
export interface Brought {
  /** Records only this device had. */
  readonly here: number;
  /** Records only the repository had, which are now on this device too. */
  readonly there: number;
  /** Records both sides already agreed on. */
  readonly both: number;
}

export type SyncPlan =
  | {
      readonly what: 'write';
      /** Exactly the bytes to put in the repository. */
      readonly file: string;
      /**
       * The version this must be written against, or null when the file is not
       * there yet. Handing this back rather than letting the caller remember it
       * is what makes a lost update impossible to write by accident.
       */
      readonly onto: string | null;
      readonly merged: Books;
      readonly brought: Brought;
      readonly says: string;
    }
  | { readonly what: 'nothing to do'; readonly books: Books; readonly says: string }
  | {
      readonly what: 'conflict';
      readonly conflicts: readonly Conflict[];
      readonly says: string;
    };

interface Merged<T> {
  readonly kept: readonly T[];
  readonly conflicts: readonly Conflict[];
  readonly here: number;
  readonly there: number;
  readonly both: number;
}

function indexed<T>(of: Kind<T>, side: string, rows: readonly T[]): Map<string, T> {
  const by = new Map<string, T>();
  for (const row of rows) {
    const key = of.keyOf(row);
    if (by.has(key)) {
      // Refused rather than collapsed, and the reason is the whole point of
      // this module: collapsing two records into one is losing one, and a
      // silent loss in a book of grants and takings is the failure everything
      // here is built against.
      throw new BooksSyncError(
        `${side} holds the same ${of.kind} twice \u2014 ${of.nameOf(row)}. Nothing has been ` +
          `merged and nothing written. Two records this app cannot tell apart is a record it ` +
          `would lose, so it stops instead. Take one of the two out and sync again.`
      );
    }
    by.set(key, row);
  }
  return by;
}

function mergeList<T>(of: Kind<T>, here: readonly T[], there: readonly T[]): Merged<T> {
  const mine = indexed(of, 'This device', here);
  const theirs = indexed(of, 'The repository', there);

  const kept: T[] = [];
  const conflicts: Conflict[] = [];
  let onlyHere = 0;
  let onlyThere = 0;
  let both = 0;

  for (const [key, ours] of mine) {
    const yours = theirs.get(key);
    if (yours === undefined) {
      onlyHere += 1;
      kept.push(ours);
      continue;
    }
    if (text(ours) === text(yours)) {
      both += 1;
      kept.push(ours);
      continue;
    }
    conflicts.push({
      kind: of.kind,
      key: of.nameOf(ours),
      here: readable(ours),
      there: readable(yours),
      says:
        `The ${of.kind} ${of.nameOf(ours)} says one thing on this device and another in the ` +
        `repository. Neither has been changed and nothing has been written. Decide which is ` +
        `right, correct the other, and sync again.`,
    });
  }

  for (const [key, yours] of theirs) {
    if (mine.has(key)) continue;
    onlyThere += 1;
    kept.push(yours);
  }

  // A merge that drops a record is the one outcome this module exists to make
  // impossible, so it is asserted rather than trusted. Every key on either side
  // has to come out the other end: the ones only this device had, the ones only
  // the repository had, and one copy of each the two agreed on. If a key
  // function is ever changed so that two records collide, this is what says so
  // -- loudly, before anything is written -- rather than a row going missing.
  //
  // Checked only when nothing is in conflict, because a conflict writes nothing
  // at all and `kept` is abandoned along with the rest of the plan.
  if (conflicts.length === 0) {
    const expected = onlyHere + onlyThere + both;
    if (kept.length !== expected || mine.size + theirs.size !== expected + both) {
      throw new BooksSyncError(
        `Merging the ${of.kind}s would have ended with ${kept.length} records where ` +
          `${expected} went in. Nothing has been written. This is a fault in Trueline itself, ` +
          `not in the books.`
      );
    }
  }

  kept.sort((x, y) => (of.keyOf(x) < of.keyOf(y) ? -1 : of.keyOf(x) > of.keyOf(y) ? 1 : 0));
  return { kept, conflicts, here: onlyHere, there: onlyThere, both };
}

/**
 * Works out what to write, given what is here and what is there.
 *
 * `remote` is null when the file is not in the repository yet, which is the
 * first sync from a new device and is not an error.
 *
 * Three answers and no others. **Write** — here are the exact bytes and the
 * version they must be written against. **Nothing to do** — the two sides
 * already say the same thing, so no commit is made; a repository full of
 * commits that changed nothing is a history nobody reads. **Conflict** — at
 * least one record differs, so nothing at all is written.
 *
 * That last one is deliberately all-or-nothing. Writing the agreed records and
 * leaving the disputed ones out would mean choosing, for each disputed record,
 * either one side's version or neither — and the first is the silent resolution
 * this refuses to do, while the second drops a record. There is no third
 * option, so a conflict stops the whole write until a person has looked at it.
 */
export function planSync(
  here: Books,
  remote: { readonly text: string; readonly version: string } | null,
  writtenAt: string,
  writtenBy: string
): SyncPlan {
  // A first write goes through exactly the same merge, against an empty other
  // side, rather than down a shortcut of its own. It costs nothing and it means
  // the first file in the repository is checked and sorted like every file
  // after it -- a shortcut here would let two records with the same code go up
  // unnoticed and then be refused by every sync from that day on.
  const there = remote === null ? NO_BOOKS : readBooksFile(remote.text).books;

  const grants = mergeList(GRANTS, here.grants, there.grants);
  const takings = mergeList(TAKINGS, here.takings, there.takings);
  const testers = mergeList(TESTERS, here.testers, there.testers);
  const troubles = mergeList(TROUBLES, here.troubles, there.troubles);
  const contacts = mergeList(CONTACTS, here.contacts, there.contacts);

  const conflicts = [
    ...grants.conflicts,
    ...takings.conflicts,
    ...testers.conflicts,
    ...troubles.conflicts,
    ...contacts.conflicts,
  ];
  if (conflicts.length > 0) {
    return {
      what: 'conflict',
      conflicts,
      says:
        `${conflicts.length} record${conflicts.length === 1 ? '' : 's'} say one thing on this ` +
        `device and another in the repository. Nothing has been written, on either side, and ` +
        `nothing has been merged — a business record is not something to resolve by a rule.`,
    };
  }

  const merged: Books = {
    grants: grants.kept,
    takings: takings.kept,
    testers: testers.kept,
    troubles: troubles.kept,
    contacts: contacts.kept,
  };
  const brought: Brought = {
    here: grants.here + takings.here + testers.here + troubles.here + contacts.here,
    there: grants.there + takings.there + testers.there + troubles.there + contacts.there,
    both: grants.both + takings.both + testers.both + troubles.both + contacts.both,
  };

  // Only ever an answer when there is a file to compare against. With nothing
  // in the repository, two sides that "already agree" still need the file
  // written, or the first sync of an empty dashboard would quietly do nothing
  // and the second device would find no file to read.
  if (remote !== null && brought.here === 0 && brought.there === 0) {
    return {
      what: 'nothing to do',
      books: merged,
      says: `The repository already says exactly what this device says. Nothing was written.`,
    };
  }

  return {
    what: 'write',
    file: encodeBooksFile(merged, writtenAt, writtenBy),
    onto: remote === null ? null : remote.version,
    merged,
    brought,
    says:
      remote === null
        ? `Nothing is in the repository yet, so this writes what is on this device: ` +
          `${brought.here} record${brought.here === 1 ? '' : 's'}.`
        : `${brought.there} record${brought.there === 1 ? '' : 's'} came down from the ` +
          `repository and ${brought.here} went up from this device.`,
  };
}

/* ------------------------------------------ what an answer from GitHub means */

/**
 * What a read of the file came back as.
 *
 * `missing` and `no such repository` are the same HTTP status and there is no
 * honest way to tell them apart from outside: GitHub answers 404 for a file
 * that is not there, for a repository that is not there, and for a private
 * repository the token cannot see, on purpose, so that a token cannot be used
 * to discover which private repositories exist. So they are one answer here
 * and the screen says all three possibilities rather than picking the
 * comfortable one.
 */
export type ReadOutcome =
  | 'here'
  | 'not there'
  | 'the token was refused'
  | 'the token is not allowed to'
  | 'github is having trouble'
  | 'unexpected';

export type WriteOutcome =
  | 'written'
  | 'somebody else wrote first'
  | 'the token was refused'
  | 'the token is not allowed to'
  | 'github is having trouble'
  | 'unexpected';

/**
 * Turns a status code from the contents API into an answer.
 *
 * Here rather than in the web half so that every branch can be tested without a
 * network, and so there is one place that decides what a number means.
 *
 * **What has and has not been checked against the real API.** These are
 * GitHub's documented contents-API statuses. They could not be exercised
 * against a live repository from the container this was written in: every
 * repository-scoped path on `api.github.com` is intercepted by that container's
 * outbound proxy, which answers 403 with a message of its own before the
 * request reaches GitHub. So the mapping below is read from documentation, and
 * the design allows for the documentation being wrong in the only way that is
 * safe: **anything not listed is `unexpected`, and `unexpected` is a refusal
 * that writes nothing and says so.** There is no default that means success and
 * no status that is quietly ignored.
 */
export function readOutcome(status: number): ReadOutcome {
  if (status === 200) return 'here';
  if (status === 404) return 'not there';
  if (status === 401) return 'the token was refused';
  if (status === 403) return 'the token is not allowed to';
  if (status >= 500 && status <= 599) return 'github is having trouble';
  return 'unexpected';
}

/**
 * The same for a write.
 *
 * 409 is the one that matters and the reason this design works at all: the
 * write carries the version of the file it was based on, and GitHub is
 * documented to refuse it with 409 if the file has moved on since. That turns
 * two devices writing at the same moment from a lost update into a detected
 * conflict, which is a thing a person can be told about.
 *
 * 422 is treated the same way and that is a deliberate widening rather than an
 * assumption. GitHub documents 422 as validation failure, which covers a
 * missing or malformed version — including the case where this device thought
 * the file did not exist, sent no version, and it did exist. Both mean the same
 * thing to the person holding the phone: *what you were working from is out of
 * date, read it again*. Reading again is safe in either case, and treating a
 * refused write as success is not, so the wider net is the safe one.
 */
export function writeOutcome(status: number): WriteOutcome {
  if (status === 200 || status === 201) return 'written';
  if (status === 409 || status === 422) return 'somebody else wrote first';
  if (status === 401) return 'the token was refused';
  if (status === 403) return 'the token is not allowed to';
  if (status >= 500 && status <= 599) return 'github is having trouble';
  return 'unexpected';
}
