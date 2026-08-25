/**
 * The one place a room turns into money.
 *
 * The Price screen worked this out inside itself, which was fine while it was
 * the only screen that needed it. The proposal needs the same number, and a
 * proposal that computes its own total is a proposal that can disagree with the
 * sheet it came from — discovered, when it happens, by the client.
 *
 * So both call this. There is one takeoff, one set of overrides applied to it,
 * and one quote, and any two screens showing a total are showing the same one.
 */
import { useMemo } from 'react';
import { type Company } from '../../core/src/company.ts';
import { type Override, applyOverrides, provenanceOf } from '../../core/src/override.ts';
import { type Quote, quote } from '../../core/src/price.ts';
import { type Room } from '../../core/src/room.ts';
import { takeoff } from '../../core/src/takeoff.ts';
import { pricing } from '../../core/src/company.ts';

export interface Priced {
  /** The takeoff, with anything typed over it applied. */
  readonly applied: ReturnType<typeof applyOverrides>;
  readonly sheet: ReturnType<typeof takeoff>;
  readonly quote: Quote;
  readonly book: ReturnType<typeof pricing>['book'];
  readonly suggestions: ReturnType<typeof pricing>['suggestions'];
}

export function useQuote(room: Room, overrides: readonly Override[], company: Company): Priced {
  const { book, suggestions } = useMemo(() => pricing(company), [company]);
  const sheet = useMemo(
    () => takeoff(room, new Date().toLocaleString(), { company: company.name }),
    [room, company.name]
  );
  const applied = useMemo(() => applyOverrides(sheet.lines, overrides), [sheet, overrides]);
  const priced = useMemo(
    () =>
      quote(
        applied.lines.map((line) => ({ ...line, provenance: provenanceOf(line) })),
        book
      ),
    [applied, book]
  );
  return { applied, sheet, quote: priced, book, suggestions };
}
