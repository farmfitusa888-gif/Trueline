import { decode, encode } from './persist.ts';
import { type Cents, type PriceUnit, type Rate } from './price.ts';
import { RoomError } from './room.ts';

/**
 * The stores a contractor actually buys at, and what each one charged him.
 *
 * > "AND WHAT ABOUT THE VENDOR PRICES? … CANT WE USE LIVE ONLINE PRICES …
 * >  BUILD IT OUT THE WAY I WANT"
 *
 * ## Why this is a separate book from `price.ts`
 *
 * The rate book is **what he charges**. This is **what a store charged him**,
 * and the two are not the same number and must never be stored as though they
 * were. Copying a shelf price into the rate book without a mark-up is how a
 * remodeler works a season for nothing, so a price moves from here to there on
 * a deliberate tap and the screen says what it is doing.
 *
 * And a store is a book, not a column. Floor & Decor and the lumber yard down
 * the road quote different numbers for the same word, on different days. One
 * mixed list of "material prices" cannot answer "what does tile cost at Floor
 * & Decor", which is the only question a contractor standing in a kitchen
 * actually has. So a sighting carries **which store, what evidence, and what
 * day** — all three, always. A price with no date is not a price.
 *
 * ## Where the numbers come from, and the one place they never come from
 *
 * Three, and there is no fourth:
 *
 *   - **A price list the store sent.** `pricelist.ts` reads the CSV; a store
 *     name and a file name come with every row.
 *   - **A photograph of the shelf tag.** The contractor is standing in the
 *     aisle. He photographs the tag and types the number he can see. **The
 *     photograph is evidence, never a source** — nothing read off it by any
 *     machine goes in the book unconfirmed, which is why `Evidence` carries who
 *     confirmed it and `recordPrice` refuses a tag with no photograph.
 *   - **The counter.** A number off a written quote, typed, with his name on it.
 *
 * There is no retailer price feed here and no scraper, because there is no
 * public price API at Home Depot, Lowe's or Floor & Decor to build against and
 * scraping one breaks the week its markup changes. What this refuses to do is
 * the feature: **no number in here was estimated, averaged, indexed or
 * inferred.** Every one of them was seen, at a named store, on a stated day, by
 * a person who typed it.
 *
 * ## What it can say that no feed could
 *
 * Because every sighting is kept rather than overwritten, the book knows what
 * *this* store charged *this* contractor last time. "Up 8.2% since 12 March, at
 * Miller Lumber" is arithmetic on two numbers he wrote down himself. It costs
 * nothing, it needs no account, and it cannot go stale in a way he cannot see.
 *
 * Money is `bigint` cents throughout, exactly like the ledger. The only
 * floating-point arithmetic in this file is counting days between two dates,
 * which is not money and is marked where it happens.
 */

export class VendorError extends RoomError {}

/**
 * A store, identified by what the contractor calls it.
 *
 * The name **is** the identity, deliberately. A random id would let "Floor &
 * Decor" be typed twice and become two books that each hold half the answer,
 * and the person would have no way of seeing why. Two stores he genuinely
 * wants apart get two names — "Miller Lumber" and "Miller Lumber, Route 9" —
 * which is what he would write on a purchase order anyway.
 */
export interface Store {
  /** Slug of the name. Stable, so the same store on a second device merges. */
  readonly id: string;
  readonly name: string;
}

/**
 * How a price got into the book. There is no `guessed` and there never will be.
 *
 * `by` is a person's name on all three, because every one of these numbers was
 * typed by somebody who could see it. That is the whole difference between this
 * and a price feed.
 */
export type Evidence =
  /** A CSV the store sent, imported through `pricelist.ts`. */
  | { readonly kind: 'list'; readonly file: string; readonly by: string }
  /**
   * A photograph of the shelf tag, and the number the contractor read off it.
   *
   * `photo` is the *name* of the picture, never its bytes — the same rule
   * `photo.ts` and `photoStore.ts` already follow, for the same reason: a book
   * of prices that carried JPEGs would not fit in the storage it lives in.
   */
  | { readonly kind: 'tag'; readonly photo: string; readonly by: string }
  /** Typed off a written quote or told across the counter. */
  | { readonly kind: 'counter'; readonly by: string };

