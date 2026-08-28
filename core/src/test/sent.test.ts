import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Handover,
  HandoverError,
  MOST_KEPT,
  addHandover,
  describeHandover,
  handoverFingerprint,
  handoverTime,
  readHandovers,
  recordHandover,
  sayHandovers,
  sendingsOf,
  versionGap,
  writeHandovers,
} from '../sent.ts';

const FIRST = 'a'.repeat(64);
const SECOND = 'b'.repeat(64);
const THIRD = 'c'.repeat(64);

function handover(over: Partial<Handover> = {}): Handover {
  return recordHandover({
    document: 'Dining proposal.html',
    says: 'Dining — proposal',
    mediaType: 'text/html;charset=utf-8',
    bytes: 41_233,
    fingerprint: FIRST,
    at: '2026-08-24T14:03:22-05:00',
    how: 'handed',
    ...over,
  });
}

/* ------------------------------------------------------------ the record */

test('a hand-over keeps what went, which version, when, and how it left', () => {
  const one = handover();
  assert.equal(one.document, 'Dining proposal.html');
  assert.equal(one.says, 'Dining — proposal');
  assert.equal(one.fingerprint, FIRST);
  assert.equal(one.at, '2026-08-24T14:03:22-05:00');
  assert.equal(one.how, 'handed');
  assert.equal(one.bytes, 41_233);
});

test('a fingerprint that is not SHA-256 is refused', () => {
  assert.throws(() => handover({ fingerprint: '' }), HandoverError);
  assert.throws(() => handover({ fingerprint: 'not a hash' }), HandoverError);
  // Upper case hex is a different string from what `handoverFingerprint`
  // produces, and two spellings of one value is how a version check starts
  // failing on documents that never changed.
  assert.throws(() => handover({ fingerprint: 'A'.repeat(64) }), HandoverError);
  assert.throws(() => handover({ fingerprint: FIRST.slice(0, 63) }), HandoverError);
});

test('a time with no offset is refused, because it does not say when', () => {
  assert.throws(() => handover({ at: '2026-08-24T14:03:22' }), HandoverError);
  assert.throws(() => handover({ at: 'yesterday' }), HandoverError);
  assert.doesNotThrow(() => handover({ at: '2026-08-24T19:03:22Z' }));
  assert.doesNotThrow(() => handover({ at: '2026-08-24T14:03:22+05:30' }));
});

test('a record that cannot say what left, or what it was, is refused', () => {
  assert.throws(() => handover({ document: '   ' }), HandoverError);
  assert.throws(() => handover({ says: '' }), HandoverError);
});

test('a size that is not a whole number of bytes is refused', () => {
  assert.throws(() => handover({ bytes: -1 }), HandoverError);
  assert.throws(() => handover({ bytes: 12.5 }), HandoverError);
});

test('a way of leaving the app cannot honestly claim is refused', () => {
  assert.throws(
    () => handover({ how: 'delivered' as unknown as Handover['how'] }),
    HandoverError
  );
});

/* ------------------------------------------- the same document, more than once */

test('the same document sent twice keeps both sendings', () => {
  const log = [
    handover({ at: '2026-08-24T14:03:22-05:00', fingerprint: FIRST }),
    handover({ at: '2026-08-27T09:14:00-05:00', fingerprint: SECOND }),
  ];
  const sendings = sendingsOf(log, 'Dining proposal.html');
  assert.equal(sendings.length, 2);
  // Newest first: the question is always about the last one.
  assert.equal(sendings[0]?.at, '2026-08-27T09:14:00-05:00');
  assert.equal(sendings[1]?.at, '2026-08-24T14:03:22-05:00');
  assert.deepEqual(
    sendings.map((one) => one.fingerprint),
    [SECOND, FIRST]
  );
});

test('two sendings in the same second still read newest first', () => {
  const log = [
    handover({ at: '2026-08-24T14:03:22-05:00', fingerprint: FIRST }),
    handover({ at: '2026-08-24T14:03:22-05:00', fingerprint: SECOND }),
  ];
  assert.equal(sendingsOf(log, 'Dining proposal.html')[0]?.fingerprint, SECOND);
});

