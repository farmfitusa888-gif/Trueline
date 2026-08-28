import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  type Chip,
  type Listing,
  type Sighting,
  type VendorBook,
  NO_FILTER,
  NO_STORES,
  STALE_DAYS,
  acrossStores,
  addStore,
  asRate,
  chipsFor,
  howOld,
  listings,
  movement,
  percent,
  photoNameFor,
  readVendorBook,
  recordPrice,
  removeStore,
  storeById,
  whereFrom,
  writeVendorBook,
} from '../../core/src/vendor.ts';
import { type PriceUnit, money, parseMoney } from '../../core/src/price.ts';
import { pricing } from '../../core/src/company.ts';
import { fetchPhoto, forget, keep, readied } from './photoStore.ts';
import { Disclosure } from './Disclosure.tsx';
import { useUnits } from './units.tsx';

/**
 * The stores you buy at, on the screen.
 *
 * > "AND WHAT ABOUT THE VENDOR PRICES? … CANT WE USE LIVE ONLINE PRICES …
 * >  BUILD IT OUT THE WAY I WANT"
 *
 * A store dropdown, a search bar and chips, over a book of prices that were
 * each **seen at a named shop on a stated day by a person who typed them**.
 *
 * ## Why there is no "live prices" button on this screen
 *
 * Because there is nothing honest to put behind one. Home Depot, Lowe's and
 * Floor & Decor publish no public price API; their affiliate programmes carry
 * product feeds but they are behind an application and an approval, they are
 * consumer catalogue data rather than a contractor's own negotiated pricing,
 * and none of them is a thing this app may sign somebody up for on his behalf.
 * Scraping the sites breaks their terms and breaks the week the markup changes.
 *
 * So the three ways a price gets in here are the three ways a contractor
 * actually finds one out: **the list the yard emailed him, the tag on the
 * shelf, and the number across the counter.** The shelf tag is the one that
 * works everywhere, costs nothing and never breaks — he photographs it and
 * types what he can see. The photograph is evidence. It is never the source.
 *
 * ## What this screen must never do
 *
 * Show a number as a store's price unless it came from that store. There is no
 * average across shops, no "typical" price, no fallback to another branch when
 * a feed is quiet. A store with no price for a thing is silent about it, and a
 * price nobody has looked at since March says so on its own line.
 */

/* ------------------------------------------------------------------ the store */

const KEY = 'trueline.vendors.v1';

/**
 * The book, once, for every screen showing it.
 *
 * Module-level rather than a hook's own state because the Business tab shows
 * the stores in one section and the catalogue in another, and two copies of
 * this would drift the moment somebody added a price in one of them. The
 * snapshot is cached so `useSyncExternalStore` gets a stable reference and does
 * not re-render for ever.
 */
let held: VendorBook | null = null;
const watching = new Set<() => void>();

function snapshot(): VendorBook {
  if (held) return held;
  try {
    held = readVendorBook(window.localStorage.getItem(KEY));
  } catch {
    // A browser with storage switched off still gets a working screen; what it
    // does not get is yesterday's prices, and the screen says so when a save
    // fails rather than pretending one happened.
    held = NO_STORES;
  }
  return held;
}

function watch(listener: () => void): () => void {
  watching.add(listener);
  return () => {
    watching.delete(listener);
  };
}

/** True when it is actually written down. False is shown, never swallowed. */
function put(next: VendorBook): boolean {
  held = next;
  let kept = true;
  try {
    window.localStorage.setItem(KEY, writeVendorBook(next));
  } catch {
    kept = false;
  }
  for (const listener of watching) listener();
  return kept;
}

export function useVendorBook(): {
  readonly book: VendorBook;
  readonly save: (next: VendorBook) => boolean;
} {
  const book = useSyncExternalStore(watch, snapshot, () => NO_STORES);
  return { book, save: put };
}

/** Today, as the date box writes it. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ the stores */

/**
 * Adding the shops, and writing down a price seen in one of them.
 *
 * Lives beside the price-list importer on the Business tab, because both
 * answer the same question — where do the numbers come from — and neither of
 * them belongs to a job.
 */
