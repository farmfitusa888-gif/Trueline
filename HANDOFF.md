# HANDOFF — Trueline

Cold start. Read this, then `README.md` for what the product is, then
`DECISIONS.md` for why anything is the way it is. `DECISIONS.md` remains the
long record of every decision; this file is where the project stands today and
where a change to anything in the locked set is written down with its reason,
as `CLAUDE.md` requires.

Last brought current: **2026-08-28.**

---

## Where it stands

Measured on 2026-08-28, at the last commit, by running the commands named:

| | |
|---|---|
| `npm test` | **1,132 passing, 0 failing** |
| `npm run typecheck` | clean, both workspaces |
| `npm run check-guide` | **159 quoted labels, every one of them in the app's source**, across 73 handbook cards |
| `npm run what-is-left` | clean — every exported function is called by something that is not a test, or excused in writing |
| `npm run what-is-untouched` | **79 control names nothing drives, in 28 files.** Red, and outside `verify` on purpose |

`npm run audit` drives the built app in a real browser across 38 parts. It was
not run here, so no pass count is claimed for it.

## What is done

A job now runs end to end **in the web half**: scan or walk or draw a room,
correct it, take it off, price it against the contractor's own rate book, write
a proposal, get it agreed, freeze that scope, raise change orders against the
frozen version, put days in the phone's calendar, invoice from what was signed,
and write down the money that came in. Insurance is a second mode beside all of
it, with its own restoration rate book and its own document for an adjuster.

Landed in the last day, and now documented in `docs/handbook.html`:

- **The claim document carries money** — the restoration scope only, priced at
  the contractor's own restoration rates, per mark and per sheet. This reverses
  a documented decision; both halves are in `DECISIONS.md` under *Reversed: the
  claim document carries money*.
- **A returned signed copy can freeze a job**, with the weakness printed on the
  agreement, on the proposal, on every invoice and in the QuickBooks export.
  That is a change to the locked set and it is recorded below.
- **The FTC three-day cancellation notice** — 16 CFR Part 429 — with the
  business address it needs moved onto the profile, and the deadline computed in
  the rule's own business days rather than typed.
- **A record of what left this phone**, which never says "sent", because the app
  is blind after the share sheet takes the file.
- **The walk's own photographs can be deleted in a batch**, with what each frame
  is doing named before it goes.
- **Vendor and store prices** — what a named shop charged, on a stated day, typed
  by somebody who saw it, kept in a different book from what the contractor
  charges.
- **The free tier is one room**, and the limit only ever stops a *new* room being
  written down.
- **Every drawing resolves to the paper palette before it leaves the app.** Four
  export paths were black rectangles.

## What is genuinely next

In this order, and the first two are not build work:

1. **Compile the scanner.** It has never once reached the end of a build. Sixteen
   Python checkers stand in for a compiler and none of them is one. This is still
   the largest unverified surface in the repository, and it needs a Mac.
2. **Run `docs/on-the-phone.md`.** Twenty-two tests, none of them ever run on an
   iPhone. Gilbert's actual kitchen is the first one that matters.
3. **Close `npm run what-is-untouched`.** 79 controls no part of the audit has
   ever named. Every one of the four controls this project shipped broken and
   unreachable was in exactly that state first. Settings and Claim are whole
   forms nothing fills in; FieldSheet has no audit part at all.
4. **Then `docs/v3.md`:** scan → priced scope, the hosted client link, re-scan
   and diff.

Not built, and said plainly in `README.md`: the API, accounts, the hosted client
link (all need a server), the subscription actually being purchasable (needs an
Apple Developer agreement and App Store Connect), and any AI at all
(`docs/AI.md` is research and nothing calls a model).

---

## 2026-08-28 — a job can now be agreed on a signed copy that came back

### What was locked

`core/src/baseline.ts` is in the locked set. Two rules in it, both deliberate
and both long-standing:

1. **`freeze()` refuses anything without a client `Signature`.** A baseline
   nobody signed is a draft, and calling it a baseline is how a contractor ends
   up believing he has an agreement he cannot show anybody.
2. **A `ReturnedDocument` cannot impersonate a `Signature`.**
   `core/src/countersign.ts` is built so a photograph of a signed page has no
   field a signature has — no `who`, no `at`, no `intent`, no `consented`, no
   `documentHash` — and `core/src/test/countersign.test.ts` asserts it, by name,
   field by field. The reason is written into that file: *a record that quietly
   reads like a stronger one is worse than no record, since the contractor would
   rely on it in the one conversation where it matters.*

### The problem those two rules produced