test('a different document on the same job is a different record', () => {
  const log = [
    handover({ document: 'Dining proposal.html' }),
    handover({ document: 'Dining claim.pdf', says: 'Dining — claim' }),
  ];
  assert.equal(sendingsOf(log, 'Dining proposal.html').length, 1);
  assert.equal(sendingsOf(log, 'Dining claim.pdf').length, 1);
  assert.equal(sendingsOf(log, 'Kitchen proposal.html').length, 0);
});

/* ---------------------------- a document that changed between sendings */

test('a document changed between sendings is detectable', () => {
  const log = [handover({ fingerprint: FIRST })];
  // Nothing has moved: the copy they hold is this document.
  assert.equal(versionGap(log, 'Dining proposal.html', FIRST), null);

  // A rate went up after it went out. The client is holding the old price.
  const gap = versionGap(log, 'Dining proposal.html', SECOND);
  assert.ok(gap, 'a changed document should report a gap');
  assert.match(gap, /is not this document/);
  assert.match(gap, /two different versions/);
  assert.match(gap, /2026-08-24/);

  // Send the new one, and the gap closes against the new fingerprint while the
  // first sending stays on the record.
  const after = addHandover(log, handover({ at: '2026-08-27T09:14:00-05:00', fingerprint: SECOND }));
  assert.equal(versionGap(after, 'Dining proposal.html', SECOND), null);
  assert.equal(sendingsOf(after, 'Dining proposal.html').length, 2);
  assert.ok(versionGap(after, 'Dining proposal.html', THIRD));
});

test('a document that has never gone out has no version gap to report', () => {
  assert.equal(versionGap([], 'Dining proposal.html', FIRST), null);
});

/* ------------------------------------------------- nothing claims delivery */

test('nothing in a record claims delivery, a recipient, or a read receipt', () => {
  const one = handover();
  const fields = Object.keys(one);
  for (const forbidden of ['sent', 'sentAt', 'delivered', 'to', 'recipient', 'read', 'opened']) {
    assert.ok(!fields.includes(forbidden), `a hand-over must not carry a "${forbidden}" field`);
  }
  // And no value in it is a claim about somebody else's phone either.
  const written = writeHandovers([one]);
  assert.doesNotMatch(written, /deliver/i);
  assert.doesNotMatch(written, /recipient/i);
});

test('what a hand-over says out loud never claims the document arrived', () => {
  const said = describeHandover(handover()).join(' ');
  assert.match(said, /was handed to this phone to send/);
  assert.match(said, /It cannot say it arrived/);
  assert.match(said, /who received it/);
  // "Sent" is the word this module exists to avoid. It must not appear as a
  // statement about the document anywhere a person reads.
  assert.doesNotMatch(said, /\bwas sent\b/i);
  assert.doesNotMatch(said, /\bdelivered\b/i);
  assert.doesNotMatch(said, /\breceipt\b/i);
});

test('a file saved to the device says that, and not that it went anywhere', () => {
  const said = describeHandover(handover({ how: 'saved' })).join(' ');
  assert.match(said, /was saved to this device/);
  assert.match(said, /Where the file went after it was saved is not something the app can see/);
  assert.doesNotMatch(said, /handed to this phone to send/);
});

test('a hand-over says which version went, so it can be checked later', () => {
  const said = describeHandover(handover()).join(' ');
  assert.match(said, /fingerprints to aaaaaaaaaaaaaaaa…/);
  assert.match(said, /SHA-256/);
});

/* -------------------------------------------------- the line under a document */

test('a document with no record does not get called "not sent"', () => {
  const line = sayHandovers([], 'Dining proposal.html', FIRST);
  assert.equal(line, 'Nothing on this phone records this document leaving it.');
  assert.doesNotMatch(line, /not sent/i);
  assert.doesNotMatch(line, /never sent/i);
});

test('the line counts the sendings and says whether the copy out there is this one', () => {
  const once = [handover({ fingerprint: FIRST })];
  assert.equal(
    sayHandovers(once, 'Dining proposal.html', FIRST),
    'This left this phone once, on 2026-08-24. The copy that went is this document.'
  );

  const twice = addHandover(once, handover({ at: '2026-08-27T09:14:00-05:00', fingerprint: FIRST }));
  assert.match(
    sayHandovers(twice, 'Dining proposal.html', FIRST),
    /^This left this phone 2 times, the last on 2026-08-27\./
  );

  // The one worth catching: it went out, and then somebody changed it.
  assert.match(
    sayHandovers(once, 'Dining proposal.html', SECOND),
    /This left this phone once, on 2026-08-24\. The copy that left this phone on 2026-08-24 is not this document\./
  );
});

