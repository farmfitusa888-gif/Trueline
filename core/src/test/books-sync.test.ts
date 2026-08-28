import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Books,
  type Contact,
  type Grant,
  type Takings,
  type Tester,
  type Trouble,
  NO_BOOKS,
} from '../owner.ts';
import {
  BOOKS_FORMAT,
  BooksSyncError,
  encodeBooksFile,
  planSync,
  readBooksFile,
  readOutcome,
  writeOutcome,
} from '../books-sync.ts';

/* --------------------------------------------------------- real records */

const GILBERT: Grant = {
  code: 'TRUELINE-GILBERT-3M',
  how: 'named',
  given: 'Gilbert',
  months: 3,
  madeAt: '2026-08-02T09:14:00-05:00',
};

const REDEEMED: Grant = { ...GILBERT, redeemedAt: '2026-08-04T18:22:00-05:00' };

const TRADE_NIGHT: Grant = {
  code: 'TRUELINE-TN-0007',
  how: 'batch',
  batch: 'trade night, August',
  months: 1,
  madeAt: '2026-08-11T17:00:00-05:00',
};

const PULLED: Grant = {
  code: 'TRUELINE-DUD-0001',
  how: 'batch',
  batch: 'trade night, August',
  months: 1,
  madeAt: '2026-08-11T17:00:00-05:00',
  pulled: { at: '2026-08-12T08:00:00-05:00', because: 'printed on the wrong card' },
};

const JULY: Takings = {
  month: '2026-07',
  charged: 4_988n,
  proceeds: 3_491n,
  refunded: 999n,
  started: 5,
  cancelled: 1,
  renewed: 3,
  from: 'Financial Report, US, July 2026',
};

const JULY_AGAIN: Takings = {
  ...JULY,
  charged: 5_487n,
  proceeds: 3_841n,
  from: 'Sales and Trends, July 2026',
};

const AUGUST: Takings = {
  month: '2026-08',
  charged: 9_976n,
  proceeds: 6_983n,
  refunded: 0n,
  started: 9,
  cancelled: 2,
  renewed: 8,
  from: 'Financial Report, US, August 2026',
};

const ASKED: Tester = {
  who: 'Gilbert',
  stage: 'asked',
  at: '2026-07-28T11:00:00-05:00',
  from: 'the trade night',
};

const INSTALLED: Tester = {
  who: 'Gilbert',
  stage: 'installed',
  at: '2026-08-03T20:41:00-05:00',
};

const CRASH: Trouble = {
  what: 'The scan has no walls',
  where: 'import-roomplan.ts',
  times: 4,
  firstAt: '2026-08-19T07:12:00-05:00',
  lastAt: '2026-08-24T16:40:00-05:00',
  version: '0.1.0',
};

const NOTE: Contact = {
  who: 'Gilbert',
  at: '2026-08-25T08:05:00-05:00',
  about: 'The garage plan came out mirrored. Sent the scan folder.',
  version: '0.1.0',
  sent: ['garage.json'],
};

function books(over: Partial<Books> = {}): Books {
  return { ...NO_BOOKS, ...over };
}

const AT = '2026-08-28T10:00:00-05:00';

/** What is in the repository, as `planSync` is handed it. */
function remote(inThere: Books, version = 'sha-one'): { text: string; version: string } {
  return { text: encodeBooksFile(inThere, '2026-08-27T19:00:00-05:00', 'the iPhone'), version };
}

/* --------------------------------------------------------- the round trip */