/** One price, at one store, on one day. Never edited — superseded. */
export interface Sighting {
  readonly storeId: string;
  readonly item: string;
  readonly unit: PriceUnit;
  readonly cents: Cents;
  /** ISO. The day is the identity: one sighting per item per store per day. */
  readonly seenAt: string;
  readonly evidence: Evidence;
  /** The store's own code for it, so it can be found again on their system. */
  readonly code?: string;
  /** Whatever the store calls its aisle. Only ever read off the data. */
  readonly category?: string;
  /** The arithmetic, when the price was worked out rather than read. */
  readonly note?: string;
}

export interface VendorBook {
  readonly stores: readonly Store[];
  readonly sightings: readonly Sighting[];
}

export const NO_STORES: VendorBook = { stores: [], sightings: [] };

/** How old a price has to be before the screen calls it out. */
export const STALE_DAYS = 90;

/* --------------------------------------------------------------- the stores */

/**
 * A store's id from its name: lower case, letters and digits, dashes between.
 *
 * Deterministic on purpose. "Floor & Decor" typed here and "floor & decor"
 * typed on a phone are the same store, and a contractor who has to keep his
 * capitalisation consistent to keep his prices together has a bug, not a book.
 */
export function storeId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function storeById(book: VendorBook, id: string): Store | undefined {
  return book.stores.find((store) => store.id === id);
}

/** Adds a store, or refuses. Never silently does nothing. */
export function addStore(book: VendorBook, name: string): VendorBook {
  const trimmed = name.trim();
  if (trimmed === '') throw new VendorError('A store needs a name before it can hold prices.');
  const id = storeId(trimmed);
  if (id === '') {
    throw new VendorError(
      `"${trimmed}" has no letters or numbers in it, so there is nothing to file its prices under.`
    );
  }
  const had = storeById(book, id);
  if (had) {
    throw new VendorError(
      `You already have a store called "${had.name}". Two books under one name is one book with ` +
        `a mistake in it — if these are genuinely two branches, give the second one its own name.`
    );
  }
  return { ...book, stores: [...book.stores, { id, name: trimmed }] };
}

/**
 * Drops a store and every price that came from it.
 *
 * Its prices go with it, and the count comes back so the screen can say so
 * before the person is surprised by it. A sighting whose store is gone is a
 * price from nowhere, and a price from nowhere is exactly what this file exists
 * to make impossible.
 */
export function removeStore(
  book: VendorBook,
  id: string
): { readonly book: VendorBook; readonly dropped: number } {
  const kept = book.sightings.filter((s) => s.storeId !== id);
  return {
    book: { stores: book.stores.filter((store) => store.id !== id), sightings: kept },
    dropped: book.sightings.length - kept.length,
  };
}

/* -------------------------------------------------------------- the prices */