test('with no current version to compare against, the line makes no claim about which one is out', () => {
  const line = sayHandovers([handover()], 'Dining proposal.html', null);
  assert.equal(line, 'This left this phone once, on 2026-08-24.');
});

/* ------------------------------------------------------------- the log itself */

test('the log round-trips through storage exactly', () => {
  const log = [handover(), handover({ how: 'saved', at: '2026-08-27T09:14:00-05:00' })];
  assert.deepEqual(readHandovers(writeHandovers(log)), log);
});

test('a phone that has never sent anything has an empty record, not a broken one', () => {
  assert.deepEqual(readHandovers(null), []);
  assert.deepEqual(readHandovers(undefined), []);
  assert.deepEqual(readHandovers(''), []);
});

test('an unreadable record refuses out loud rather than reading as "nothing went out"', () => {
  assert.throws(() => readHandovers('{not json'), HandoverError);
  assert.throws(() => readHandovers('{"document":"x"}'), HandoverError);
  // One bad entry refuses the whole log. Silently skipping it would turn
  // missing evidence into a clean negative, which is the opposite answer.
  const half = JSON.stringify([handover(), { document: 'Dining claim.pdf' }]);
  assert.throws(() => readHandovers(half), HandoverError);
  // And the refusal says the record is not being overwritten, because it is not.
  assert.throws(() => readHandovers('{not json'), /not being overwritten/);
});

test('a record with a fingerprint that is not a hash is not read back as one', () => {
  const forged = JSON.stringify([{ ...handover(), fingerprint: 'trust me' }]);
  assert.throws(() => readHandovers(forged), HandoverError);
});

test('the log is capped, and the oldest go first', () => {
  let log: readonly Handover[] = [];
  for (let n = 0; n < MOST_KEPT + 3; n += 1) {
    log = addHandover(log, handover({ says: `Sending ${n}` }));
  }
  assert.equal(log.length, MOST_KEPT);
  assert.equal(log[0]?.says, 'Sending 3');
  assert.equal(log[log.length - 1]?.says, `Sending ${MOST_KEPT + 2}`);
});

/* ------------------------------------------------------------------ the time */

test('the time is ISO 8601 with the offset, and it is the same instant', () => {
  const when = new Date(Date.UTC(2026, 7, 24, 19, 3, 22));
  const stamp = handoverTime(when);
  assert.match(stamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  assert.equal(Date.parse(stamp), when.getTime());
  // It is accepted by the record, which requires an offset.
  assert.doesNotThrow(() => handover({ at: stamp }));
});

test('the offset is printed the way ISO 8601 prints it, not the way the browser counts it', () => {
  // `getTimezoneOffset` counts minutes *behind* UTC, so a phone in India (+5:30)
  // reports -330. Printing that sign straight through gives "-05:30" for a
  // clock five and a half hours ahead — a nine-hour error, and silent.
  const when = new Date(Date.UTC(2026, 7, 24, 19, 3, 22));
  const ahead = -when.getTimezoneOffset();
  const stamp = handoverTime(when);
  const sign = stamp.slice(-6, -5);
  if (ahead > 0) assert.equal(sign, '+');
  else if (ahead < 0) assert.equal(sign, '-');
  else assert.equal(stamp.slice(-6), '+00:00');
});

/* ----------------------------------------------------------- the fingerprint */

test('the fingerprint is of the bytes that went, and it moves when they do', async () => {
  const one = await handoverFingerprint(new TextEncoder().encode('the proposal, at $8.75'));
  const same = await handoverFingerprint(new TextEncoder().encode('the proposal, at $8.75'));
  const other = await handoverFingerprint(new TextEncoder().encode('the proposal, at $9.75'));
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.equal(one, same);
  assert.notEqual(one, other);
  // The published SHA-256 of the empty input, so this is checked against
  // something outside this repository rather than against itself.
  assert.equal(
    await handoverFingerprint(new Uint8Array()),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

test('a fingerprint straight from the hasher is accepted by the record', async () => {
  const fingerprint = await handoverFingerprint(new TextEncoder().encode('a claim document'));
  assert.doesNotThrow(() => handover({ fingerprint }));
});
