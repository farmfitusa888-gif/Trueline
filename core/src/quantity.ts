import { type Nanometres, NM_PER_FOOT } from './length.ts';

/**
 * The four ways an exact integer becomes a number on a sheet.
 *
 * These lived inside `takeoff.ts` as private helpers, which was right for
 * exactly as long as the takeoff was the only thing that printed a quantity.
 * The moment a second module started producing priceable lines — see
 * `work.ts` — they had to move, because the alternative is two roundings of
 * the same measurement in two files. That is not a hypothetical: the garage's
 * floor already read 411.7 in one place and 411.8 in another, from the same
 * exact value, the last time this arithmetic existed twice.
 *
 * **Areas arrive in two different units and mixing them loses a tenth of a
 * square foot.** Floor and ceiling are kept in *half* square nanometres,
 * because the shoelace formula gives twice the area and halving it early
 * rounds a room with an angled wall in it. A wall face is a plain
 * square-nanometre product. So there are two entry points rather than one with
 * a flag, and the caller cannot pick the wrong one without saying a different
 * word.
 */

/** One square foot, in square nanometres. */
export const SQ_FT = NM_PER_FOOT * NM_PER_FOOT;

/**
 * An exact integer, rounded to a decimal string — rounded, not truncated.
 *
 * Truncating printed 411.7 on the takeoff while the screen, which rounds,
 * printed 411.8: one room, two numbers, from the same exact value. A tenth of a
 * square foot is nothing; two of the app's own surfaces disagreeing about a
 * number is not.
 */
export function decimals(value: bigint, per: bigint, places: number): string {
  const scale = 10n ** BigInt(places);
  const scaled = (value * scale + per / 2n) / per;
  return (Number(scaled) / Number(scale)).toFixed(places);
}

/** A plain square-nanometre area — a wall face — to square feet. */
export function squareFeet(squareNanometres: bigint): string {
  return decimals(squareNanometres, SQ_FT, 1);
}

/**
 * The doubled unit `area()` keeps — a floor, a ceiling — to square feet.
 *
 * The division by two happens here, once, at the end, with the tenths already
 * in hand. Halving before converting is what cost the garage a tenth.
 */
export function squareFeetOfHalves(halfSquareNanometres: bigint): string {
  return decimals(halfSquareNanometres, 2n * SQ_FT, 1);
}

/** Linear feet as a decimal, for the spreadsheet column that will be multiplied. */
export function linearFeet(value: Nanometres): string {
  return decimals(value, NM_PER_FOOT, 2);
}

/**
 * A number somebody typed, summed in hundredths, printed as they typed it.
 *
 * A typed quantity is not a measurement and must not be dressed as one. Two
 * bags of something is `2`, not `2.00`, and half a day is `0.5` rather than a
 * number rounded to whichever precision the unit happens to use. So the
 * trailing zeros come off — and what is left still satisfies the shape pricing
 * will parse, which is whole numbers or a decimal to two places.
 */
export function typedAmount(hundredths: bigint): string {
  const whole = hundredths / 100n;
  const rest = Number(hundredths % 100n);
  if (rest === 0) return whole.toString();
  return `${whole}.${rest.toString().padStart(2, '0')}`.replace(/0$/, '');
}