/** The day part of an ISO timestamp. The identity of a sighting. */
function dayOf(at: string): string {
  return at.slice(0, 10);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/**
 * Records what a store charged, or refuses and says why.
 *
 * `now` is passed in rather than read off a clock so that a re-import of the
 * same file is not a change, and so a test can check one. Refusing a date in
 * the future is not pedantry: a price "seen" tomorrow would sit permanently at
 * the top of a list of what things cost, and would never go stale.
 */
export function recordPrice(book: VendorBook, sighting: Sighting, now: string): VendorBook {
  const store = storeById(book, sighting.storeId);
  if (!store) {
    throw new VendorError(
      `There is no store in your list to file that under. Add the store first, so every price ` +
        `in the book says where it came from.`
    );
  }
  const item = sighting.item.trim();
  if (item === '') throw new VendorError('Say what it is before writing down what it costs.');
  if (sighting.cents <= 0n) {
    throw new VendorError(`A price of ${sighting.cents} is not a price.`);
  }
  if (!ISO_DAY.test(sighting.seenAt) || !Number.isFinite(Date.parse(sighting.seenAt))) {
    throw new VendorError(
      `"${sighting.seenAt}" is not a date. Every price in here says which day it was seen, ` +
        `because a price with no date is not a price.`
    );
  }
  if (dayOf(sighting.seenAt) > dayOf(now)) {
    throw new VendorError(
      `${dayOf(sighting.seenAt)} has not happened yet. A price can only be written down after ` +
        `somebody has seen it.`
    );
  }
  // The photograph is the evidence. Without it a "photographed tag" is just a
  // typed number wearing a better word, and the difference matters on the day
  // somebody asks where the figure came from.
  if (sighting.evidence.kind === 'tag' && sighting.evidence.photo.trim() === '') {
    throw new VendorError(
      'A photographed price tag needs the photograph. Without it this is a number somebody ' +
        'typed, which is fine — write it down as one.'
    );
  }
  if (sighting.evidence.by.trim() === '') {
    throw new VendorError('Every price in here carries the name of whoever wrote it down.');
  }

  const clean: Sighting = { ...sighting, item };
  // One sighting per store, per item, per unit, per day. Photographing the same
  // tag twice on the way round the shop is one price, not two, and re-importing
  // a list the store re-sent must not double the book.
  const rest = book.sightings.filter(
    (s) =>
      !(
        s.storeId === clean.storeId &&
        s.item === clean.item &&
        s.unit === clean.unit &&
        dayOf(s.seenAt) === dayOf(clean.seenAt)
      )
  );
  return { ...book, sightings: [...rest, clean] };
}

/**
 * A file's worth of sightings, in one pass.
 *
 * Every one of them goes through `recordPrice`, so a bulk import cannot put
 * anything in the book that a single one could not — the refusals are collected
 * with their reasons rather than thrown, because a list of four hundred rows
 * that stops dead on row nine is a list nobody imports.
 */
export function recordPrices(
  book: VendorBook,
  sightings: readonly Sighting[],
  now: string
): { readonly book: VendorBook; readonly refused: readonly { item: string; why: string }[] } {
  let next = book;
  const refused: { item: string; why: string }[] = [];
  for (const sighting of sightings) {
    try {
      next = recordPrice(next, sighting, now);
    } catch (error) {
      refused.push({
        item: sighting.item,
        why: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { book: next, refused };
}

/**
 * A name for a shelf-tag photograph that nothing else in the book is using.
 *
 * Counted rather than hashed off the item name, because a hash collides and a
 * collision here shows one price's tag against another price's number — which
 * is the single worst thing this feature could do. Counting cannot collide.
 */
export function photoNameFor(book: VendorBook): string {
  const taken = new Set(
    book.sightings.map((s) => (s.evidence.kind === 'tag' ? s.evidence.photo : ''))
  );
  let n = 1;
  while (taken.has(`shelf-${n}.jpg`)) n += 1;
  return `shelf-${n}.jpg`;
}

/** What a person reads where the price came from. */
export function whereFrom(evidence: Evidence): string {
  if (evidence.kind === 'list') return `from their price list, ${evidence.file}`;
  if (evidence.kind === 'tag') return `photographed on the shelf, confirmed by ${evidence.by}`;
  return `off the counter, written down by ${evidence.by}`;
}

/* ------------------------------------------------------------------- dates */

/**
 * Whole days between two ISO dates.
 *
 * The one place in this file that is not integer arithmetic, and it is a
 * duration rather than an amount of money. A day out on "seen three weeks ago"
 * costs nobody anything; a cent out on a price costs somebody a job.
 */
export function ageInDays(at: string, now: string): number {
  const then = Date.parse(dayOf(at));
  const today = Date.parse(dayOf(now));
  if (!Number.isFinite(then) || !Number.isFinite(today)) return 0;
  return Math.max(0, Math.round((today - then) / 86_400_000));
}

/** How old, in the words somebody would actually say. */
export function howOld(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 30) return `${days} days ago`;
  if (days <= 365) return `about ${Math.round(days / 30)} months ago`;
  return 'over a year ago';
}

/* ---------------------------------------------------------- what is in there */

/**
 * One thing, at one store: the newest price and everything it replaced.
 *
 * The older sightings are kept rather than thrown away because they are the
 * only honest answer to "has this gone up". They are this contractor's own
 * observations at this store — not an index, not an average, not a forecast.
 */
export interface Listing {
  readonly store: Store;
  readonly price: Sighting;
  /** Everything seen before it, newest first. */
  readonly before: readonly Sighting[];
  /** How old the newest one is, in days. */
  readonly days: number;
}

export interface Filter {
  /** Empty means every store. */
  readonly store: string;
  readonly query: string;
  /** Chips that are on, as `group:value`. */
  readonly chips: readonly string[];
}

export const NO_FILTER: Filter = { store: '', query: '', chips: [] };

/** Newest first, so `[0]` is what the store charges now. */
function newestFirst(a: Sighting, b: Sighting): number {
  return a.seenAt === b.seenAt ? 0 : a.seenAt < b.seenAt ? 1 : -1;
}

/**
 * Everything the book holds, one row per thing per store, newest price first.
 *
 * Unfiltered. `listings` is this narrowed by the dropdown, the search bar and
 * the chips; the counts behind the chips need the same rows, so it is worked
 * out once here.
 */
function everything(book: VendorBook, now: string): Listing[] {
  const grouped = new Map<string, Sighting[]>();
  for (const sighting of book.sightings) {
    const key = `${sighting.storeId}|${sighting.item}|${sighting.unit}`;
    const found = grouped.get(key);
    if (found) found.push(sighting);
    else grouped.set(key, [sighting]);
  }

  const out: Listing[] = [];
  for (const group of grouped.values()) {
    const sorted = [...group].sort(newestFirst);
    const price = sorted[0]!;
    const store = storeById(book, price.storeId);
    // A price whose store has been deleted is a price from nowhere. It is left
    // out rather than shown against a blank name, which would be the app
    // showing a number as a store's price when it cannot say which store.
    if (!store) continue;
    out.push({ store, price, before: sorted.slice(1), days: ageInDays(price.seenAt, now) });
  }
  return out.sort((a, b) =>
    a.price.item === b.price.item
      ? a.store.name.localeCompare(b.store.name)
      : a.price.item.localeCompare(b.price.item)
  );
}

/**
 * Whether a listing answers what somebody typed in the search bar.
 *
 * Every word has to appear somewhere — in the name, the store's code for it, or
 * its category. AND rather than OR, because "1/2 drywall" typed into a bar that
 * ORs returns every screw with a 1/2 in it and the feature is dead on the first
 * use.
 */
function found(listing: Listing, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return true;
  const haystack = [
    listing.price.item,
    listing.price.code ?? '',
    listing.price.category ?? '',
    listing.store.name,
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** The chip groups, in the order they are shown. */
export type ChipGroup = 'unit' | 'category' | 'from' | 'age';

export interface Chip {
  readonly group: ChipGroup;
  /** `group:value`, which is what goes in `Filter.chips`. */
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

const FROM_LABEL: Readonly<Record<Evidence['kind'], string>> = {
  list: 'Price list',
  tag: 'Shelf tag',
  counter: 'Counter',
};

/** Which chips one listing would answer to, by group. */
function facets(listing: Listing): { group: ChipGroup; value: string; label: string }[] {
  const out: { group: ChipGroup; value: string; label: string }[] = [
    { group: 'unit', value: listing.price.unit, label: `Per ${listing.price.unit}` },
    {
      group: 'from',
      value: listing.price.evidence.kind,
      label: FROM_LABEL[listing.price.evidence.kind],
    },
  ];
  const category = (listing.price.category ?? '').trim();
  // Only ever off the data. A category nothing carries is not offered, because
  // an empty filter chip is a promise the book cannot keep.
  if (category !== '') out.push({ group: 'category', value: category, label: category });
  if (listing.days > STALE_DAYS) {
    out.push({ group: 'age', value: 'old', label: `Older than ${STALE_DAYS} days` });
  }
  return out;
}

function passes(listing: Listing, chips: readonly string[], skip?: ChipGroup): boolean {
  const mine = facets(listing).map((f) => `${f.group}:${f.value}`);
  const byGroup = new Map<string, string[]>();
  for (const chip of chips) {
    const group = chip.slice(0, chip.indexOf(':'));
    if (group === skip) continue;
    const found_ = byGroup.get(group);
    if (found_) found_.push(chip);
    else byGroup.set(group, [chip]);
  }
  // OR inside a group, AND across groups. Two units means "either"; a unit and
  // a category means "both", which is what a person means by tapping them.
  for (const wanted of byGroup.values()) {
    if (!wanted.some((chip) => mine.includes(chip))) return false;
  }
  return true;
}

/** What the catalogue shows, after the dropdown, the bar and the chips. */
export function listings(book: VendorBook, filter: Filter, now: string): Listing[] {
  return everything(book, now).filter(
    (listing) =>
      (filter.store === '' || listing.store.id === filter.store) &&
      found(listing, filter.query) &&
      passes(listing, filter.chips)
  );
}

/**
 * The chips to offer, and the true number behind each.
 *
 * A chip's count is worked out against everything else that is switched on
 * **except its own group**, which is how a faceted list has to count: a chip
 * reading "12" that produces nothing when tapped is the screen lying about its
 * own contents, and this is a product whose whole argument is that it does not.
 *
 * Chips with nothing behind them are not offered at all.
 */
export function chipsFor(book: VendorBook, filter: Filter, now: string): Chip[] {
  const all = everything(book, now).filter(
    (listing) => filter.store === '' || listing.store.id === filter.store
  );
  const counted = new Map<string, Chip>();
  for (const group of ['unit', 'category', 'from', 'age'] as const) {
    for (const listing of all) {
      if (!found(listing, filter.query)) continue;
      if (!passes(listing, filter.chips, group)) continue;
      for (const facet of facets(listing)) {
        if (facet.group !== group) continue;
        const id = `${facet.group}:${facet.value}`;
        const had = counted.get(id);
        counted.set(id, {
          group: facet.group,
          id,
          label: facet.label,
          count: (had?.count ?? 0) + 1,
        });
      }
    }
  }
  const order: Readonly<Record<ChipGroup, number>> = { unit: 0, category: 1, from: 2, age: 3 };
  return [...counted.values()].sort(
    (a, b) =>
      order[a.group] - order[b.group] || b.count - a.count || a.label.localeCompare(b.label)
  );
}

/**
 * The same thing at every store that has quoted it, cheapest first.
 *
 * Only stores that actually quoted it. A store with no price for this item does
 * not appear at all — it does not appear with a blank, or with somebody else's
 * number, or with an average of the others.
 */
export function acrossStores(
  book: VendorBook,
  item: string,
  unit: PriceUnit,
  now: string
): Listing[] {
  return everything(book, now)
    .filter((listing) => listing.price.item === item && listing.price.unit === unit)
    .sort((a, b) => (a.price.cents === b.price.cents ? 0 : a.price.cents < b.price.cents ? -1 : 1));
}

/* ------------------------------------------------------------ what it did */

export interface Movement {
  readonly was: Cents;
  readonly now: Cents;
  /** The change, in basis points. 820 is up 8.2%. */
  readonly basisPoints: number;
  /** Days between the two sightings. */
  readonly days: number;
  readonly wasSeenAt: string;
}

/**
 * What this store's price for this thing has done since he last looked.
 *
 * Two numbers he wrote down himself, subtracted. Nothing here is an index, a
 * regional average or a forecast, and nothing here needs a network — which is
 * why it works in a basement and cannot be wrong about a store it has never
 * seen. `null` when there is only one sighting: one price is not a trend, and
 * saying so is better than drawing a line through a single point.
 */
export function movement(listing: Listing): Movement | null {
  const before = listing.before[0];
  if (!before || before.cents <= 0n) return null;
  const raw = (listing.price.cents - before.cents) * 10_000n;
  // Rounded half away from zero, once, exactly like every other derived figure
  // in this codebase.
  const points =
    raw < 0n ? (raw - before.cents / 2n) / before.cents : (raw + before.cents / 2n) / before.cents;
  return {
    was: before.cents,
    now: listing.price.cents,
    basisPoints: Number(points),
    days: ageInDays(before.seenAt, listing.price.seenAt),
    wasSeenAt: before.seenAt,
  };
}

/** Basis points as a person reads them. `820` becomes `up 8.2%`. */
export function percent(basisPoints: number): string {
  const tenths = Math.round(Math.abs(basisPoints) / 10);
  if (tenths === 0) return 'no change';
  const shown = `${Math.trunc(tenths / 10)}.${tenths % 10}%`;
  return `${basisPoints < 0 ? 'down' : 'up'} ${shown}`;
}

/* -------------------------------------------------- into the contractor's book */

/**
 * A store's price, as a rate in the contractor's own book.
 *
 * **This is what the store charges him, not what he charges.** Nothing here
 * adds a mark-up, because inventing somebody's margin is exactly the kind of
 * number this product does not produce — the whole-job mark-up in the rate book
 * is his to set. The screen that offers this button says so.
 *
 * The rate is dated **when the price was seen**, not when the button was
 * pressed. A tag photographed in March is a March price whatever day it is
 * copied across, and dating it today would quietly make a stale rate look
 * fresh — which is the one thing a rate's date is for.
 */
export function asRate(listing: Listing): Rate {
  const { price, store } = listing;
  const note = [
    price.code === undefined || price.code.trim() === '' ? '' : `their code ${price.code.trim()}`,
    price.category === undefined || price.category.trim() === '' ? '' : price.category.trim(),
    price.note ?? '',
  ]
    .filter((part) => part !== '')
    .join(' · ');
  return {
    item: price.item,
    unit: price.unit,
    cents: price.cents,
    source: { kind: 'typed', by: `${store.name} — ${whereFrom(price.evidence)}`, at: price.seenAt },
    ...(note === '' ? {} : { note }),
  };
}

/* ------------------------------------------------------------------ storage */

/** The book, as text. `encode` rather than `JSON.stringify`: money is bigint. */
export function writeVendorBook(book: VendorBook): string {
  return encode(book);
}

/**
 * The book back, field by field, or an empty one.
 *
 * Shape-checked rather than trusted, exactly like the profile is in
 * `units.tsx`, and for the same reason: a price whose `cents` came back as an
 * object instead of a bigint would print `$NaN` against a store's name, which
 * is this feature telling a lie about a shop. A sighting that does not hold
 * what a sighting holds is dropped and the rest are kept.
 */
export function readVendorBook(text: string | null): VendorBook {
  try {
    if (!text) return NO_STORES;
    const raw = decode(text) as Partial<VendorBook>;
    const stores = Array.isArray(raw.stores)
      ? raw.stores.filter(isStore).map((store) => ({ id: store.id, name: store.name }))
      : [];
    const known = new Set(stores.map((store) => store.id));
    const sightings = Array.isArray(raw.sightings)
      ? raw.sightings.filter(isSighting).filter((s) => known.has(s.storeId))
      : [];
    return { stores, sightings };
  } catch {
    return NO_STORES;
  }
}

function isStore(value: unknown): value is Store {
  if (typeof value !== 'object' || value === null) return false;
  const store = value as Partial<Store>;
  return typeof store.id === 'string' && store.id !== '' && typeof store.name === 'string';
}

function isEvidence(value: unknown): value is Evidence {
  if (typeof value !== 'object' || value === null) return false;
  const evidence = value as { kind?: unknown; by?: unknown; file?: unknown; photo?: unknown };
  if (typeof evidence.by !== 'string') return false;
  if (evidence.kind === 'list') return typeof evidence.file === 'string';
  if (evidence.kind === 'tag') return typeof evidence.photo === 'string';
  return evidence.kind === 'counter';
}

function isSighting(value: unknown): value is Sighting {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<Sighting>;
  return (
    typeof s.storeId === 'string' &&
    typeof s.item === 'string' &&
    s.item !== '' &&
    (s.unit === 'sq ft' || s.unit === 'lf' || s.unit === 'ea') &&
    typeof s.cents === 'bigint' &&
    s.cents > 0n &&
    typeof s.seenAt === 'string' &&
    ISO_DAY.test(s.seenAt) &&
    isEvidence(s.evidence)
  );
}