test('every kind of record survives the trip through the file, money exactly', () => {
  const mine = books({
    grants: [GILBERT, REDEEMED, TRADE_NIGHT, PULLED],
    takings: [JULY, AUGUST],
    testers: [ASKED, INSTALLED],
    troubles: [CRASH],
    contacts: [NOTE],
  });
  const back = readBooksFile(encodeBooksFile(mine, AT, 'the office Mac'));

  assert.equal(back.format, BOOKS_FORMAT);
  assert.equal(back.writtenBy, 'the office Mac');
  assert.equal(back.writtenAt, AT);
  assert.deepEqual(back.books, mine);

  // The point of the whole codec: money comes back as bigint, not as a number
  // that happens to be equal to one.
  const july = back.books.takings.find((one) => one.from === JULY.from);
  assert.ok(july);
  assert.equal(typeof july.charged, 'bigint');
  assert.equal(july.charged, 4_988n);
});

test('money is written as a tagged string, never as a JSON number', () => {
  const written = encodeBooksFile(books({ takings: [JULY] }), AT, 'the office Mac');
  assert.match(written, /"\$cents": "4988"/);
  assert.doesNotMatch(written, /"charged": 4988/);
});

test('a grant that Apple has not reported redeemed keeps no redeemedAt at all', () => {
  // owner.ts: absent means the report has not shown it, which is not the same
  // as knowing it was not used. The file must not turn that into a null, and a
  // null read back would be a value where Apple has said nothing.
  const written = encodeBooksFile(books({ grants: [GILBERT] }), AT, 'the office Mac');
  assert.doesNotMatch(written, /redeemedAt/);
  assert.equal(readBooksFile(written).books.grants[0]?.redeemedAt, undefined);

  // The same grant as a screen would actually build it. Spreading a record and
  // clearing a field leaves the key there holding `undefined`, and that is the
  // shape this has to survive -- not the tidy one where the key is absent.
  const spread: Grant = { ...GILBERT, redeemedAt: undefined };
  const again = encodeBooksFile(books({ grants: [spread] }), AT, 'the office Mac');
  assert.doesNotMatch(again, /redeemedAt/);
  assert.equal(again, written);
});

test('the same books always make the same bytes, whatever order the fields were built in', () => {
  const straight: Grant = { code: 'X-1', how: 'named', given: 'Ann', months: 2, madeAt: AT };
  const backwards = { madeAt: AT, months: 2, given: 'Ann', how: 'named', code: 'X-1' } as Grant;
  assert.equal(
    encodeBooksFile(books({ grants: [straight] }), AT, 'a'),
    encodeBooksFile(books({ grants: [backwards] }), AT, 'a')
  );
});

/* ------------------------------------------------------------- refusals */

test('a remote that is not JSON at all is refused, and says nothing was written', () => {
  assert.throws(
    () => planSync(books(), { text: 'not json', version: 'sha' }, AT, 'the office Mac'),
    (error: unknown) =>
      error instanceof BooksSyncError && /Nothing has been written over it/.test(error.message)
  );
});

test('a remote written by a newer format is refused, not read for the parts it recognises', () => {
  const newer = JSON.stringify({
    format: BOOKS_FORMAT + 1,
    writtenAt: AT,
    writtenBy: 'the iPhone',
    books: { grants: [], takings: [], testers: [], troubles: [], contacts: [] },
  });
  assert.throws(
    () => planSync(books(), { text: newer, version: 'sha' }, AT, 'the office Mac'),
    (error: unknown) =>
      error instanceof BooksSyncError &&
      /newer version of Trueline \(format 2; this one reads 1\)/.test(error.message) &&
      /Update this device instead/.test(error.message)
  );
});