Most remodelling jobs are not signed on a phone. The contractor sends the
proposal, the client prints it, signs it at the kitchen table on Sunday night,
photographs it and texts it back. A27 built the app half of that: the copy files
against the job, bound to the fingerprint of the version that went out and to a
fingerprint of the picture itself.

And then nothing. `freeze()` wanted a `Signature`, a photograph is not one, and
the Work screen said **"Nothing to invoice yet"** to a contractor holding a
signed agreement. Confirmed by driving the real app on `web/audit/dining.json`
before any of this was written.

That is not a small gap. A contractor who cannot invoice inside the app invoices
outside it — and from that moment the app knows less about his job than his
email does: no agreed figure, no change order measured against anything, no
record of what was paid, and the signed sheet back in a text thread attached to
nothing.

### Who decided, and in what words

**Sam.** Asked what should happen when a client signs the paper proposal and
sends back a photograph of it, he chose:

> **"Let it freeze the job, with the weakness written on the agreement"**

The option he took read: *the returned photograph freezes the baseline, and the
baseline itself records that it was agreed by a returned copy rather than signed
on the phone — so every invoice and every export carries that fact. You can
invoice; nobody is ever misled about the strength of the evidence.*

### What changed

| | |
|---|---|
| **`freeze()`** | Untouched. Still refuses anything without a client `Signature`, still cannot be handed a `ReturnedDocument`, and produces a baseline that is **byte for byte** the record it has always produced — same keys, same canonical text, same fingerprint. Asserted in `core/src/test/baseline.test.ts`. |
| **`ReturnedDocument`** | Untouched. Still has no field a `Signature` has, still cannot be made into one, and the test that says so by name is still there and still passes. |
| **New: `Baseline.agreedBy`** | An optional `AgreedByReturnedCopy`. **Absent** — not `null`, not a `'signed here'` variant — on every baseline `freeze()` produces, which is what keeps the on-phone record identical and lets every job file already saved on a phone read back exactly as it was written. Present only on a baseline agreed the other way, and self-describing: `how: 'returned copy'`, who says they signed and when, how the copy arrived, both fingerprints, and the two sentences the fact is said in. |
| **New: `freezeOnReturnedCopy()`** | The second door, explicitly named. Nothing reaches it by leaving a field blank or passing an empty list — somebody has to type the name of it. It refuses a copy filed against a change order or a different proposal, refuses a time it cannot keep, and **refuses if the proposal no longer hashes to the version that went out**, which is the refusal the whole path exists for. The baseline it returns carries `signatures: []` — no synthesised signature, ever. |
| **`changesSinceVerified()`** | Now checks the seal on a returned-copy baseline too, through the fingerprint of the document as sent. It used to return early whenever there was no client signature, so a proposal edited under a returned copy would have raised no alarm at all and `invoiceOf` would have gone on billing against it. |
| **`invoice.ts`** | `Invoice` gains the same optional `agreedBy`; the line that carries the agreed figure says how it was agreed; `describeInvoice` carries one sentence of it. Both absent on an on-phone job, so existing invoices and the QuickBooks export are unchanged. |
| **`countersign.ts`** | Two additions, no removals: `AGREED_BY_SAYS` (the same three ways a copy arrives, phrased to follow the words "agreed by", because "agreed by on paper, by hand" is not English and would be printed on a bill), and `notTheSignedVersion()`, so the sentence a drifted document gets is written once and used by both modules. |

### The reasoning, in one paragraph

The weakness was always real and the app was always honest about it — on the
screen, on the record and on the document. What it did with that honesty was
refuse to act, and refusing to act did not make the evidence any stronger. It
made the evidence *leave*, because the contractor went and invoiced somewhere
else. Writing the weakness onto the agreement keeps him inside the app, keeps
the signed copy attached to the job, keeps the agreed figure measurable, and
puts the same sentence in front of the homeowner, the bookkeeper, the adjuster
and the court that the app has in front of itself. A contractor holding a signed
photograph who cannot invoice in the app will invoice outside it, and then the
app knows less about his job than his email does.

### The exact wording that now leaves the app

On the agreement, on the proposal document, and beside the invoice on screen:

> This was agreed by a photograph of the signed page, not by a signature taken
> on the phone. M. Alvarez says they signed it on 2026-08-28, and it came back
> on 2026-08-28. Nobody watched them sign, this app has not checked anybody’s
> identity, and the date they signed is their word for it. What it does bind:
> the proposal that went out and the copy that came back are both fingerprinted,
> so neither can be swapped for another.

Under the money on every invoice, and in every list of invoices:

