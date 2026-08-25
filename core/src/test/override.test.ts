import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified, verify } from '../measurement.ts';
import type { Heading, Room, Wall } from '../room.ts';
import { takeoff } from '../takeoff.ts';
import { quote } from '../price.ts';
import {
  type Override,
  OverrideError,
  anyOverridden,
  applyOverrides,
  describeOverride,
  provenanceOf,
  validateOverride,
} from '../override.ts';

/**
 * Typing over a number the room measured.
 *
 * Every reason a contractor does it is legitimate — waste on a diagonal cut, a
 * full box because half a box is not sold, an extra course because the delivery
 * is a week out. A takeoff that refuses to let him is a takeoff he redoes in a
 * spreadsheet, and then this is a drawing app.
 *
 * What must never happen is a typed number passing for a measured one. That is
 * the same line as a dragged wall, and these tests are mostly about it.
 */

const T0 = '2026-08-26T09:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`2"`), T0, 'roomplan');

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scan(length) };
}

/** 20 x 10 with a 9 ft ceiling: 200 sq ft of floor, 540 of wall face. */
const room: Room = {
  id: 'r1',
  name: 'basement',
  walls: [
    w('south', 'east', `20'`),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`),
    w('west', 'south', `10'`),
  ],
  ceilingHeight: verified(parseLength(`9'`), 'sam', T0, 'tape'),
};

const sheet = takeoff(room, '26 Aug 2026');
const waste = (over: Partial<Override> = {}): Override => ({
  item: 'Floor',
  unit: 'sq ft',
  quantity: '215.00',
  why: 'diagonal lay, 7% waste',
  by: 'sam',
  at: T0,
  ...over,
});

const find = <T extends { what: string }>(lines: readonly T[], what: string): T =>
  lines.find((l) => l.what === what)!;

/* -------------------------------------------------------- what it will not do */

test('an override with no reason is refused, because it cannot be defended', () => {
  assert.throws(
    () => validateOverride(waste({ why: '   ' })),
    (e: unknown) => e instanceof OverrideError && /Say why/.test((e as Error).message)
  );
});

test('a quantity that is not a quantity is refused', () => {
  for (const bad of ['lots', '-5', '4.567', '', '1e3']) {
    assert.throws(() => validateOverride(waste({ quantity: bad })), OverrideError);
  }
});

test('an override nobody signed is refused', () => {
  assert.throws(() => validateOverride(waste({ by: '' })), OverrideError);
});

/* ------------------------------------------------------------ what it does */

test('the measured number is kept, never overwritten', () => {
  const { lines } = applyOverrides(sheet.lines, [waste()]);
  const floor = find(lines, 'Floor');
  assert.equal(floor.quantity, '215.00');
  assert.equal(floor.overridden?.was, '200.0', 'what the room measured is still on the line');
  assert.equal(floor.overridden?.why, 'diagonal lay, 7% waste');
  assert.equal(floor.overridden?.by, 'sam');
});

test('both numbers go in the sentence a sheet prints', () => {
  // A note saying only "215 sq ft — waste" leaves a client working out for
  // himself that the drawing says something else.
  const { lines } = applyOverrides(sheet.lines, [waste()]);
  const said = describeOverride(find(lines, 'Floor'));
  assert.match(said, /215\.00 sq ft/);
  assert.match(said, /not the 200\.0 sq ft this room measures/);
  assert.match(said, /diagonal lay, 7% waste/);
  assert.match(said, /\(sam\)/);
});

test('lines nobody touched are untouched, and carry no note', () => {
  const { lines } = applyOverrides(sheet.lines, [waste()]);
  assert.equal(find(lines, 'Ceiling').overridden, undefined);
  assert.equal(find(lines, 'Ceiling').quantity, '200.0');
  assert.equal(lines.filter((l) => l.overridden !== undefined).length, 1);
});

test('an override that says what the room already says is not an override', () => {
  // Otherwise a sheet fills up with notes about numbers nobody changed.
  const { lines } = applyOverrides(sheet.lines, [waste({ quantity: '200.0' })]);
  assert.equal(find(lines, 'Floor').overridden, undefined);
  assert.equal(anyOverridden(lines), false);
});

/* ------------------------------------------ it cannot pass for a measurement */

test('an overridden line is never called measured, however well the room was measured', () => {
  // The whole point. A sheet of tape readings with one typed-over line on it
  // cannot call that line measured.
  const measured: Room = {
    ...room,
    walls: room.walls.map((wall) =>
      wall.id === 'south' || wall.id === 'east'
        ? {
            ...wall,
            length: verify(wall.length, parseLength(wall.id === 'south' ? `20'` : `10'`), 'sam', T0, 'tape'),
          }
        : wall
    ),
  };
  const measuredSheet = takeoff(measured, '26 Aug 2026');
  assert.equal(find(measuredSheet.lines, 'Floor').provenance, 'measured');

  const { lines } = applyOverrides(measuredSheet.lines, [waste()]);
  assert.equal(provenanceOf(find(lines, 'Floor')), 'scanned');
  assert.equal(provenanceOf(find(lines, 'Ceiling')), 'measured', 'and only that line');
});

test('a quote built on an overridden line does not call itself measured', () => {
  const measured: Room = {
    ...room,
    walls: room.walls.map((wall) =>
      wall.id === 'south' || wall.id === 'east'
        ? {
            ...wall,
            length: verify(wall.length, parseLength(wall.id === 'south' ? `20'` : `10'`), 'sam', T0, 'tape'),
          }
        : wall
    ),
  };
  const { lines } = applyOverrides(takeoff(measured, '26 Aug 2026').lines, [waste()]);
  const priced = quote(
    lines.map((l) => ({ ...l, provenance: provenanceOf(l) })),
    {
      rates: [
        { item: 'Floor', unit: 'sq ft', cents: 800n, source: { kind: 'typed', by: 'sam', at: T0 } },
      ],
    }
  );
  // 215 sq ft at $8.00 is $1,720.00 — the typed number, priced.
  assert.equal(priced.subtotal, 172_000n);
  assert.equal(priced.measured, false);
});

/* ------------------------------------------------------------- when it lapses */

test('an override for a line that is no longer on the sheet is handed back, not dropped', () => {
  // Somebody overrode a line and then changed the room. The quote quietly goes
  // back to the measured number, and nothing would say so.
  const { lines, stranded } = applyOverrides(sheet.lines, [
    waste(),
    waste({ item: 'Opening wrap', quantity: '40.00', why: 'returns on both sides' }),
  ]);
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0]!.item, 'Opening wrap');
  assert.equal(anyOverridden(lines), true, 'the one that still applies still applies');
});

test('an override matches on the unit as well as the name, exactly as pricing does', () => {
  // "Baseboard" is linear feet. An override typed in square feet is a different
  // line, and applying it would price a floor's worth of trim.
  const { lines, stranded } = applyOverrides(sheet.lines, [
    waste({ item: 'Baseboard', unit: 'sq ft', quantity: '90.00' }),
  ]);
  assert.equal(stranded.length, 1);
  assert.equal(find(lines, 'Baseboard').overridden, undefined);
});
