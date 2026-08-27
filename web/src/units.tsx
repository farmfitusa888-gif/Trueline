import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { Nanometres } from '../../core/src/length.ts';
import {
  type Company,
  EMPTY_COMPANY,
  showArea,
  showLength,
  showRun,
} from '../../core/src/company.ts';
import { decode, encode } from '../../core/src/persist.ts';
import type { Rate } from '../../core/src/price.ts';
import type { JobRecord } from '../../core/src/price.ts';
import { handBackCompany, onCompany } from './bridge.ts';
import { NO_TRADE, tradeOf } from '../../core/src/trade.ts';

/**
 * How this contractor reads a number, and who they are.
 *
 * One place, because the failure mode of a units preference is a screen
 * printing feet next to a screen printing millimetres, and that is exactly what
 * happens when every component formats for itself. Everything on screen goes
 * through `len`, `area` and `run` from here.
 *
 * **It is a way of reading and never a way of recording.** Nothing stored
 * changes when the switch is flipped: the model is nanometre integers either
 * way, and the same integer is behind both strings. Nothing formatted here is
 * ever parsed back into the model — that rule is what keeps a display
 * preference from becoming a rounding.
 *
 * The profile lives here too rather than in a second store, because it is
 * loaded from the same place at the same time and every screen that needs one
 * tends to need the other.
 */

const KEY = 'trueline.company.v1';

export interface Units {
  readonly company: Company;
  readonly save: (next: Company) => void;
  /** A length, the way this company reads lengths. */
  readonly len: (value: Nanometres) => string;
  /** An area, from the doubled unit `area()` keeps. */
  readonly area: (halfSquareNanometres: bigint, places?: number) => string;
  /** A run for a takeoff line — linear feet, or metres. */
  readonly run: (value: Nanometres, places?: number) => string;
  /**
   * Read somebody else's profile for a while, and never write it down.
   *
   * ## Why this exists
   *
   * The worked example is a project file, and a project file does not carry a
   * rate book — the book belongs to the contractor, not to the room. So the
   * example opened on a phone that had never had a rate typed into it, every
   * priced line came back empty, and `changesSince` correctly reported that
   * every line of the signed scope had been removed: the Work screen said
   * **"Agreed $0.00"** under an invoice for $2,889.45, and the Agreement screen
   * offered a change order that deleted the job.
   *
   * Nothing was wrong with the app. The example was simply missing half of what
   * made it, so this lends the other half back.
   *
   * Passing `null` gives the contractor's own profile back. Nothing borrowed is
   * ever written to storage or handed to the phone — including edits made while
   * it is borrowed, which is what lets the example say that nothing you change
   * in it matters and be telling the truth.
   */
  readonly borrow: (text: string | null) => void;
  /** True while a borrowed profile is in front of the real one. */
  readonly borrowed: boolean;
}

const Context = createContext<Units | null>(null);

/** Reads the profile back, or hands back an empty one. Never throws. */
export function loadCompany(): Company {
  try {
    return readCompany(window.localStorage.getItem(KEY));
  } catch {
    return EMPTY_COMPANY;
  }
}

/**
 * A profile out of a string, field by field.
 *
 * Split out of `loadCompany` so the same reading applies to a profile that
 * never came from this browser's storage — the one the worked example carries.
 * There is exactly one set of fallbacks and one shape check, which is the point.
 */
export function readCompany(text: string | null): Company {
  try {
    if (!text) return EMPTY_COMPANY;
    // `decode`, not `JSON.parse`. Money is `bigint` cents, and plain JSON turns
    // one into `{"$nm":"875"}` on the way out and leaves it as an object on the
    // way back — a rate that is not a number and prices nothing.
    const raw = decode(text) as Partial<Company>;
    // Field by field with a fallback, rather than trusting the shape. A profile
    // saved by an older build is missing keys, and a missing `units` would make
    // every number on every screen `undefined`.
    return {
      name: typeof raw.name === 'string' ? raw.name : '',
      phone: typeof raw.phone === 'string' ? raw.phone : '',
      email: typeof raw.email === 'string' ? raw.email : '',
      licence: typeof raw.licence === 'string' ? raw.licence : '',
      insurance: typeof raw.insurance === 'string' ? raw.insurance : '',
      ...(typeof raw.logo === 'string' ? { logo: raw.logo } : {}),
      units: raw.units === 'metric' ? 'metric' : 'imperial',
      // Through tradeOf so a profile naming a trade this build does not have
      // opens in plain words instead of refusing.
      trade: tradeOf(typeof raw.trade === 'string' ? raw.trade : NO_TRADE).id,
      useDefaultCeiling: raw.useDefaultCeiling === true,
      defaultCeiling: typeof raw.defaultCeiling === 'string' ? raw.defaultCeiling : `8'`,
      ...(raw.defaultAssembly ? { defaultAssembly: raw.defaultAssembly } : {}),
      // The rates and the history. These were being dropped on every load —
      // field-by-field is safe against a missing key and silent about a key
      // nobody remembered to add, and this is the one that got forgotten. A
      // contractor typed his rates, closed the app, and they were gone.
      ...(isBook(raw.prices) ? { prices: raw.prices } : {}),
      ...(Array.isArray(raw.jobs) ? { jobs: raw.jobs as readonly JobRecord[] } : {}),
    };
  } catch {
    return EMPTY_COMPANY;
  }
}