> Agreed by a photograph of the signed page from M. Alvarez, not by a signature
> taken on the phone.

On the invoice line that carries the agreed figure — which is the column that
goes into the QuickBooks export a bookkeeper opens:

> Agreed 2026-08-26 by a photograph of the signed page from M. Alvarez. Not
> signed on the phone: nobody watched them sign and no identity was checked.

The proposal document's heading over that block changes from **Signed** to
**Agreed on a signed copy that came back**.

"a photograph of the signed page" becomes "a signed PDF that came back" or "a
signed sheet handed over on paper" according to how the copy actually arrived.

### What was measured, at the time this was written

1123 core tests pass, including 21 new ones — 11 in `core/src/test/baseline.test.ts`,
8 in `core/src/test/invoice.test.ts`, 2 added to `core/src/test/countersign.test.ts`.
`npm run typecheck` clean. Every one of those 21 was watched failing on a
deliberately introduced mistake before it was trusted.

`web/audit/a35-returned.mjs` — 36 checks driving the real app in Chromium on
`web/audit/dining.json`, with the agreed total, the invoice and the export figure
all worked out on the audit's own side from the quantities the app printed on
its own takeoff and the mark-up it named. 36 of 36 pass.

(The figure above is what this piece of work measured on the day, and is left
as it was written. The suite as a whole stands at 1,132 at the last commit.)

### The app half, which was outstanding when this was written

It landed the same day. `web/src/Agree.tsx` grew the **A signed copy came back**
section — the file, *Who signed it*, *The day they say they signed it*, *How it
got back to you*, and the button **Agree the job on this signed copy**;
`web/src/proposalFile.ts` swapped the heading over that block from **Signed** to
**Agreed on a signed copy that came back** and prints the weakness under it; and
`web/src/state.ts` keeps the filed copies on the job.

`npm run what-is-left` is clean again — `freezeOnReturnedCopy` is no longer
proven and unreachable, which is the one thing that could be said against it
while the wiring was outstanding.

### What this cost

Recorded because a change to the locked set that lists only what was gained is
not a record. The signing rules rested on one sentence — *a baseline is a
document somebody signed on this phone* — and that sentence is now false.
Anything holding a `Baseline` has to read `agreedBy` as well; `signatures` can
be empty on a frozen job, so every screen and document that iterates it had to
be looked at; and there are now two doors into freezing rather than one. Nothing
was synthesised to preserve the old shape — a fake signature kept to hold an
invariant would be the exact lie `countersign.ts` exists to prevent. The full
table is in `DECISIONS.md`.

## 2026-08-28 — a change order is measured against what was last agreed, and carries the mark-up

Three money decisions from Sam, implemented together. The full record, with the
measured figures, is in `DECISIONS.md` → *What a change order is measured
against, and what it carries*.

1. **`notYetAgreed` compared against what was EVER agreed.** Once an item was on
   a signed change order it could never move again, so the Work screen said
   nothing had moved while the Price screen showed a bigger number and the
   invoice billed the old one. Now `core/src/change.ts` has
   `sinceLastAgreed(baseline, order, agreed)`, everything on the Work screen
   reads it, and the change order that gets raised is built from it.
2. **A change order carried no mark-up**, and added a pre-mark-up figure to a
   post-mark-up agreed total — $75.66 under on one change on a 5% book.
   `ChangeOrder.markup` and `ChangeDocument.markup` now exist, on the document,
   the invoice and the screen.
3. **A one-tap damage-photo delete** now goes through `plannedDeletion`, so it
   gets the same warning as the batch path.

Also fixed on the way: `web/audit/a22-voice.mjs` was asserting the field-sheet
heading `MARKED ON THESE WALLS`, which commit `196fa1a` renamed to `MARKED IN
THIS ROOM — N` when the ceiling became markable. It had been red on that check,
and the two checks under it were reading off `indexOf(...) === -1` — `slice(-1)`
is the last character of the sheet, which contains no quantity and passes for
ever. The heading is named once now, so a third rename fails one check rather
than silently turning two of them off.

### What was measured

- `npm test` — 1290 pass, 0 fail. 13 new tests: 12 in `core/src/test/change.test.ts`,
  1 in `core/src/test/work.test.ts`.
- `npm run typecheck` — clean, both workspaces.
- `a55-jobmoney` 83/83 (was 74), `a54-marks` 69/69 (was 65), `a22-voice` 76/76.
- `check-reachable`, `check-doors`, `check-bridge`, `check-scan`,
  `check-controls`, `check-collapse`, `check-tokens`, `check-art`,
  `check-portable`, `check-guide`, `check-the-checks` — all clean.