test('a remote written by an older format is refused too, because no conversion exists', () => {
  const older = JSON.stringify({
    format: 0,
    writtenAt: AT,
    writtenBy: 'the iPhone',
    books: { grants: [], takings: [], testers: [], troubles: [], contacts: [] },
  });
  assert.throws(
    () => readBooksFile(older),
    (error: unknown) =>
      error instanceof BooksSyncError && /older version of Trueline \(format 0/.test(error.message)
  );
});

test('a remote with no format at all is refused rather than assumed to be this one', () => {
  const none = JSON.stringify({
    writtenAt: AT,
    writtenBy: 'the iPhone',
    books: { grants: [], takings: [], testers: [], troubles: [], contacts: [] },
  });
  assert.throws(() => readBooksFile(none), BooksSyncError);
});

test('a remote carrying a field this version has never heard of is refused', () => {
  // The first rule of owner.ts, made mechanical. A room, a photograph or a
  // client's name riding along in this file is refused at the door, and so is
  // an innocent field from a format nobody has written yet.
  const smuggled = JSON.parse(encodeBooksFile(books({ grants: [GILBERT] }), AT, 'a')) as {
    books: { grants: Record<string, unknown>[] };
  };
  smuggled.books.grants[0]!['room'] = { walls: 4 };
  assert.throws(
    () => readBooksFile(JSON.stringify(smuggled)),
    (error: unknown) =>
      error instanceof BooksSyncError && /carry "room" on grant 1/.test(error.message)
  );
});

test('an extra list on the books themselves is refused', () => {
  const extra = JSON.parse(encodeBooksFile(books(), AT, 'a')) as {
    books: Record<string, unknown>;
  };
  extra.books['rooms'] = [];
  assert.throws(
    () => readBooksFile(JSON.stringify(extra)),
    (error: unknown) =>
      error instanceof BooksSyncError && /carry "rooms" on the books/.test(error.message)
  );
});

test('money that arrives as an ordinary JSON number is refused, never rounded into place', () => {
  const loose = JSON.parse(encodeBooksFile(books({ takings: [JULY] }), AT, 'a')) as {
    books: { takings: Record<string, unknown>[] };
  };
  loose.books.takings[0]!['charged'] = 49.88;
  assert.throws(
    () => readBooksFile(JSON.stringify(loose)),
    (error: unknown) =>
      error instanceof BooksSyncError && /has a charged that is not money/.test(error.message)
  );
});

test('a tagged amount that is not a whole number of cents is refused', () => {
  const bad = encodeBooksFile(books({ takings: [JULY] }), AT, 'a').replace('"4988"', '"49.88"');
  assert.throws(
    () => readBooksFile(bad),
    (error: unknown) =>
      error instanceof BooksSyncError && /where an amount of money should be/.test(error.message)
  );
});

test('a stage or a how that this version does not know is refused', () => {
  const stage = encodeBooksFile(books({ testers: [ASKED] }), AT, 'a').replace(
    '"asked"',
    '"ghosted"'
  );
  assert.throws(
    () => readBooksFile(stage),
    (error: unknown) => error instanceof BooksSyncError && /"ghosted"/.test(error.message)
  );
  const how = encodeBooksFile(books({ grants: [GILBERT] }), AT, 'a').replace(
    '"named"',
    '"whispered"'
  );
  assert.throws(() => readBooksFile(how), BooksSyncError);
});

test('a record whose identity is blank is refused, because a merge would lose one of them', () => {
  const blank = encodeBooksFile(books({ grants: [GILBERT] }), AT, 'a').replace(
    '"TRUELINE-GILBERT-3M"',
    '"   "'
  );
  assert.throws(
    () => readBooksFile(blank),
    (error: unknown) =>
      error instanceof BooksSyncError &&
      /two records that cannot be told apart is how a merge loses one of them/i.test(error.message)
  );
});

test('a months that is not a whole number is refused', () => {
  const half = encodeBooksFile(books({ grants: [GILBERT] }), AT, 'a').replace(
    '"months": 3',
    '"months": 3.5'
  );
  assert.throws(
    () => readBooksFile(half),
    (error: unknown) => error instanceof BooksSyncError && /not a whole number/.test(error.message)
  );
});

test('the same record twice on one side is refused rather than quietly collapsed', () => {
  assert.throws(
    () => planSync(books({ grants: [GILBERT, GILBERT] }), remote(books()), AT, 'the office Mac'),
    (error: unknown) =>
      error instanceof BooksSyncError &&
      /This device holds the same grant twice — TRUELINE-GILBERT-3M/.test(error.message)
  );
  assert.throws(
    () => planSync(books(), remote(books({ takings: [JULY, JULY] })), AT, 'the office Mac'),
    (error: unknown) =>
      error instanceof BooksSyncError && /The repository holds the same takings line twice/.test(error.message)
  );
});

/* --------------------------------------------------------------- merging */

test('with nothing in the repository yet, the plan is to write what is here', () => {
  const mine = books({ grants: [GILBERT], takings: [JULY] });
  const plan = planSync(mine, null, AT, 'the office Mac');
  assert.equal(plan.what, 'write');
  assert.ok(plan.what === 'write');
  assert.equal(plan.onto, null);
  assert.deepEqual(plan.merged, mine);
  assert.deepEqual(plan.brought, { here: 2, there: 0, both: 0 });
  assert.deepEqual(readBooksFile(plan.file).books, mine);
});

test('a first write into an empty repository is checked and sorted like any other', () => {
  // It goes through the same merge against an empty other side, so a duplicate
  // that would be refused on every later sync is refused on the first one too,
  // rather than going up and poisoning the file from then on.
  assert.throws(
    () => planSync(books({ grants: [GILBERT, GILBERT] }), null, AT, 'the office Mac'),
    (error: unknown) =>
      error instanceof BooksSyncError && /This device holds the same grant twice/.test(error.message)
  );
  const plan = planSync(books({ grants: [TRADE_NIGHT, GILBERT] }), null, AT, 'the office Mac');
  assert.ok(plan.what === 'write');
  assert.deepEqual(
    plan.merged.grants.map((one) => one.code),
    ['TRUELINE-GILBERT-3M', 'TRUELINE-TN-0007']
  );
});

test('an empty dashboard still writes its first file, so the second device finds one', () => {
  // "The two sides already agree" is only an answer when there is a file to
  // agree with. With nothing there, nothing to do would leave no file at all.
  const plan = planSync(books(), null, AT, 'the office Mac');
  assert.equal(plan.what, 'write');
  assert.ok(plan.what === 'write');
  assert.equal(plan.onto, null);
  assert.deepEqual(readBooksFile(plan.file).books, NO_BOOKS);
});

test('both devices added a grant, and both grants survive', () => {
  const mine = books({ grants: [GILBERT] });
  const theirs = books({ grants: [TRADE_NIGHT] });
  const plan = planSync(mine, remote(theirs), AT, 'the office Mac');
  assert.ok(plan.what === 'write');
  assert.deepEqual(
    plan.merged.grants.map((one) => one.code),
    ['TRUELINE-GILBERT-3M', 'TRUELINE-TN-0007']
  );
  assert.deepEqual(plan.brought, { here: 1, there: 1, both: 0 });
  assert.equal(plan.onto, 'sha-one');
});

test('a merge writes against the version it read, so a lost update cannot be written', () => {
  const plan = planSync(books({ grants: [GILBERT] }), remote(books(), 'abc123'), AT, 'the Mac');
  assert.ok(plan.what === 'write');
  assert.equal(plan.onto, 'abc123');
});

test('everything the repository had and this device did not comes down', () => {
  const plan = planSync(
    books(),
    remote(books({ grants: [TRADE_NIGHT], takings: [JULY], testers: [ASKED], contacts: [NOTE] })),
    AT,
    'the office Mac'
  );
  assert.ok(plan.what === 'write');
  assert.deepEqual(plan.brought, { here: 0, there: 4, both: 0 });
  assert.equal(plan.merged.grants.length, 1);
  assert.equal(plan.merged.takings.length, 1);
  assert.equal(plan.merged.testers.length, 1);
  assert.equal(plan.merged.contacts.length, 1);
});

test('a record both sides agree on is kept once, not twice', () => {
  const plan = planSync(
    books({ grants: [GILBERT, TRADE_NIGHT] }),
    remote(books({ grants: [GILBERT] })),
    AT,
    'the office Mac'
  );
  assert.ok(plan.what === 'write');
  assert.equal(plan.merged.grants.length, 2);
  assert.deepEqual(plan.brought, { here: 1, there: 0, both: 1 });
});

test('two reports covering the same month are two lines, not one overwriting the other', () => {
  // owner.ts keeps `from` on every takings line so a figure can be pointed at
  // the report that made it. Keying on the month alone would silently throw one
  // of these away and leave Sam a July that disagrees with his statement.
  const plan = planSync(
    books({ takings: [JULY] }),
    remote(books({ takings: [JULY_AGAIN] })),
    AT,
    'the office Mac'
  );
  assert.ok(plan.what === 'write');
  assert.equal(plan.merged.takings.length, 2);
  assert.deepEqual(
    plan.merged.takings.map((one) => one.from),
    ['Financial Report, US, July 2026', 'Sales and Trends, July 2026']
  );
});

test('two stages for one tester are two records, because the gap between them is the point', () => {
  const plan = planSync(
    books({ testers: [ASKED] }),
    remote(books({ testers: [INSTALLED] })),
    AT,
    'the office Mac'
  );
  assert.ok(plan.what === 'write');
  assert.deepEqual(
    plan.merged.testers.map((one) => one.stage),
    ['asked', 'installed']
  );
});

test('the merged file is sorted, so the same books make the same commit', () => {
  const one = planSync(
    books({ grants: [TRADE_NIGHT, GILBERT] }),
    remote(books({ grants: [PULLED] })),
    AT,
    'the office Mac'
  );
  const two = planSync(
    books({ grants: [PULLED] }),
    remote(books({ grants: [GILBERT, TRADE_NIGHT] })),
    AT,
    'the office Mac'
  );
  assert.ok(one.what === 'write' && two.what === 'write');
  assert.equal(one.file, two.file);
});

test('when the two sides already agree, nothing is written', () => {
  const same = books({ grants: [GILBERT], takings: [JULY], troubles: [CRASH] });
  const plan = planSync(same, remote(same), AT, 'the office Mac');
  assert.equal(plan.what, 'nothing to do');
  assert.ok(plan.what === 'nothing to do');
  assert.deepEqual(plan.books, same);
});

/* ------------------------------------------------------------- conflicts */

test("Sam's note and Apple's fact are never merged into one row", () => {
  // The office Mac has Sam's note that he gave the code to Gilbert. The iPhone
  // has Apple's report that the code was redeemed. A field-by-field merge would
  // produce a row saying Apple confirmed Gilbert redeemed it, which Apple never
  // said and never will. This is the test that this cannot happen.
  const plan = planSync(
    books({ grants: [{ ...GILBERT, given: 'Gilbert' }] }),
    remote(books({ grants: [{ ...REDEEMED, given: undefined }] })),
    AT,
    'the office Mac'
  );
  assert.equal(plan.what, 'conflict');
  assert.ok(plan.what === 'conflict');
  assert.equal(plan.conflicts.length, 1);
  const only = plan.conflicts[0];
  assert.ok(only);
  assert.equal(only.kind, 'grant');
  assert.equal(only.key, 'TRUELINE-GILBERT-3M');
  assert.match(only.here, /"given": "Gilbert"/);
  assert.doesNotMatch(only.here, /redeemedAt/);
  assert.match(only.there, /"redeemedAt"/);
  assert.doesNotMatch(only.there, /"given"/);
});

test('a conflict writes nothing at all, not even the records both sides agreed on', () => {
  const plan = planSync(
    books({ grants: [GILBERT, TRADE_NIGHT], takings: [JULY] }),
    remote(books({ grants: [REDEEMED, TRADE_NIGHT] })),
    AT,
    'the office Mac'
  );
  assert.equal(plan.what, 'conflict');
  assert.ok(plan.what === 'conflict');
  assert.equal(plan.conflicts.length, 1);
  assert.ok(!('file' in plan));
  assert.match(plan.says, /Nothing has been written, on either side/);
});

test('a conflict names both sides and suggests no winner', () => {
  const plan = planSync(
    books({ grants: [GILBERT] }),
    remote(books({ grants: [{ ...GILBERT, months: 6 }] })),
    AT,
    'the office Mac'
  );
  assert.ok(plan.what === 'conflict');
  const only = plan.conflicts[0];
  assert.ok(only);
  assert.match(only.says, /says one thing on this device and another in the repository/);
  assert.match(only.says, /Decide which is right/);
  assert.match(only.here, /"months": 3/);
  assert.match(only.there, /"months": 6/);
});

test('a trouble count that differs is a conflict, never a sum', () => {
  // Adding them would invent crashes nobody reported: both devices may have
  // been shown the same four.
  const plan = planSync(
    books({ troubles: [CRASH] }),
    remote(books({ troubles: [{ ...CRASH, times: 6 }] })),
    AT,
    'the office Mac'
  );
  assert.ok(plan.what === 'conflict');
  assert.equal(plan.conflicts[0]?.kind, 'trouble');
  assert.match(plan.conflicts[0]?.key ?? '', /The scan has no walls in import-roomplan.ts/);
});

test('a withdrawn grant that only one side knows about is never erased by the other', () => {
  const plan = planSync(
    books({ grants: [PULLED] }),
    remote(books({ grants: [{ ...PULLED, pulled: undefined }] })),
    AT,
    'the office Mac'
  );
  assert.ok(plan.what === 'conflict');
  assert.match(plan.conflicts[0]?.here ?? '', /printed on the wrong card/);
});

test('conflicts across different kinds are all reported together, in one pass', () => {
  const plan = planSync(
    books({ grants: [GILBERT], takings: [JULY], contacts: [NOTE] }),
    remote(
      books({
        grants: [REDEEMED],
        takings: [{ ...JULY, refunded: 1_998n }],
        contacts: [{ ...NOTE, about: 'Something else entirely.' }],
      })
    ),
    AT,
    'the office Mac'
  );
  assert.ok(plan.what === 'conflict');
  assert.deepEqual(
    plan.conflicts.map((one) => one.kind),
    ['grant', 'takings line', 'contact']
  );
  assert.match(plan.says, /3 records say one thing/);
});

/* ------------------------------------------------ what a status code means */

test('only 200 is a read, and every other answer has its own name', () => {
  assert.equal(readOutcome(200), 'here');
  assert.equal(readOutcome(404), 'not there');
  assert.equal(readOutcome(401), 'the token was refused');
  assert.equal(readOutcome(403), 'the token is not allowed to');
  assert.equal(readOutcome(500), 'github is having trouble');
  assert.equal(readOutcome(503), 'github is having trouble');
  assert.equal(readOutcome(418), 'unexpected');
  assert.equal(readOutcome(204), 'unexpected');
});

test('only 200 and 201 are a write, and 409 is the conflict this design runs on', () => {
  assert.equal(writeOutcome(200), 'written');
  assert.equal(writeOutcome(201), 'written');
  assert.equal(writeOutcome(409), 'somebody else wrote first');
  // Widened on purpose: a stale or missing sha may come back as a validation
  // failure, and both mean "read it again", never "done".
  assert.equal(writeOutcome(422), 'somebody else wrote first');
  assert.equal(writeOutcome(401), 'the token was refused');
  assert.equal(writeOutcome(403), 'the token is not allowed to');
  assert.equal(writeOutcome(502), 'github is having trouble');
  assert.equal(writeOutcome(418), 'unexpected');
});

test('no status this app has not thought about is ever read as success', () => {
  for (let status = 100; status < 600; status += 1) {
    const answer = writeOutcome(status);
    if (status === 200 || status === 201) {
      assert.equal(answer, 'written');
    } else {
      assert.notEqual(answer, 'written');
    }
  }
});
