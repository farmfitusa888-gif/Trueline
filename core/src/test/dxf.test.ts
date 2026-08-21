import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeDxf } from '../dxf/complete.ts';
import { DxfTextError, findSection, parseTags, splitEntities, writeTags } from '../dxf/tags.ts';
import { readFileSync } from 'node:fs';

const SAMPLE = new URL('../../tools/proof.dxf', import.meta.url).pathname;

function load(): string {
  return readFileSync(SAMPLE, 'utf8');
}

test('tags survive a round trip unchanged in meaning', () => {
  const text = load();
  const tags = parseTags(text);
  assert.ok(tags.length > 50);
  assert.equal(parseTags(writeTags(tags)).length, tags.length);
});

test('a file that is not a DXF is refused', () => {
  assert.throws(() => parseTags('hello\nworld\nnot a code\n1'), DxfTextError);
});

test('every dimension is given geometry it did not have', () => {
  const { dxf, report } = completeDxf(load());
  assert.equal(report.dimensionsGivenGeometry, 3);

  const before = parseTags(load());
  const after = parseTags(dxf);
  const blocksBefore = before.filter((t) => t.code === 2 && t.value.startsWith('*D')).length;
  const blocksAfter = after.filter((t) => t.code === 2 && t.value.startsWith('*D')).length;
  assert.equal(blocksBefore, 0, 'the source file should have no dimension blocks');
  assert.ok(blocksAfter >= 6, 'each block is named on its record, its definition and its dimension');
});

test('the generated geometry measures what the dimension actually spans', () => {
  const { report } = completeDxf(load());
  const measured = report.measurements.map((m) => Number(m.toFixed(6)));
  assert.deepEqual(measured, [148.5, 96, 150]);
});

test('the aligned dimension measures along itself, not across', () => {
  // The 120 x 90 diagonal is 150 by Pythagoras. Reading 120 would mean the
  // geometry had been projected onto the horizontal, which is the failure that
  // started all of this.
  const { report } = completeDxf(load());
  // This module works in floating point because DXF does, so the assertion is a
  // tolerance rather than an equality. The core stays exact; this boundary does not.
  const near = (target: number) => report.measurements.some((m) => Math.abs(m - target) < 1e-9);
  assert.ok(near(150), `expected 150 among ${report.measurements}`);
  assert.ok(!near(120), 'measured the horizontal component, not the length');
});

test('layouts are added, so a printer has a page to print onto', () => {
  const { dxf, report } = completeDxf(load());
  assert.equal(report.layoutsAdded, 2);
  const tags = parseTags(dxf);
  const layouts = tags.filter((t) => t.code === 0 && t.value === 'LAYOUT');
  assert.equal(layouts.length, 2);
  assert.ok(dxf.includes('Model'));
  assert.ok(dxf.includes('Layout1'));
});

test('the paper size is stated rather than left to a guess', () => {
  const { dxf } = completeDxf(load(), { paper: { width: 297, height: 210 } });
  assert.ok(dxf.includes('297'));
  assert.ok(dxf.includes('210'));
});

test('completing an already complete file changes nothing', () => {
  const once = completeDxf(load()).dxf;
  const twice = completeDxf(once);
  assert.equal(twice.report.dimensionsGivenGeometry, 0,
    'a dimension that already names a block must be left alone');
});

test('the text drawn is the measurement, to the requested precision', () => {
  const { dxf } = completeDxf(load(), { decimals: 3 });
  assert.ok(dxf.includes('148.500'), 'expected the wall length as text in the file');
  assert.ok(dxf.includes('150.000'), 'expected the diagonal as text in the file');
});

test('an override on the dimension wins over the measurement', () => {
  const patched = load().replace(/^DIMENSION$/m, 'DIMENSION');
  const tags = parseTags(patched);
  const start = findSection(tags, 'ENTITIES');
  const entities = splitEntities(tags, start + 2, tags.length);
  const dim = entities.find((e) => e[0]?.value === 'DIMENSION');
  assert.ok(dim, 'the sample should contain a dimension to work with');
});

test('a file with no entities section is refused rather than half-processed', () => {
  assert.throws(() => completeDxf('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n'), DxfTextError);
});
