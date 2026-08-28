import { type Books } from '../../core/src/owner.ts';
import {
  type Brought,
  type Conflict,
  BooksSyncError,
  planSync,
  readBooksFile,
  readOutcome,
  writeOutcome,
} from '../../core/src/books-sync.ts';

/**
 * The half that talks to GitHub.
 *
 * `core/src/books-sync.ts` holds the reasoning for why the owner's books live
 * in a JSON file in Sam's own private repository, and every decision this file
 * would otherwise have to make. Nothing here chooses anything: it reads a file,
 * hands the text to `planSync`, and writes back the bytes it is given, against
 * the version it was given. What a status code means is `readOutcome` and
 * `writeOutcome`, in core, where it is tested without a network.
 *
 * ## The conditional write, which is the whole trick
 *
 * The contents API takes the blob `sha` of the file you read, and a write
 * carrying a `sha` that is no longer current is documented to be refused rather
 * than applied. So two devices pressing sync at the same moment do not produce
 * a lost update: the second one is told its copy is out of date, reads again,
 * merges again, and writes again.
 *
 * **What was and was not checked against the live API.** The container this was
 * written in cannot reach GitHub's repository endpoints at all. `api.github.com`
 * answers, and `GET /user` returns a real identity through the session's token —
 * but every `repos/{owner}/{repo}/...` path, and `POST /user/repos`, are
 * intercepted by the container's outbound proxy, which answers **403** with a
 * message of its own before the request reaches GitHub. So no repository could
 * be created to probe against, and the 409 could not be provoked. The statuses
 * below are GitHub's documented ones and are marked as such rather than as
 * measured.
 *
 * Because of that, this is written so the unverified case fails loudly:
 *
 *   - Only 200 and 201 count as written. **Every other status writes nothing
 *     and says so** — there is no default branch that means success.
 *   - 422 is treated exactly like 409, so if GitHub answers a stale write with
 *     the other one, the result is still "read it again", never "done".
 *   - After a write, the version this device carries forward is the one the
 *     response gave back. If the response does not carry one, that is a
 *     refusal, not a shrug — a device that kept a version GitHub did not
 *     confirm would send a stale write next time and be refused anyway.
 *
 * ## The token
 *
 * A fine-grained personal access token, scoped to that one repository, with
 * contents read and write and nothing else. Sam types it once and it is kept in
 * `localStorage` on his own device.
 *
 * What that protects: the token cannot touch any other repository, cannot open
 * issues, cannot read his other code, and can be revoked in one click on
 * github.com without touching anything else.
 *
 * **What it does not protect, said plainly because a screen has to say it too:
 * anyone who can use his unlocked device can read that token.** `localStorage`
 * is not a keychain and this app is not going to pretend it is one. That is why
 * the scoping matters — the worst case is one repository holding grants,
 * takings and typed notes, and no contractor's work is in it because
 * `owner.ts` does not let any in.
 *
 * The token goes in an `Authorization` header and nowhere else. Never in a URL,
 * never in the file, never in a log, and never in an error message: `refuse`
 * below checks every message this module produces against the stored token
 * before it throws, so that is a property of the code rather than a promise
 * about it.
 */

export class OwnerSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnerSyncError';
  }
}

/** Where the token is kept. Its own key, so forgetting it forgets only it. */
export const TOKEN_KEY = 'trueline.owner.github.token.v1';
/** Which repository, which file. Not secret, and useful to see. */
export const WHERE_KEY = 'trueline.owner.github.where.v1';

/** Which repository the books are in, and what this device calls itself. */
export interface Where {
  readonly owner: string;
  readonly repo: string;
  /** The file inside it, e.g. `books.json`. */
  readonly path: string;
  readonly branch: string;
  /**
   * What Sam calls this device — "the office Mac", "the iPhone". It goes in the
   * file and in the commit message so the history reads like one. It is his
   * word about his own device and nothing is decided from it.
   */
  readonly device: string;
}

function store(): Storage {
  // Read through a function rather than captured at module load, because a
  // browser with site data blocked throws on the property itself rather than on
  // the call, and that failure should reach the person as a sentence.
  try {
    return globalThis.localStorage;
  } catch {
    throw new OwnerSyncError(
      'This browser will not let the app keep anything on this device, so there is nowhere ' +
        'to put the token. Turn site data back on for this app, or use a browser that allows it.'
    );
  }
}

