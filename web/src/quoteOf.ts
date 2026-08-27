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
 *
 * That rule is what made adding scopes safe. **What is being done to each
 * surface changes every quantity on the sheet**, so a screen that built its own
 * takeoff would go on pricing the gut job while the one beside it priced the
 * real one — and the two would be a wall apart on the same job. `sheetOf` is
 * the single door: everything that needs a takeoff comes through it and takes
 * the scope with it, or gets today's full-replacement sheet when there is none.
 */
import { useMemo } from 'react';
import { type Company } from '../../core/src/company.ts';
import { type Override, applyOverrides, provenanceOf } from '../../core/src/override.ts';
import { type Quote, quote } from '../../core/src/price.ts';
import { type Room } from '../../core/src/room.ts';
import { type WorkScope, workItems } from '../../core/src/work.ts';
import { takeoff } from '../../core/src/takeoff.ts';
import { pricing } from '../../core/src/company.ts';

/**
 * The takeoff for this room, counting only what is being done to it.
 *
 * `scope` is `null` for every room saved before scopes existed and for every
 * room nobody has scoped since. With no scope this is exactly the call this app
 * has always made, so the sheet is character for character what it was.
 */
export function sheetOf(
  room: Room,
  company: Company,
  scope: WorkScope | null,
  at: string
): ReturnType<typeof takeoff> {
  return takeoff(room, at, {
    company: company.name,
    ...(scope ? { work: { scope, items: workItems(company.prices ?? { rates: [] }) } } : {}),
  });
}

export interface Priced {
  /** The takeoff, with anything typed over it applied. */
  readonly applied: ReturnType<typeof applyOverrides>;
  readonly sheet: ReturnType<typeof takeoff>;
  readonly quote: Quote;
  readonly book: ReturnType<typeof pricing>['book'];
  readonly suggestions: ReturnType<typeof pricing>['suggestions'];
}

export function useQuote(
  room: Room,
  overrides: readonly Override[],
  company: Company,
  scope: WorkScope | null = null
): Priced {
  const { book, suggestions } = useMemo(() => pricing(company), [company]);
  const sheet = useMemo(
    () => sheetOf(room, company, scope, new Date().toLocaleString()),
    [room, company, scope]
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