export function Stores() {
  const { book, save } = useVendorBook();
  const [name, setName] = useState('');
  const [trouble, setTrouble] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [told, setTold] = useState<string | null>(null);

  function add() {
    try {
      const next = addStore(book, name);
      if (!save(next)) {
        setTrouble('This browser would not keep that, so the store is only here until you close the tab.');
      } else {
        setTrouble(null);
      }
      setName('');
      setTold(null);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  }

  const countOf = (id: string) => book.sightings.filter((s) => s.storeId === id).length;

  return (
    <section className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3" data-sheet="no">
      {/* Sam: "WHEN YOU DROPDOWN ANY MENU, HAVE A WAY TO COLLAPSE THEM BACK."
          The shops, every price counted against each of them, the box that
          adds one and the whole shelf-tag form underneath were all on the
          screen at once, under a rate book somebody is usually here to change.
          The heading is still a heading, so `a26-vendor.mjs` still reaches
          this section by asking for it. */}
      <Disclosure
        heading="h3"
        title="The stores you buy at"
        summary={
          book.stores.length === 0
            ? 'No shops yet — open it to add the first one'
            : `${book.stores.length} shop${book.stores.length === 1 ? '' : 's'}, ` +
              `${book.sightings.length} price${book.sightings.length === 1 ? '' : 's'} between them`
        }
      >
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          One book per shop. Floor &amp; Decor and the yard down the road quote different numbers
          for the same word, so they are kept apart — and every price in here says which shop, and
          which day, and who wrote it down.
        </p>

        {book.stores.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-200">
            {book.stores.map((store) => (
              <li key={store.id} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-800">{store.name}</span>
                    <span className="block text-xs text-slate-500">
                      {countOf(store.id)} price{countOf(store.id) === 1 ? '' : 's'}
                    </span>
                  </span>
                  {asking === store.id ? (
                    <span className="flex shrink-0 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          const gone = removeStore(book, store.id);
                          // The pictures go with the prices. An orphaned JPEG in
                          // IndexedDB is a photograph nobody can ever see again,
                          // sitting in somebody's storage for good.
                          for (const s of book.sightings) {
                            if (s.storeId === store.id) void forgetTag(s);
                          }
                          save(gone.book);
                          setAsking(null);
                          setTold(
                            `Removed ${store.name} and the ${gone.dropped} price` +
                              `${gone.dropped === 1 ? '' : 's'} that came from it.`
                          );
                        }}
                        className="min-h-11 text-xs font-semibold text-red-700 underline underline-offset-4"
                      >
                        Yes, remove it
                      </button>
                      <button
                        type="button"
                        onClick={() => setAsking(null)}
                        className="min-h-11 text-xs text-slate-500 underline underline-offset-4"
                      >
                        Keep it
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAsking(store.id)}
                      aria-label={`Remove ${store.name}`}
                      className="min-h-11 shrink-0 text-xs text-slate-500 underline underline-offset-4"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {asking === store.id && (
                  <p className="mt-1 text-xs text-red-700">
                    This takes the {countOf(store.id)} price
                    {countOf(store.id) === 1 ? '' : 's'} from {store.name} with it. Your own rates
                    are not touched.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex items-end gap-2">
          <label className="block grow">
            <span className="text-xs font-medium text-slate-700">Add a store</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Floor &amp; Decor"
              aria-label="Add a store"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2
                         focus:border-sky-500 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={add}
            className="min-h-11 shrink-0 rounded-md bg-slate-900 px-4 font-semibold text-white
                       active:bg-slate-700"
          >
            Add it
          </button>
        </div>

        {told && <p className="mt-2 text-sm text-slate-600">{told}</p>}
        {trouble && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {trouble}
          </p>
        )}

        <ShelfTag />
      </Disclosure>
    </section>
  );
}

/* -------------------------------------------------- photographing a shelf tag */

/**
 * Standing in the aisle with a phone.
 *
 * The only way of getting a store's real price that works at every shop, costs
 * nothing, needs no account and cannot break when somebody's website changes.
 * He photographs the tag and **types the number he can see**.
 *
 * The typing is not a fallback for the photograph failing. It is the point. Any
 * machine reading of a shelf tag — including the on-device text recognition the
 * phone build will offer — proposes a number for him to confirm and can never
 * write one. A price nobody read is a price nobody can defend, and this is a
 * book that has to survive a client asking where a figure came from.
 */
function ShelfTag() {
  const { book, save } = useVendorBook();
  const { company } = useUnits();
  const camera = useRef<HTMLInputElement>(null);

  const [store, setStore] = useState('');
  const [item, setItem] = useState('');
  const [unit, setUnit] = useState<PriceUnit>('ea');
  const [category, setCategory] = useState('');
  const [code, setCode] = useState('');
  const [price, setPrice] = useState('');
  const [seenAt, setSeenAt] = useState(today());
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [told, setTold] = useState<string | null>(null);

  const by = company.name.trim() === '' ? 'me' : company.name.trim();

  async function shoot(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setTrouble(null);
    try {
      const name = photoNameFor(book);
      const blob = await readied(file);
      if (!(await keep(name, blob))) {
        // The bytes have to be somewhere before the price claims to have them.
        // A sighting that says "photographed" over a picture this device threw
        // away is the book lying about its own evidence.
        setTrouble(
          'This browser would not keep that picture, so the price cannot be written down as a ' +
            'photographed tag. Write it down off the counter instead — it is still your number.'
        );
        return;
      }
      setPhoto(name);
      setTold(null);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (camera.current) camera.current.value = '';
    }
  }

  function write() {
    try {
      const sighting: Sighting = {
        storeId: store,
        item: item.trim(),
        unit,
        cents: parseMoney(price),
        seenAt,
        evidence: photo === null ? { kind: 'counter', by } : { kind: 'tag', photo, by },
        ...(code.trim() === '' ? {} : { code: code.trim() }),
        ...(category.trim() === '' ? {} : { category: category.trim() }),
      };
      const next = recordPrice(book, sighting, new Date().toISOString());
      const kept = save(next);
      const where = storeById(next, store);
      setTold(
        `${money(sighting.cents)} / ${unit} for ${sighting.item} at ${where?.name ?? 'that store'}` +
          `, seen ${seenAt}.` +
          (kept ? '' : ' This browser would not keep it, so it is here until you close the tab.')
      );
      setItem('');
      setPrice('');
      setCode('');
      setPhoto(null);
      setTrouble(null);
    } catch (error) {
      setTold(null);
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  }

  if (book.stores.length === 0) {
    return (
      <p className="mt-3 text-xs text-slate-500">
        Add a store above and you can start writing down what it charges — off a price list, off
        the tag on the shelf, or off the counter.
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
      {/* Eight boxes, a camera and two buttons. It is the longest form in the
          app and it sat open on the rate-book screen whether or not anybody
          was standing in an aisle. */}
      <Disclosure
        heading="h4"
        title="Write down a price"
        summary="A store, what it is, what it costs and the day you saw it"
      >
        <p className="mt-1 text-xs leading-relaxed text-slate-600">
          Standing in the aisle: photograph the tag and type the number on it. The photograph is
          what proves where the figure came from — it is never what reads it. Nothing goes in this
          book that you have not read yourself.
        </p>

        <div className="mt-3 grid gap-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-700">Which store</span>
            <select
              value={store}
              onChange={(event) => setStore(event.target.value)}
              aria-label="Which store"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2
                         focus:border-sky-500 focus:outline-none"
            >
              <option value="">— pick a store —</option>
              {book.stores.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-700">What it is</span>
            <input
              value={item}
              onChange={(event) => setItem(event.target.value)}
              placeholder="1/2 in drywall, 4x8"
              aria-label="What it is"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2
                         focus:border-sky-500 focus:outline-none"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">What it costs</span>
              <input
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="decimal"
                placeholder="12.98"
                aria-label="What it costs"
                className="mt-1 min-h-11 w-28 rounded-md border border-slate-300 px-3 py-2 text-right
                           font-mono tabular-nums focus:border-sky-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Per</span>
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value as PriceUnit)}
                aria-label="Priced per"
                className="mt-1 min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2
                           focus:border-sky-500 focus:outline-none"
              >
                <option value="ea">ea</option>
                <option value="sq ft">sq ft</option>
                <option value="lf">lf</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Seen on</span>
              <input
                type="date"
                value={seenAt}
                onChange={(event) => setSeenAt(event.target.value)}
                aria-label="Seen on"
                className="mt-1 min-h-11 rounded-md border border-slate-300 px-3 py-2
                           focus:border-sky-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <label className="block grow">
              <span className="text-xs font-medium text-slate-700">Aisle or trade</span>
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="Drywall"
                aria-label="Aisle or trade"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2
                           focus:border-sky-500 focus:outline-none"
              />
            </label>
            <label className="block grow">
              <span className="text-xs font-medium text-slate-700">Their code for it</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="206021150"
                aria-label="Their code for it"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2
                           focus:border-sky-500 focus:outline-none"
              />
            </label>
          </div>

          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => void shoot(event.target.files?.[0])}
            className="sr-only"
            aria-label="Photograph the price tag"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => camera.current?.click()}
              className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                         text-slate-700 active:bg-slate-100 disabled:opacity-60"
            >
              {busy ? 'Keeping it…' : photo === null ? 'Photograph the tag' : 'Take it again'}
            </button>
            {photo !== null && (
              <span className="text-xs text-slate-600">
                Tag photographed. Now type the number that is on it.
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={write}
            className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white
                       active:bg-slate-700"
          >
            Write it down
          </button>
        </div>

        {told && <p className="mt-2 text-sm text-slate-700">{told}</p>}
        {trouble && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {trouble}
          </p>
        )}
      </Disclosure>
    </div>
  );
}

/* ------------------------------------------------------------- the catalogue */

/** A shelf-tag photograph, from this device. Nothing is fetched over a network. */
function Tag({ name }: { readonly name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [big, setBig] = useState(false);

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    void fetchPhoto(name).then((blob) => {
      if (!alive || !blob) return;
      made = URL.createObjectURL(blob);
      setSrc(made);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [name]);

  if (src === null) {
    return <span className="text-xs text-slate-500">Tag photograph not on this device</span>;
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setBig(true)}
        className="mt-1 block overflow-hidden rounded-md border border-slate-300"
      >
        <img src={src} alt={`Price tag photograph ${name}`} className="h-16 w-24 object-cover" />
      </button>
      {big && (
        <div
          role="dialog"
          aria-label="Price tag photograph, full size"
          onClick={() => setBig(false)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-3"
        >
          <img src={src} alt={`Price tag photograph ${name}`} className="max-h-full max-w-full" />
          {/* Tapping the picture already closed this, and nothing on the
              screen said so — the same complaint as every block that would not
              fold, in the one place where a person is holding a black
              rectangle over the whole phone. `WallPhotos.tsx` has had a real
              button on its full-size view all along; this had none. */}
          <button
            type="button"
            onClick={() => setBig(false)}
            aria-label="Close the price tag photograph"
            className="mt-3 min-h-12 shrink-0 rounded-md border border-white/60 px-4
                       font-semibold text-white active:bg-white/20"
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}

function Chips({
  chips,
  on,
  onToggle,
}: {
  readonly chips: readonly Chip[];
  readonly on: readonly string[];
  readonly onToggle: (id: string) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {chips.map((chip) => {
        const pressed = on.includes(chip.id);
        return (
          <li key={chip.id}>
            <button
              type="button"
              aria-pressed={pressed}
              onClick={() => onToggle(chip.id)}
              className={`min-h-11 rounded-full border px-3 text-sm ${
                pressed
                  ? 'border-slate-900 bg-slate-900 font-semibold text-white'
                  : 'border-slate-300 bg-white text-slate-700 active:bg-slate-100'
              }`}
            >
              {chip.label}{' '}
              <span className={pressed ? 'text-slate-300' : 'text-slate-500'}>{chip.count}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The dropdown, the search bar and the chips, over what the stores charge.
 *
 * Shown under the rate book, because that is where somebody is when the
 * question "what does this cost" comes up. Every row says the shop, the day and
 * how the number got there, and a row that is older than {@link STALE_DAYS}
 * days says so in red rather than sitting there looking current.
 */
export function Catalogue({
  targets = [],
}: {
  /**
   * The lines in the contractor's own rate book a store price can be put
   * against, so a $12.98 drywall panel can become his "Wall face" rate rather
   * than a twelfth item called "1/2 in. Drywall Panel". Filtered by unit — a
   * square-foot price against a per-door rate is how a quote goes out wrong.
   */
  readonly targets?: readonly { readonly item: string; readonly unit: PriceUnit }[];
}) {
  const { book } = useVendorBook();
  const { company, save } = useUnits();
  const [filter, setFilter] = useState(NO_FILTER);
  const [told, setTold] = useState<string | null>(null);
  const now = useMemo(() => new Date().toISOString(), []);

  const rows = listings(book, filter, now);
  const chips = chipsFor(book, filter, now);
  const store = filter.store === '' ? undefined : storeById(book, filter.store);

  function toggle(id: string) {
    setFilter((was) => ({
      ...was,
      chips: was.chips.includes(id) ? was.chips.filter((x) => x !== id) : [...was.chips, id],
    }));
  }

  /** Puts a store's price in the rate book, under a name the contractor picks. */
  function use(listing: Listing, as: string) {
    const { book: mine } = pricing(company);
    const rate = asRate(listing);
    const named = as === '' ? rate : { ...rate, item: as };
    const rest = mine.rates.filter((r) => !(r.item === named.item && r.unit === named.unit));
    save({ ...company, prices: { ...mine, rates: [...rest, named] } });
    setTold(
      `${named.item} is now ${money(named.cents)} / ${named.unit} in your rates — ` +
        `${listing.store.name}'s price, from ${listing.price.seenAt}. That is what they charge ` +
        `you, not what you charge. Your mark-up is set on the rate book above.`
    );
  }

  if (book.stores.length === 0) {
    return (
      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-sheet="no">
        <h2 className="font-semibold text-slate-900">What the stores charge</h2>
        <p className="mt-1 text-sm text-slate-600">
          Nothing here yet. Add the shops you buy at under <strong>Your business</strong>, then
          import a price list they sent you or photograph a tag on the shelf. Every price in here
          is one somebody actually saw at a named shop on a stated day — there is no feed behind
          it and nothing in it is estimated.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-sheet="no">
      {/* Every price at every shop, a dropdown, a search box and a row of
          chips, under the rate book. A contractor with three shops and a
          season of tags in it scrolls the length of his own buying history to
          get past this. It folds now, and the shut row says how much is in it. */}
      <Disclosure
        heading="h2"
        title="What the stores charge"
        summary={`${rows.length} price${rows.length === 1 ? '' : 's'} across your shops`}
      >
        <p className="mt-1 text-sm text-slate-600">
          Your own shops, your own prices. Pick a store, search it, narrow it down — then put a
          price into your rates on a tap. These are costs, not what you charge.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Store</span>
            <select
              value={filter.store}
              onChange={(event) => setFilter({ ...filter, store: event.target.value, chips: [] })}
              aria-label="Store"
              className="mt-1 min-h-12 w-full rounded-md border border-slate-300 bg-white px-3 py-2
                         focus:border-sky-500 focus:outline-none"
            >
              <option value="">Every store</option>
              {book.stores.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Search</span>
            <input
              type="search"
              value={filter.query}
              onChange={(event) => setFilter({ ...filter, query: event.target.value })}
              placeholder="drywall"
              aria-label="Search what the stores charge"
              className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                         focus:border-sky-500 focus:outline-none"
            />
          </label>
        </div>

        <Chips chips={chips} on={filter.chips} onToggle={toggle} />

        <p className="mt-3 text-sm text-slate-600">
          {rows.length} price{rows.length === 1 ? '' : 's'}
          {store ? ` at ${store.name}` : ' across your stores'}
          {filter.query.trim() === '' ? '' : ` matching “${filter.query.trim()}”`}.
        </p>

        {rows.length === 0 && (
          <p className="mt-1 text-sm text-slate-600">
            Nothing {store ? `at ${store.name} ` : ''}matches that. This app will not show you
            another shop’s number in its place, or an average of the ones it has — if{' '}
            {store ? store.name : 'a store'} has never quoted it, it has never quoted it.
          </p>
        )}

        <ul className="mt-2 divide-y divide-slate-100">
          {rows.map((listing) => {
            const moved = movement(listing);
            const stale = listing.days > STALE_DAYS;
            const fits = targets.filter((t) => t.unit === listing.price.unit);
            return (
              <li
                key={`${listing.store.id}|${listing.price.item}|${listing.price.unit}`}
                className="py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-900">{listing.price.item}</span>
                    <span className="block text-xs text-slate-500">
                      {listing.store.name}
                      {listing.price.category ? ` · ${listing.price.category}` : ''}
                      {listing.price.code ? ` · their code ${listing.price.code}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono tabular-nums text-slate-900">
                      {money(listing.price.cents)}
                    </span>
                    <span className="block text-xs text-slate-500">/ {listing.price.unit}</span>
                  </span>
                </div>

                <p className={`mt-1 text-xs ${stale ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
                  Seen {howOld(listing.days)} · {whereFrom(listing.price.evidence)}
                  {stale ? ` — nobody has checked this in over ${STALE_DAYS} days.` : ''}
                </p>

                {moved && (
                  <p className="mt-1 text-xs text-slate-600">
                    {percent(moved.basisPoints)} since you last looked — {money(moved.was)} on{' '}
                    {moved.wasSeenAt}, {moved.days} days before this one. Both figures are yours.
                  </p>
                )}

                {listing.price.evidence.kind === 'tag' && <Tag name={listing.price.evidence.photo} />}

                <Elsewhere book={book} listing={listing} now={now} />

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => use(listing, '')}
                    className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                               text-slate-700 active:bg-slate-100"
                  >
                    Use it as my rate
                  </button>
                  {fits.length > 0 && (
                    <label className="text-xs text-slate-600">
                      <span className="sr-only">Put {listing.price.item} against one of my rates</span>
                      <select
                        defaultValue=""
                        onChange={(event) => {
                          if (event.target.value === '') return;
                          use(listing, event.target.value);
                          event.target.value = '';
                        }}
                        aria-label={`Put ${listing.price.item} against one of my rates`}
                        className="min-h-11 rounded-md border border-slate-300 bg-white px-2 py-1
                                   focus:border-sky-500 focus:outline-none"
                      >
                        <option value="">…or against one of my rates</option>
                        {fits.map((t) => (
                          <option key={t.item} value={t.item}>
                            {t.item}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {told && (
          <p role="status" className="mt-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-800">
            {told}
          </p>
        )}
      </Disclosure>
    </section>
  );
}

/**
 * The same thing at the other shops that have quoted it.
 *
 * The question a contractor actually has standing in one of them: is this
 * cheaper down the road. Only shops that have quoted **this item, in this
 * unit** appear — a shop that has never quoted it is silent rather than shown
 * with a blank, somebody else's number, or an average of the others.
 *
 * It is exact-name matching on purpose. "1/2 in drywall, 4x8" at one yard and
 * "Drywall Panel 1/2 in." at another are not proven to be the same product by
 * anything this app knows, and quietly deciding they were would put a price
 * comparison on the screen that nobody checked.
 */
function Elsewhere({
  book,
  listing,
  now,
}: {
  readonly book: VendorBook;
  readonly listing: Listing;
  readonly now: string;
}) {
  const others = acrossStores(book, listing.price.item, listing.price.unit, now).filter(
    (one) => one.store.id !== listing.store.id
  );
  if (others.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-slate-600">
      Also quoted by{' '}
      {others.map((one, i) => (
        <span key={one.store.id}>
          {i > 0 ? ', ' : ''}
          <strong>{one.store.name}</strong> at{' '}
          <span className="font-mono tabular-nums">{money(one.price.cents)}</span> (
          {howOld(one.days)})
        </span>
      ))}
      . Same name, same unit — nothing here decides that two differently worded items are the
      same thing.
    </p>
  );
}

/**
 * Drops a shelf-tag photograph this device is holding for a price that is gone.
 *
 * Exported because the store list is not the only place a sighting can leave
 * the book, and an orphaned JPEG in IndexedDB is a picture nobody can ever see
 * again taking up somebody's storage.
 */
export async function forgetTag(sighting: Sighting): Promise<void> {
  if (sighting.evidence.kind === 'tag') await forget(sighting.evidence.photo);
}