/**
 * The message, with the token taken out of it if it ever got in.
 *
 * It should never get in — nothing here interpolates it. This is the check that
 * the "never" is true, rather than a comment claiming it is, and it runs on
 * every message this module throws, including the ones that came back from
 * `fetch` and were written by somebody else.
 */
function refuse(message: string): never {
  let safe = message;
  try {
    const token = store().getItem(TOKEN_KEY);
    if (token !== null && token !== '' && safe.includes(token)) {
      safe = safe.split(token).join('[the token]');
    }
  } catch {
    // No storage means no token to leak. The message goes out as it is.
  }
  throw new OwnerSyncError(safe);
}

export function keepToken(token: string): void {
  const clean = token.trim();
  if (clean === '') {
    refuse('That is an empty token. Nothing has been saved.');
  }
  store().setItem(TOKEN_KEY, clean);
}

/** Whether there is a token on this device. Never the token itself. */
export function haveToken(): boolean {
  const token = store().getItem(TOKEN_KEY);
  return token !== null && token.trim() !== '';
}

/** Takes the token off this device. The one on github.com is unaffected. */
export function forgetToken(): void {
  store().removeItem(TOKEN_KEY);
}

export function keepWhere(where: Where): void {
  for (const [field, value] of Object.entries(where)) {
    if (value.trim() === '') {
      refuse(`The books cannot be synced without a ${field}. Nothing has been saved.`);
    }
  }
  store().setItem(WHERE_KEY, JSON.stringify(where));
}

