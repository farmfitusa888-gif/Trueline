import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Feature,
  FREE,
  FREE_ROOMS,
  PAID,
  WHAT_IT_DOES,
  allowed,
  describeLock,
  isFree,
} from '../entitlement.ts';

/**
 * The properties that matter about a paywall are not about money. They are:
 * every feature is decided one way or the other, the free half is genuinely
 * useful on its own, and the screen selling the paid half advertises exactly
 * what the gate unlocks.
 */

test('every feature is either free or paid, and none is both or neither', () => {
  const all = Object.keys(WHAT_IT_DOES) as Feature[];
  for (const feature of all) {
    const free = FREE.includes(feature);
    const paid = PAID.includes(feature);
    assert.ok(free !== paid, `${feature} is ${free && paid ? 'both' : 'neither'}`);
  }
  assert.equal(FREE.length + PAID.length, all.length);
});

test('measuring a room is free and stays free', () => {
  // This is the promise the free tier is, and the thing that makes an app store
  // reviewer's "no standalone value" question answerable.
  for (const feature of ['scan', 'measure', 'plan', 'room3d', 'edit', 'dimensions'] as const) {
    assert.ok(isFree(feature), feature);
    assert.ok(allowed(feature, false), `${feature} must work without a subscription`);
  }
});

test('everything that turns a drawing into money is paid', () => {
  for (const feature of ['takeoff', 'pricing', 'proposal', 'signature', 'changeOrders'] as const) {
    assert.equal(allowed(feature, false), false, feature);
    assert.equal(allowed(feature, true), true, feature);
  }
});

test('a subscription unlocks everything, and unlocks nothing extra', () => {
  const all = Object.keys(WHAT_IT_DOES) as Feature[];
  for (const feature of all) assert.ok(allowed(feature, true), feature);
});

test('every feature says what it does, not that it is locked', () => {
  const all = Object.keys(WHAT_IT_DOES) as Feature[];
  for (const feature of all) {
    const said = describeLock(feature);
    assert.ok(said.length > 20, `${feature} needs a real sentence`);
    // "Upgrade to unlock" tells somebody nothing except that they cannot have
    // it. Every one of these has to describe the thing itself.
    assert.doesNotMatch(said, /upgrade|unlock|premium|pro only/i, feature);
  }
});

test('the paywall list and the gate cannot drift apart', () => {
  // PAID is derived from the same table the gate reads, so a feature added to
  // one is added to the other. If this ever fails, the screen is advertising
  // something the gate does not unlock -- or hiding something it does.
  for (const feature of PAID) assert.equal(isFree(feature), false, feature);
  for (const feature of FREE) assert.equal(PAID.includes(feature), false, feature);
});

test('the free room limit is enough to be useful and small enough to be a limit', () => {
  // One room is a demonstration. Two is a kitchen and the hall beside it, which
  // is enough to see the app is real -- and the point at which somebody pricing
  // a whole house finds the wall.
  assert.ok(FREE_ROOMS >= 2 && FREE_ROOMS <= 3, `${FREE_ROOMS}`);
});
