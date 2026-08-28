import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../signature.ts';
import {
  type FileBackRequest,
  AGREED_BY_SAYS,
  CAME_BACK_SAYS,
  CountersignError,
  WEAKER_THAN_SIGNING_HERE,
  checkReturned,
  describeReturned,
  fileSignedBack,
  notTheSignedVersion,
  whatItDoesNotProve,
  whatItProves,
} from '../countersign.ts';

/** A stand-in for a proposal: this module never looks inside, only hashes. */
const DOCUMENT = {
  id: 'prop-1',
  roomName: 'Gilbert kitchen',
  total: 1_234_56n,
};

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const PDF = 'data:application/pdf;base64,JVBERi0xLjQK';

async function request(over: Partial<FileBackRequest> = {}): Promise<FileBackRequest> {
  return {
    id: 'back-1',
    jobName: 'Gilbert kitchen',
    documentId: 'prop-1',
    documentKind: 'proposal',
    sentHash: await hashOf(DOCUMENT),
    sentAt: '2026-08-24T16:00:00.000Z',
    saysSignedBy: 'M. Alvarez',
    saysSignedOn: '2026-08-25',
    cameBackAt: '2026-08-26T09:30:00.000Z',
    cameBackBy: 'photograph',
    copy: PHOTO,
    note: '',
    ...over,
  };
}

/* ============================================================ filing one */

test('a signed copy files against the job and the document it signs', async () => {
  const filed = await fileSignedBack(DOCUMENT, await request());
  assert.equal(filed.jobName, 'Gilbert kitchen');
  assert.equal(filed.documentId, 'prop-1');
  assert.equal(filed.documentKind, 'proposal');
  assert.equal(filed.saysSignedBy, 'M. Alvarez');
  assert.equal(filed.saysSignedOn, '2026-08-25');
  assert.equal(filed.cameBackBy, 'photograph');
  assert.equal(filed.copyType, 'image/jpeg');
});

