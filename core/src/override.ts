import { RoomError } from './room.ts';
import type { TakeoffLine } from './takeoff.ts';
import type { Priceable } from './price.ts';

/**
 * Changing a number the geometry produced, and never hiding that it changed.
 *
 * The room measures what is there. What gets *ordered* is often not what is
 * there, and every one of the reasons is legitimate: waste on a diagonal cut,
 * a full box because half a box is not sold, an extra course because the
 * delivery is a week out, a quantity the supplier prices in a different unit.
 * A takeoff that will not let a contractor say "price 430, not 411.8" is a
 * takeoff he does in a spreadsheet instead, and then the whole product is a
 * drawing app.
 *
 * So numbers can be changed. Two rules make that safe, and they are the whole
 * of this module:
 *
 *   1. **The measured number is never lost.** An override records what the
 *      geometry said, what it was changed to, who changed it and why. The sheet
 *      shows both. Nothing overwrites a measurement.
 *   2. **An override cannot pretend to be a measurement.** A line carrying one
 *      says so on the screen, on the print, in the CSV and on anything sent to
 *      a client or an adjuster. It is the same rule as a dragged wall: the
 *      moment a typed-over number could pass for a measured one, every promise
 *      this app makes about provenance is worth nothing.
 *
 * A reason is required. Not politeness — an override with no reason is a number
 * nobody can defend three weeks later when a client asks why the sheet says
 * 430 and the drawing says 411.8, and "I do not remember" is how a contractor
 * loses an argument he was right about.
 */

export class OverrideError extends RoomError {}

export interface Override {
  /** The line this replaces, matched on name and unit, as pricing matches. */
  readonly item: string;
  readonly unit: TakeoffLine['unit'];
  /** What to price instead, in the same unit and the same shape of number. */
  readonly quantity: string;
  /** Why, in the contractor's own words. Required. */
  readonly why: string;
  readonly by: string;
  readonly at: string;
}

/** A line with an override applied, still carrying what the room said. */
export interface OverriddenLine extends TakeoffLine {
  readonly overridden?: {
    /** What the geometry produced, before anybody changed it. */
    readonly was: string;
    readonly why: string;
    readonly by: string;
    readonly at: string;
  };
}

const QUANTITY = /^\d+(\.\d{1,2})?$/;

/**
 * Refuses an override that could not be priced or could not be defended.
 *
 * Everything here is a thing that would otherwise be found by somebody reading
 * a quote: a quantity that is not a number, a blank reason, a negative that
 * would subtract money from a job.
 */
export function validateOverride(override: Override): void {
  if (override.item.trim() === '') {
    throw new OverrideError('An override has to say which line it replaces.');
  }
  if (!QUANTITY.test(override.quantity.trim())) {
    throw new OverrideError(
      `"${override.quantity}" is not a quantity. Whole numbers, or a decimal to two places — the ` +
        `same shape the sheet prints, so a client adding the column up by hand gets the total on ` +
        `the page.`
    );
  }
  if (override.why.trim() === '') {
    throw new OverrideError(
      `Say why. An override with no reason is a number nobody can defend three weeks later when ` +
        `a client asks why the sheet says one thing and the drawing says another — and "I do not ` +
        `remember" loses an argument you were right about.`
    );
  }
  if (override.by.trim() === '') {
    throw new OverrideError('An override that nobody signed is a number that changed by itself.');
  }
}

/**
 * The sheet, with whatever somebody changed.
 *
 * Matched on name and unit — the same key pricing uses, so an override and a
 * rate always agree about which line they are talking about. An override
 * naming a line that is not on this sheet is returned separately rather than
 * dropped: a contractor who overrode "Wall face" and then turned a wall into
 * an open span needs to know his override stopped applying, because otherwise
 * the quote quietly changes and nothing says so.
 */
export function applyOverrides(
  lines: readonly TakeoffLine[],
  overrides: readonly Override[]
): { readonly lines: readonly OverriddenLine[]; readonly stranded: readonly Override[] } {
  for (const override of overrides) validateOverride(override);

  const key = (item: string, unit: string) => `${item}|${unit}`;
  const byKey = new Map(overrides.map((o) => [key(o.item, o.unit), o]));
  const used = new Set<string>();

  const out = lines.map((line): OverriddenLine => {
    const found = byKey.get(key(line.what, line.unit));
    if (!found) return line;
    used.add(key(line.what, line.unit));
    if (found.quantity.trim() === line.quantity) {
      // An override that says exactly what the room says is not an override.
      // Kept as a plain line rather than marked, so a sheet is not covered in
      // notes about numbers nobody actually changed.
      return line;
    }
    return {
      ...line,
      quantity: found.quantity.trim(),
      overridden: {
        was: line.quantity,
        why: found.why.trim(),
        by: found.by.trim(),
        at: found.at,
      },
    };
  });

  return {
    lines: out,
    stranded: overrides.filter((o) => !used.has(key(o.item, o.unit))),
  };
}

/**
 * One word for a whole sheet: whether anything on it was typed over.
 *
 * Wanted by every document that leaves the building. A client file, a claim
 * document and a printed quote each need to say it in their own words, and all
 * three asking the same function means they cannot disagree about the answer.
 */
export function anyOverridden(lines: readonly OverriddenLine[]): boolean {
  return lines.some((line) => line.overridden !== undefined);
}

/**
 * What a line's provenance becomes once somebody has typed over it.
 *
 * Never `measured`. A quantity somebody changed is not what the room measured,
 * whatever the room was measured with — so a sheet full of tape readings with
 * one overridden line on it cannot call that line measured, and a quote built
 * from it cannot call itself measured either.
 */
export function provenanceOf(line: OverriddenLine): Priceable['provenance'] {
  return line.overridden ? 'scanned' : line.provenance;
}

/**
 * An override in the words a sheet prints.
 *
 * Both numbers in one sentence, deliberately. A note that said only "430 sq ft
 * — waste" would leave a client working out for himself that the drawing says
 * something else, and finding that out on his own is what makes it feel like
 * something was hidden.
 */
export function describeOverride(line: OverriddenLine): string {
  if (!line.overridden) return '';
  const { was, why, by } = line.overridden;
  return `${line.quantity} ${line.unit}, not the ${was} ${line.unit} this room measures — ${why} (${by}).`;
}
