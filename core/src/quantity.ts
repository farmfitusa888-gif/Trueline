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

/**
 * A number somebody typed, into the hundredths the model adds up in.
 *
 * The inverse of `typedAmount`, and it lives beside it for the reason
 * everything else in this file moved here: this arithmetic existed inline in
 * `work.ts` — `BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))` — and the
 * moment a second thing needed to read a typed quantity there would have been
 * two parsers for one format. Two readers of one format is two readers that
 * will eventually disagree, and the one they would disagree about is a number
 * on a client's quote.
 *
 * `null` rather than a thrown error, because only the caller knows what was
 * being typed and therefore what sentence to say about it. A blank box on the
 * rate screen and a blank box on a wall panel need two different answers, and
 * neither of them is this file's to write.
 */
export function readHundredths(text: string): bigint | null {
  const trimmed = text.trim();
  // Whole numbers, or a decimal to two places: the same shape the sheet prints
  // and the same shape `quote()` will parse back out of it.
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/**
 * Hundredths of a printed unit, as the exact integer that many of it is.
 *
 * The other direction from `decimals`, and the reason it has to exist: a
 * quantity somebody typed has to be added to quantities the geometry produced,
 * and the addition must happen in the geometry's own exact unit rather than in
 * printed tenths. Adding in tenths would round a wall face on the way in and
 * then round the sum again on the way out — two roundings of one measurement,
 * which is the exact failure this file was made to end.
 *
 * `per` is how many exact units make one printed unit: `SQ_FT` for a wall
 * face, `2 * SQ_FT` for the doubled unit a floor is kept in, `NM_PER_FOOT` for
 * a run, `100` for a count already held in hundredths.
 *
 * Every one of those is a multiple of a hundred, so the division is exact and
 * nothing is ever lost here. The check is not decoration: it is what turns a
 * unit somebody adds later that is *not* a multiple of a hundred into a loud
 * failure rather than into a quantity quietly short by a fraction.
 */
export function exactFromHundredths(hundredths: bigint, per: bigint): bigint {
  const product = hundredths * per;
  if (product % 100n !== 0n) {
    throw new RangeError(
      `${hundredths} hundredths of a unit worth ${per} is not a whole number of them. A typed ` +
        `quantity that cannot be held exactly is a quantity that would be short by a fraction on ` +
        `every sheet it reached.`
    );
  }
  return product / 100n;
}