test('the returned file is fingerprinted too, so the picture cannot be swapped', async () => {
  const filed = await fileSignedBack(DOCUMENT, await request());
  const other = await fileSignedBack(
    DOCUMENT,
    await request({ copy: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==' })
  );
  assert.match(filed.copyHash, /^[0-9a-f]{64}$/);
  assert.notEqual(filed.copyHash, other.copyHash);
  // The same picture filed twice fingerprints the same, or the value proves
  // nothing at all.
  const again = await fileSignedBack(DOCUMENT, await request({ id: 'back-2' }));
  assert.equal(filed.copyHash, again.copyHash);
});

/* ================================================ the binding to the document */

test('a document that has changed since it went out is refused, loudly', async () => {
  // The proposal was emailed, then a price was edited, and only then did the
  // signed sheet come back. Filing it here would put a signature against a
  // version nobody ever saw, and the record would look perfect.
  const moved = { ...DOCUMENT, total: 1_500_00n };
  const asked = await request();
  await assert.rejects(() => fileSignedBack(moved, asked), (error: unknown) => {
    assert.ok(error instanceof CountersignError);
    assert.match(error.message, /not the document that was sent out/);
    assert.match(error.message, /version they never saw/);
    return true;
  });
});

test('the same document files fine, so the refusal is about the change and not the check', async () => {
  const filed = await fileSignedBack({ ...DOCUMENT }, await request());
  assert.equal(filed.sentHash, await hashOf(DOCUMENT));
});

test('a filed copy can be re-checked against the document later', async () => {
  const filed = await fileSignedBack(DOCUMENT, await request());
  const still = await checkReturned(DOCUMENT, filed);
  assert.equal(still.ok, true);

  const drifted = await checkReturned({ ...DOCUMENT, total: 9_99n }, filed);
  assert.equal(drifted.ok, false);
  if (!drifted.ok) {
    assert.match(drifted.why, /M\. Alvarez signed and sent back on 2026-08-25/);
    assert.match(drifted.why, /belongs in a change order/);
  }
});

/* ================================================================= refusals */

test('a copy with nobody’s name on it is refused', async () => {
  const asked1 = await request({ saysSignedBy: '   ' });
  await assert.rejects(
    () => fileSignedBack(DOCUMENT, asked1),
    (error: unknown) => {
      assert.ok(error instanceof CountersignError);
      assert.match(error.message, /attributes to nobody/);
      return true;
    }
  );
});

test('a signing date before the document was sent is refused', async () => {
  const asked2 = await request({ saysSignedOn: '2026-08-23' });
  await assert.rejects(
    () => fileSignedBack(DOCUMENT, asked2),
    (error: unknown) => {
      assert.ok(error instanceof CountersignError);
      assert.match(error.message, /before the document was sent/);
      return true;
    }
  );
});

test('a signing date after the copy arrived is refused', async () => {
  const asked3 = await request({ saysSignedOn: '2026-08-27' });
  await assert.rejects(
    () => fileSignedBack(DOCUMENT, asked3),
    (error: unknown) => {
      assert.ok(error instanceof CountersignError);
      assert.match(error.message, /after it came back/);
      return true;
    }
  );
});

test('a date that is not a date is refused rather than kept', async () => {
  const asked4 = await request({ saysSignedOn: 'last Tuesday' });
  await assert.rejects(
    () => fileSignedBack(DOCUMENT, asked4),
    CountersignError
  );
  const asked5 = await request({ cameBackAt: 'this morning' });
  await assert.rejects(
    () => fileSignedBack(DOCUMENT, asked5),
    CountersignError
  );
});

test('anything that is not a photograph or a PDF is refused', async () => {
  const asked6 = await request({ copy: '' });
  await assert.rejects(
    () => fileSignedBack(DOCUMENT, asked6),
    (error: unknown) => {
      assert.ok(error instanceof CountersignError);
      assert.match(error.message, /signed copy itself is missing/);
      return true;
    }
  );
  const asked7 = await request({ copy: 'data:text/html,<b>signed</b>' });
  await assert.rejects(
    () => fileSignedBack(DOCUMENT, asked7),
    (error: unknown) => {
      assert.ok(error instanceof CountersignError);
      assert.match(error.message, /photograph or a PDF/);
      return true;
    }
  );
});

test('a record that describes the wrong kind of file is refused', async () => {
  // "A signed PDF" written over a photograph is a small false statement that a
  // contractor would repeat without knowing he was making it.
  const asked8 = await request({ cameBackBy: 'pdf' });
  await assert.rejects(
    () => fileSignedBack(DOCUMENT, asked8),
    (error: unknown) => {
      assert.ok(error instanceof CountersignError);
      assert.match(error.message, /not a PDF/);
      return true;
    }
  );
  const asked9 = await request({ copy: PDF });
  await assert.rejects(
    () => fileSignedBack(DOCUMENT, asked9),
    (error: unknown) => {
      assert.ok(error instanceof CountersignError);
      assert.match(error.message, /not a photograph/);
      return true;
    }
  );
  // Paper handed over and then scanned is either, and neither is a lie.
  const scanned = await fileSignedBack(
    DOCUMENT,
    await request({ cameBackBy: 'paper', copy: PDF })
  );
  assert.equal(scanned.copyType, 'application/pdf');
});

test('a copy filed against no job and no document is refused', async () => {
  const asked10 = await request({ documentId: '' });
  await assert.rejects(
    () => fileSignedBack(DOCUMENT, asked10),
    (error: unknown) => {
      assert.ok(error instanceof CountersignError);
      assert.match(error.message, /a picture in a folder/);
      return true;
    }
  );
});

/* ================================================== honesty about the evidence */

test('what it proves and what it does not are both written out', async () => {
  const filed = await fileSignedBack(DOCUMENT, await request());
  const proves = whatItProves(filed).join(' ');
  assert.match(proves, /says they signed it on 2026-08-25/);
  assert.match(proves, /SHA-256/);

  const does_not = whatItDoesNotProve(filed).join(' ');
  assert.match(does_not, /is the person who made the mark/);
  assert.match(does_not, /has not verified anybody’s identity/);
  assert.match(does_not, /their word for it/);
  assert.match(does_not, /agreed separately to sign electronically/);
  assert.equal(whatItDoesNotProve(filed).length, 4);
});

test('the record never claims the strength of a signature taken here', async () => {
  const filed = await fileSignedBack(DOCUMENT, await request({ note: 'Texted it Tuesday night.' }));
  const said = describeReturned(filed).join(' ');
  assert.match(said, /What it does not show:/);
  assert.match(said, /Your note: Texted it Tuesday night\./);
  assert.match(WEAKER_THAN_SIGNING_HERE, /weaker evidence than a signature taken here/);
});

test('a returned copy is not a signature and cannot be mistaken for one', async () => {
  const filed = await fileSignedBack(DOCUMENT, await request());
  // The field names are the guard: nothing on this record is called `who`,
  // `at`, `intent`, `consented` or `documentHash`, so it cannot be dropped
  // into a place that wants a `Signature` and read as one.
  for (const name of ['who', 'at', 'intent', 'consented', 'mark', 'documentHash', 'role']) {
    assert.equal(name in filed, false, `a returned copy must not carry "${name}"`);
  }
});

/* ================================ the words two modules have to share */

test('both ways of naming how it arrived read as English where they are used', () => {
  // Two maps because they finish two different sentences, and the bug they
  // exist to stop is "agreed by on paper, by hand" printed on a bill.
  for (const by of ['photograph', 'pdf', 'paper'] as const) {
    assert.ok(`it came back ${CAME_BACK_SAYS[by]}`.length > 0);
    assert.doesNotMatch(`Agreed by ${AGREED_BY_SAYS[by]}`, /Agreed by on /);
    assert.match(`Agreed by ${AGREED_BY_SAYS[by]}`, /^Agreed by a /);
  }
});

test('a drifted document gets one sentence, wherever it is noticed', async () => {
  const filed = await fileSignedBack(DOCUMENT, await request());
  const seal = await checkReturned({ ...DOCUMENT, total: 9_99n }, filed);
  assert.equal(seal.ok, false);
  // `baseline.ts` raises the same alarm for a baseline frozen on a returned
  // copy, and it has to raise it in exactly these words -- two hand-written
  // copies of one sentence drift, and the one that drifts is the one on the
  // document the contractor hands over.
  assert.equal(
    seal.ok === false ? seal.why : '',
    notTheSignedVersion('proposal', 'M. Alvarez', '2026-08-25')
  );
  assert.match(
    notTheSignedVersion('proposal', 'M. Alvarez', '2026-08-25'),
    /not the proposal M\. Alvarez signed and sent back on 2026-08-25/
  );
});
