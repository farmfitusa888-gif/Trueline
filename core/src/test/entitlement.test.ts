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
  mayKeepRoom,
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

test('one room is free, which is what Sam asked for in those words', () => {
  // > "CHANGE IT TO 1 FREE ROOM EVERYWHERE AND BUILD IT!"
  //
  // Pinned rather than assumed. The number is said on the paywall, said in the
  // lock, and enforced by `mayKeepRoom`, and the three going out of step is how
  // an app ends up advertising two and giving one.
  assert.equal(FREE_ROOMS, 1);
});

test('the free room limit is never allowed to read as a cap on what is kept', () => {
  // The sentence a person meets has to say the opposite of what a limit
  // normally means, because this one does. Somebody who scanned five rooms
  // while it was free keeps five.
  const said = describeLock('unlimitedRooms');
  assert.match(said, /stays there and stays readable/);
  assert.match(said, /never about taking away work/);
});

/* --------------------------------------------------------------- keeping rooms */

test('the first room is kept by somebody who has never paid', () => {
  const answer = mayKeepRoom([], 'Kitchen', false);
  assert.equal(answer.keep, true);
  assert.equal(answer.because, '');
});

test('a second room is refused, and the refusal says the first is safe', () => {
  const answer = mayKeepRoom(['Kitchen'], 'Hall', false);
  assert.equal(answer.keep, false);
  assert.match(answer.because, /part of the subscription/);
  assert.match(answer.because, /untouched/);
  assert.match(answer.because, /writing down a new one/);
  // Never the word that turns a description into a toll gate.
  assert.doesNotMatch(answer.because, /upgrade|unlock|premium|pro only/i);
});

test('saving a room that is already kept is never refused, however many there are', () => {
  // The branch that stops this gate eating somebody's work. A correction to a
  // room already on the phone is not a new room, and refusing it would lose ten
  // minutes done standing up with a tape.
  const five = ['Kitchen', 'Hall', 'Garage', 'Bath', 'Deck'];
  for (const room of five) {
    assert.equal(mayKeepRoom(five, room, false).keep, true, room);
  }
});

test('five rooms scanned while it was free are all still kept when the gate comes on', () => {
  // The exact shape of the thing that must never happen: the gate turns on and
  // somebody loses an afternoon. Every one of the five re-saves; only a sixth,
  // new one is stopped.
  const five = ['Kitchen', 'Hall', 'Garage', 'Bath', 'Deck'];
  assert.equal(five.filter((room) => mayKeepRoom(five, room, false).keep).length, 5);
  assert.equal(mayKeepRoom(five, 'Loft', false).keep, false);
});

test('a subscription keeps anything, including a room that has never been seen', () => {
  const many = Array.from({ length: 40 }, (_, i) => `Room ${i}`);
  assert.equal(mayKeepRoom(many, 'Room 41', true).keep, true);
  assert.equal(mayKeepRoom(many, 'Room 41', true).because, '');
});

test('the refusal counts the rooms that are there, and says it as a person would', () => {
  // Worked out here rather than read back from the sentence: two rooms kept,
  // so the sentence has to say two and has to say them in the plural.
  assert.match(mayKeepRoom(['a', 'b'], 'c', false).because, /The two rooms already here are/);
  assert.match(mayKeepRoom(['a'], 'c', false).because, /The one room already here is/);
});

test('the number in the lock is the number the gate enforces', () => {
  // The drift that matters: a screen offering more free rooms than the gate
  // allows, or fewer. `FREE_ROOMS` rooms may be kept and one more may not.
  const kept = Array.from({ length: FREE_ROOMS }, (_, i) => `Room ${i}`);
  assert.equal(mayKeepRoom(kept.slice(0, FREE_ROOMS - 1), 'new', false).keep, true);
  assert.equal(mayKeepRoom(kept, 'new', false).keep, false);
});
