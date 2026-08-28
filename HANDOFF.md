# HANDOFF — Trueline

> This file did not exist in this repository before 2026-08-28. `DECISIONS.md`
> is still the long record of every decision taken on Trueline and stays that
> way; this file exists because `CLAUDE.md` requires that **a change to anything
> in the locked set is recorded in `HANDOFF.md`, with the reason**, and one has
> now been made. It records that change. It is not a summary of the whole
> project and should not be read as one.

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

### What was measured

1123 core tests pass, including 21 new ones — 11 in `core/src/test/baseline.test.ts`,
8 in `core/src/test/invoice.test.ts`, 2 added to `core/src/test/countersign.test.ts`.
`npm run typecheck` clean. Every one of those 21 was watched failing on a
deliberately introduced mistake before it was trusted.

`web/audit/a35-returned.mjs` — 36 checks driving the real app in Chromium on
`web/audit/dining.json`, with the agreed total, the invoice and the export figure
all worked out on the audit's own side from the quantities the app printed on
its own takeoff and the mark-up it named. 36 of 36 pass.

### What is not done

The core is built, tested and green. **The app half is not applied**, because
the session that did this work did not own `web/src/Agree.tsx`,
`web/src/proposalFile.ts` or `web/src/state.ts`. The five exact edits are
written out, old and new, in the session's integration note, and until they land
`python3 core/tools/check-reachable.py` reports:

```
core/src/baseline.ts: freezeOnReturnedCopy — tested, and nothing else calls it
```

That is the check doing exactly its job: a feature nothing reaches is not built.

They were applied to a throwaway copy of the repository, built, served and
driven, and `web/audit/a35-returned.mjs` passed **36 of 36** checks through the
real app in Chromium on `dining.json` — so what is outstanding is the wiring,
not the design.