/**
 * Whether what came back out of storage is a price book.
 *
 * Shape-checked rather than trusted, like everything else read back here. A
 * rate whose `cents` came back as an object instead of a bigint would multiply
 * into `NaN` and put "$NaN" on a quote in front of a client — so a book that
 * does not hold what it should is dropped whole rather than half-used.
 */
function isBook(value: unknown): value is Company['prices'] {
  if (typeof value !== 'object' || value === null) return false;
  const book = value as { rates?: unknown };
  if (!Array.isArray(book.rates)) return false;
  return book.rates.every((rate: unknown) => {
    if (typeof rate !== 'object' || rate === null) return false;
    const r = rate as Partial<Rate>;
    return (
      typeof r.item === 'string' &&
      (r.unit === 'sq ft' || r.unit === 'lf' || r.unit === 'ea') &&
      typeof r.cents === 'bigint' &&
      typeof r.source === 'object' &&
      r.source !== null
    );
  });
}

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [company, setCompany] = useState<Company>(() => loadCompany());
  // The example's profile, when one is open. Never written anywhere.
  const [lent, setLent] = useState<Company | null>(null);

  /**
   * Stable, on purpose.
   *
   * The screen that borrows a profile does it in an effect, and gives it back
   * in that effect's cleanup. If this were rebuilt on every render it would be
   * a new dependency every time, so the effect would tear down and set up on
   * every render — borrow, give back, borrow, give back — and the example
   * would flicker between its own rates and an empty book. It did.
   */
  const borrow = useCallback(
    (text: string | null) => setLent(text === null ? null : readCompany(text)),
    []
  );

  // A profile the app is keeping outranks whatever is in this browser's
  // storage: it is the one that came back from iCloud, and it is the one that
  // followed somebody to a second phone.
  useEffect(
    () =>
      onCompany((text) => {
        try {
          window.localStorage.setItem(KEY, text);
        } catch {
          // Then it is in memory for this session, which is still better than
          // making somebody retype a licence number.
        }
        setCompany(loadCompany());
      }),
    []
  );

  const value = useMemo<Units>(
    () => ({
      company: lent ?? company,
      borrowed: lent !== null,
      borrow,
      save: (next) => {
        // Editing a borrowed profile edits the borrowed copy and nothing else.
        // A rate typed while the worked example is open must move the example's
        // numbers on screen — otherwise the box is dead — and must not touch
        // the contractor's own book, his phone, or his iCloud.
        if (lent !== null) { setLent(next); return; }
        setCompany(next);
        // `encode`, not `JSON.stringify`. Money is `bigint` cents and
        // `JSON.stringify` throws on a bigint — which it was doing, outside the
        // try below, on the line that hands the profile to the app. So every
        // rate anybody typed threw on the way out, the localStorage write in
        // the catch was silently skipped, and the rates lived until the tab
        // closed. Found by importing a supplier's price list.
        let text: string;
        try {
          text = encode(next);
        } catch {
          // Nothing in a profile should be unencodable now, and if something
          // ever is, losing the screen is worse than losing the save.
          return;
        }
        try {
          window.localStorage.setItem(KEY, text);
        } catch {
          // A profile that will not save is a profile somebody retypes. It must
          // not take the screen down, and the room's own saving is separate.
        }
        // And to the app, which keeps it beside the scans and in iCloud. A
        // contractor should type his licence number once per lifetime, not once
        // per phone.
        handBackCompany(text);
      },
      len: (v) => showLength(v, (lent ?? company).units),
      area: (v, places) => showArea(v, (lent ?? company).units, places),
      run: (v, places) => showRun(v, (lent ?? company).units, places),
    }),
    [company, lent, borrow]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useUnits(): Units {
  const found = useContext(Context);
  if (!found) {
    // Not a runtime fallback. A component rendered outside the provider would
    // silently print imperial while its neighbour printed metric, which is the
    // one failure this module exists to make impossible.
    throw new Error('useUnits() was called outside <UnitsProvider>.');
  }
  return found;
}
