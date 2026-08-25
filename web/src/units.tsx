import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Nanometres } from '../../core/src/length.ts';
import {
  type Company,
  EMPTY_COMPANY,
  showArea,
  showLength,
  showRun,
} from '../../core/src/company.ts';
import { handBackCompany, onCompany } from './bridge.ts';

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
}

const Context = createContext<Units | null>(null);

/** Reads the profile back, or hands back an empty one. Never throws. */
export function loadCompany(): Company {
  try {
    const text = window.localStorage.getItem(KEY);
    if (!text) return EMPTY_COMPANY;
    const raw = JSON.parse(text) as Partial<Company>;
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
      useDefaultCeiling: raw.useDefaultCeiling === true,
      defaultCeiling: typeof raw.defaultCeiling === 'string' ? raw.defaultCeiling : `8'`,
      ...(raw.defaultAssembly ? { defaultAssembly: raw.defaultAssembly } : {}),
    };
  } catch {
    return EMPTY_COMPANY;
  }
}

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [company, setCompany] = useState<Company>(() => loadCompany());

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
      company,
      save: (next) => {
        setCompany(next);
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          // A profile that will not save is a profile somebody retypes. It must
          // not take the screen down, and the room's own saving is separate.
        }
        // And to the app, which keeps it beside the scans and in iCloud. A
        // contractor should type his licence number once per lifetime, not once
        // per phone.
        handBackCompany(JSON.stringify(next));
      },
      len: (v) => showLength(v, company.units),
      area: (v, places) => showArea(v, company.units, places),
      run: (v, places) => showRun(v, company.units, places),
    }),
    [company]
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