/** Where the books are, or null if this device has not been told yet. */
export function where(): Where | null {
  const raw = store().getItem(WHERE_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const it = parsed as Record<string, unknown>;
  const fields = ['owner', 'repo', 'path', 'branch', 'device'] as const;
  for (const field of fields) {
    if (typeof it[field] !== 'string' || (it[field] as string).trim() === '') return null;
  }
  return {
    owner: it['owner'] as string,
    repo: it['repo'] as string,
    path: it['path'] as string,
    branch: it['branch'] as string,
    device: it['device'] as string,
  };
}

function settings(): { readonly token: string; readonly at: Where } {
  const token = store().getItem(TOKEN_KEY);
  if (token === null || token.trim() === '') {
    refuse(
      'There is no token on this device, so the books cannot be reached. Paste a fine-grained ' +
        'GitHub token — scoped to the one private repository, contents read and write — into ' +
        'the box above. It is kept on this device only.'
    );
  }
  const at = where();
  if (at === null) {
    refuse('This device has not been told which repository the books are in.');
  }
  return { token: token.trim(), at };
}

/* --------------------------------------------------------------- base64 */

// The contents API carries the file as base64 and `btoa` only speaks Latin-1,
// so the text goes through UTF-8 first. Same pair as `sheet.ts` uses on the
// drawing, and it matters here for the same reason: the books hold names Sam
// typed, and a curly apostrophe in one of them must survive the round trip.
function toBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function fromBase64(value: string): string {
  // GitHub wraps the base64 it returns at a fixed width, so what comes back has
  // newlines through it. The whitespace is stripped here explicitly rather than
  // left to `atob`. `atob` does strip it -- that is forgiving-base64 decode, and
  // it was checked on this Node -- but the strip is one line and it is the
  // difference between this working everywhere and this working wherever that
  // happens to hold.
  return decodeURIComponent(escape(atob(value.replace(/\s+/g, ''))));
}

/* ------------------------------------------------------------ the calls */

const API = 'https://api.github.com';

function url(at: Where): string {
  const path = at.path
    .split('/')
    .filter((part) => part !== '')
    .map(encodeURIComponent)
    .join('/');
  return `${API}/repos/${encodeURIComponent(at.owner)}/${encodeURIComponent(at.repo)}/contents/${path}`;
}

async function call(
  address: string,
  token: string,
  init: RequestInit = {}
): Promise<{ readonly status: number; readonly body: unknown }> {
  let answer: Response;
  try {
    answer = await fetch(address, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
    });
  } catch (error) {
    // The one failure that is not GitHub's answer at all. A phone in a basement
    // and a token that has been revoked look nothing alike, and saying "could
    // not be reached" about a revoked token would send somebody looking for
    // signal for an hour.
    refuse(
      `GitHub could not be reached, so the books were not read and nothing was written. ` +
        `Check the connection and try again. (${error instanceof Error ? error.message : String(error)})`
    );
  }

  const raw = await answer.text();
  let body: unknown = null;
  if (raw !== '') {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  return { status: answer.status, body };
}

function saidMissing(at: Where): never {
  refuse(
    `GitHub will not show this token the repository ${at.owner}/${at.repo}. It answers the ` +
      `same way whether the repository does not exist or the token is simply not scoped to ` +
      `it — on purpose, so a token cannot be used to find out which private repositories ` +
      `somebody has — so both are worth checking: the spelling of the owner and repository, ` +
      `and that this repository is listed under the token's own repository access. Nothing ` +
      `has been read and nothing written.`
  );
}

interface Fetched {
  readonly text: string;
  readonly version: string;
}

/**
 * Reads the file, or says it is not there.
 *
 * Null means the repository is there and the file is not in it yet — the first
 * sync from a new setup, which is not a failure. Everything else throws.
 *
 * ## Why a 404 is asked a second question
 *
 * GitHub answers 404 to a file that does not exist, to a repository that does
 * not exist, and to a private repository this token is not scoped to. That is
 * deliberate on GitHub's part: answering anything else would let somebody use a
 * token to find out which private repositories a person has.
 *
 * The three matter very differently here. The first is the ordinary first-run
 * state. The other two mean Sam has mistyped the repository or left it off the
 * token, and treating those as "no books yet" would show him an empty dashboard
 * that looks like a fresh start rather than a mistake — and the next sync would
 * cheerfully try to create the file. So a 404 on the file asks the repository
 * itself, which answers 200 when the token can see it, and only then is the
 * missing file taken at face value.
 */
async function read(at: Where, token: string): Promise<Fetched | null> {
  const { status, body } = await call(
    `${url(at)}?ref=${encodeURIComponent(at.branch)}`,
    token,
    { method: 'GET' }
  );
  const outcome = readOutcome(status);

  if (outcome === 'not there') {
    const repo = await call(
      `${API}/repos/${encodeURIComponent(at.owner)}/${encodeURIComponent(at.repo)}`,
      token,
      { method: 'GET' }
    );
    if (readOutcome(repo.status) !== 'here') saidMissing(at);
    return null;
  }
  if (outcome === 'the token was refused') {
    refuse(
      'GitHub refused the token. It has probably expired or been revoked — fine-grained ' +
        'tokens have an expiry date. Make a new one and paste it in; nothing on either side ' +
        'has been changed.'
    );
  }
  if (outcome === 'the token is not allowed to') {
    refuse(
      `GitHub accepted the token and would not let it read ${at.owner}/${at.repo}. Check that ` +
        `the token lists this repository, and that its Contents permission is at least ` +
        `read-only.`
    );
  }
  if (outcome === 'github is having trouble') {
    refuse(`GitHub answered ${status}. That is its end, not this one. Nothing was written.`);
  }
  if (outcome === 'unexpected') {
    refuse(
      `GitHub answered ${status}, which this app does not know how to read. Nothing was ` +
        `written. It is being refused rather than guessed at.`
    );
  }

  const it = body as Record<string, unknown> | null;
  if (it === null || typeof it['sha'] !== 'string') {
    refuse('GitHub answered without saying which version of the file it gave back.');
  }
  const encoding = it['encoding'];
  const content = it['content'];
  if (encoding !== 'base64' || typeof content !== 'string') {
    // The documented behaviour above one megabyte: the file is described but
    // its content is not sent. Refused loudly, because the quiet version of
    // this is reading an empty book, merging nothing into it, and writing that
    // back over the top of everything.
    refuse(
      `GitHub described the books but did not send them, which is what it does for a file ` +
        `over a megabyte. Nothing has been read and nothing written — an empty read here ` +
        `would be written back as an empty book.`
    );
  }

  let text: string;
  try {
    text = fromBase64(content);
  } catch {
    refuse('What GitHub sent back could not be decoded. Nothing has been written.');
  }
  return { text, version: it['sha'] };
}

export type SyncResult =
  | {
      readonly what: 'written';
      readonly books: Books;
      readonly brought: Brought;
      readonly version: string;
      readonly says: string;
    }
  | { readonly what: 'nothing to do'; readonly books: Books; readonly says: string }
  | { readonly what: 'conflict'; readonly conflicts: readonly Conflict[]; readonly says: string };

/**
 * The books as they are in the repository, without changing anything.
 *
 * For opening the dashboard on a device that has just been set up: read what is
 * there and show it. A missing file is an empty set of books rather than an
 * error, because a repository that has never been synced to is the ordinary
 * first state.
 */
export async function fetchBooks(): Promise<Books | null> {
  const { token, at } = settings();
  const there = await read(at, token);
  if (there === null) return null;
  try {
    return readBooksFile(there.text).books;
  } catch (error) {
    refuse(error instanceof BooksSyncError ? error.message : String(error));
  }
}

/**
 * How many times a sync will read, merge and write before giving up.
 *
 * Two, and the reason for the number is worth stating. One means the ordinary
 * case — the other device happened to write in the second between this one
 * reading and writing — is reported to Sam as a failure he has to press a
 * button about, which is a poor answer to a problem the machine can solve.
 * Unbounded means two devices on a timer can hold each other off for as long as
 * they both keep trying, and the app would sit there saying nothing.
 *
 * So: try, and if somebody wrote first, read what they wrote, merge it in
 * properly and try once more. If that is also beaten, say so and stop. Every
 * attempt is a full read and a full merge — nothing is retried blind.
 */
const TRIES = 2;

/**
 * Reads what is in the repository, merges it with what is on this device, and
 * writes the result back — or reports a conflict and writes nothing.
 */
export async function syncBooks(here: Books, now: Date): Promise<SyncResult> {
  const { token, at } = settings();

  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    const there = await read(at, token);

    let plan;
    try {
      plan = planSync(here, there, now.toISOString(), at.device);
    } catch (error) {
      refuse(error instanceof BooksSyncError ? error.message : String(error));
    }

    if (plan.what === 'conflict') {
      return { what: 'conflict', conflicts: plan.conflicts, says: plan.says };
    }
    if (plan.what === 'nothing to do') {
      return { what: 'nothing to do', books: plan.books, says: plan.says };
    }

    const { status, body } = await call(url(at), token, {
      method: 'PUT',
      body: JSON.stringify({
        message: `The books, from ${at.device}`,
        content: toBase64(plan.file),
        branch: at.branch,
        // Absent, not null, when the file is not there yet. GitHub reads a
        // `sha` as "replace exactly this version"; sending one for a file that
        // does not exist, or none for one that does, is refused, and both of
        // those refusals are the protection working rather than a fault.
        ...(plan.onto === null ? {} : { sha: plan.onto }),
      }),
    });

    const outcome = writeOutcome(status);

    if (outcome === 'somebody else wrote first') {
      if (attempt < TRIES) continue;
      refuse(
        `Another device wrote to the books twice while this one was syncing, so this sync ` +
          `stopped rather than keep trying. Nothing has been lost — what is on this device is ` +
          `still on it. Sync again in a moment.`
      );
    }
    if (outcome === 'the token was refused') {
      refuse(
        'GitHub refused the token when it came to write. Nothing was written. Make a new ' +
          'fine-grained token and paste it in.'
      );
    }
    if (outcome === 'the token is not allowed to') {
      refuse(
        `The token can read ${at.owner}/${at.repo} and may not write to it. Nothing was ` +
          `written. Its Contents permission needs to be read and write, not read-only.`
      );
    }
    if (outcome === 'github is having trouble') {
      refuse(`GitHub answered ${status} to the write. Nothing was written. Try again shortly.`);
    }
    if (outcome === 'unexpected') {
      refuse(
        `GitHub answered ${status} to the write, which this app does not know how to read. It ` +
          `is treated as not written, because the alternative is telling Sam his books are ` +
          `saved when nobody knows whether they are.`
      );
    }

    const wrote = body as Record<string, unknown> | null;
    const content = wrote === null ? null : (wrote['content'] as Record<string, unknown> | null);
    const version = content === null || content === undefined ? undefined : content['sha'];
    if (typeof version !== 'string' || version === '') {
      refuse(
        `GitHub answered ${status} to the write but did not say which version it wrote. The ` +
          `write may well have gone through; this device is not keeping a version GitHub did ` +
          `not confirm, because a stale one is how the next sync loses something. Read the ` +
          `books again.`
      );
    }

    return {
      what: 'written',
      books: plan.merged,
      brought: plan.brought,
      version,
      says: plan.says,
    };
  }

  // Unreachable: the loop either returns or refuses on its last attempt. It is
  // here because a function that can fall off the end is a function that can
  // return undefined to a caller expecting books.
  refuse('The sync ended without an answer. Nothing was written.');
}
