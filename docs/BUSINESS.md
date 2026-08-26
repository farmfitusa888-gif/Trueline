# The business case

Why $78, what has to be true for it to work, and where it fails.

Written 2026-08-26. The readable version with live dials is `docs/business.html`
— open it in a browser and move the sliders. This file is the record: it diffs,
it greps, and it is what to change when a number changes.

**What is sourced and what is not.** Every competitor price, feature and user
complaint comes from `MARKET-RESEARCH.md` (researched 2026-08-19), which labels
its own provenance: **[vendor]** read off the company's own page, **[review]**
reported by a third-party review site and not independently confirmed. Every
product fact is read out of this repository. Everything commercial — conversion,
churn, what a customer costs to get — is an **assumption, marked as one**,
because nobody has sold this to anybody yet.

---

## 1. What is actually built

Not a roadmap. This is what compiles, passes 761 tests and 17 audit parts, and
ran on a phone in August 2026.

| | State |
|---|---|
| **The measurement engine** — exact integer arithmetic end to end, lengths in nanometres, areas in doubled square-nanometres, money in cents. No float ever touches a measurement. Every dimension carries whether it was `scanned`, `measured`, `derived` or `adjusted`, and the app refuses to call a room measured until a tape has been on one wall running each way. | Built |
| **The business half** — takeoff, price book, proposal with e-signature and audit trail, signed baseline, change orders, scheduling into the phone's calendar, invoicing, QuickBooks export. | Built |
| **Insurance restoration** — damage pins dropped live during a scan, photographs with the camera pose attached, the claim document as a real PDF, and ESX export for Xactimate. | Built |
| **Crash and error reporting** | MetricKit for native crashes and hangs, `window.onerror` for everything the web screens throw, both written to the phone and sent only when somebody taps Send them. No server, no third-party SDK, nothing collected about the job. | Built |
| **Never been sold** | Zero customers. Zero App Store listing. Zero analytics, on purpose — see §6. |

## 2. Where it sits

All figures from `MARKET-RESEARCH.md`.

| Product | What it is | Price | Aimed at |
|---|---|---|---|
| magicplan | LiDAR + sketch, floor plans, estimates, **ESX to Xactimate** | ~$33.33/mo [review] | Restoration & insurance |
| Polycam | LiDAR + photogrammetry, 3D mesh | ~$150/yr Basic, $36/mo Business [review] | General 3D capture |
| CubiCasa | Walk-through to floor plan | $22.99–$29.99/scan, up to $460–600/scan [review] | Real-estate volume |
| Matterport | Hosted 3D tour, AI floor plan | $65–$309/mo + $350–1,000/home [review] | Marketing tours |
| Hover | Photos to exterior model + takeoff | $99/mo + $29–139/project [review] | Roofing, siding |
| **Trueline** | Measured interior + takeoff + proposal + claim, one seat | $78/mo · $780/yr (not yet configured) | Restoration, then remodelers |

**The one thing the research proves is unoccupied:** nobody sells *interiors +
accuracy + estimating in one product*. Hover owns exteriors. magicplan owns
insurance restoration. Polycam owns raw 3D. CubiCasa owns real-estate volume.
The remodeler doing interior as-builts to price a job is served by pieces of all
of them and the whole of none.

And Matterport — the most famous name in the category — says in writing that its
floor plans are *"not CAD-accurate drawings and should not be used for
construction or renovation planning."* The category leader disclaims the use
case.

## 3. The price, and the argument against it

**The hard version.** magicplan is ~$33.33/mo flat and already does LiDAR
scanning, floor plans, estimates and ESX export to Xactimate, with years of
restoration contractors using it. Trueline is asking **2.4× that** with zero
customers and no name. If the pitch is "a better scanner", the argument is lost
on the first call — nobody pays 2.4× for a better version of the thing they
already have.

**The argument that works.** It is not a scanner. It is a scanner *plus the
job-management half*, and that half is normally a second subscription: Jobber —
scheduling, quoting, invoicing — is a separate product bought alongside
magicplan. So the honest comparison is not $78 against $33; it is $78 against
**magicplan plus a job-management tool**, bought separately, that do not share a
number between them — where every quantity gets retyped from one into the other,
by hand, at eleven at night.

**That retyping is the product.** The takeoff, the proposal, the change order
and the invoice all come off the same measured walls, and when a tape moves a
wall, every one of them moves with it. Two products next to each other cannot
do that at any price.

### How to sell it

- **Lead with the change order.** A wall moved, the proposal was signed, and the
  app produced a priced change order off the difference. Unbilled change orders
  are where a restoration contractor's money goes.
- **Lead with the refusal.** Show it saying *these are the scanner's numbers, not
  measurements*. Every competitor hands over a number with no provenance. This
  is the only one that admits what it does not know, and an adjuster is the exact
  person who cares.
- **Never lead with accuracy.** There is no measured accuracy figure. The
  research says so in writing: no accuracy claim in it was produced on a device
  we own. Claiming one is the fastest way to be caught.

## 4. The gate

Read out of `core/src/entitlement.ts`, which generates the Swift gate, so both
halves of the app agree on it.

- **Free, forever** — scan, measure, plan, 3D, edit, dimensions, and 2 rooms kept
  at once. The entire measurement product. Somebody who only wants a floor plan
  never has to pay, and never will.
- **Paid** — takeoff, pricing, proposal, signature, change orders, insurance,
  exports, price list, unlimited rooms. Everything that turns a drawing into
  money.

**The risk in that line, said plainly.** The free tier is the whole reason a
remodeler tells another remodeler about it — which is the distribution this
depends on. It is also the reason most of them never pay: a one-man shop who
wants a floor plan for a bathroom has everything he needs, free, forever. That
is a deliberate trade and it is the right one, but it means the conversion rate
is not a funnel number that can be optimised — it is the fraction of users who
actually write proposals and file claims.

## 5. The money

Two facts: **Apple takes 15%** under the Small Business Program (under $1M a
year), and **marginal cost per customer is zero** — there is no server, storage
is the customer's own iCloud, and the AI provider is off by default. Everything
else is a dial; `docs/business.html` moves them.

At $78/mo, 5% monthly churn, 100 paying customers, $6,000/mo needed:

| | |
|---|---|
| Net a month, after Apple's 15% | $6,630 |
| New customers a month, just to stand still | 5 |
| A customer is worth, over their whole life | $1,326 |
| Break even at | 91 customers |

Arithmetic on those inputs, not a forecast. **Churn is the one number that
decides whether this is a business, and it cannot be known until people have
been paying for six months.** Everything downstream of it is a guess wearing a
decimal point. At 10% monthly churn the average customer lasts ten months and
the base is replaced every year; that is a treadmill, not a business, and no
amount of product fixes it.

## 6. Where it fails

Ranked by likelihood, not by severity.

1. **The free tier is the product.** *(Most likely.)* Remodelers love it, tell
   each other about it, and never pay — a floor plan is all they wanted. A
   thousand users, a great App Store rating, and $400 a month.
   *The tell:* installs climbing while paid conversions stay flat for two months.
2. **Restoration will not switch.** *(Plausible.)* They already have magicplan,
   it already does ESX, and their Xactimate workflow works. Switching costs a
   busy contractor a week he does not have, to save nothing he can name.
   *The tell:* demos go well and nobody buys. "Send me something" twice.
3. **Churn eats it.** *(Plausible.)* At 10% a month a customer lasts ten months.
   Every month is spent replacing the people who left, and the count never moves
   however good the product is.
   *The tell:* gross adds healthy, net adds near zero by month four.
4. **You are half blind.** *(Was certain. Now half of it is fixed.)* As of
   2026-08-26 the app subscribes to Apple's MetricKit for crashes and hangs, and
   catches everything the web screens throw — both written to a folder on the
   phone with one tap to send them (`ios/Trueline/Diagnostics.swift`,
   `web/src/Trouble.tsx`). So when it **breaks** you will hear about it.
   When somebody **stops using it** you still will not: there is no analytics and
   deliberately never will be, because that is what "nothing leaves the device"
   costs. The only churn signal is somebody cancelling, and it arrives late.
   *The tell:* you cannot have one. §9 test 4 is the substitute.

**The honest summary.** The product is unusually good and unusually far along
for a business with zero customers. That is the trap. Every remaining risk is
commercial, and none of it is fixed by more building — which is the thing that
will feel productive. The cheapest way to find out whether this is a business is
to try to charge one restoration contractor $78 before writing another feature.

## 7. Launch, in order

Each gate blocks the next. Several are waiting rather than work.

1. **Walk a real kitchen.** `docs/on-the-phone.md` has 22 tests and not one has
   run on a phone. `docs/first-six-tests.md` is the short version. If the scan is
   wrong in a real room, nothing below matters.
2. **Two web pages on trueline.tools.** Apple's listing requires a support URL
   and a privacy policy URL, both live before submission. Changing them later
   means a new review.
3. **Set the products in App Store Connect.** The prices are **not in the code** —
   StoreKit reads them from App Store Connect, which is correct.
   `com.sunnyacres.trueline.pro.monthly` and `.pro.yearly` have to be created,
   priced at $78 and $780, and submitted.
4. **TestFlight.** Internal first, then Gilbert externally. External TestFlight
   needs its own review — usually a day, not instant.
5. **The privacy nutrition label.** No data collected, nothing leaves the device.
   Say it exactly, because it is unusual and it is true.
6. **Screenshots that show the refusal.** Six screens. Make one of them the app
   saying *these are the scanner's numbers, not measurements*.
7. **Submit, and expect one rejection.** Subscription apps are commonly rejected
   first time over paywall clarity — price, period, and what auto-renews must be
   visible on the paywall itself. Trueline's already says the founding terms out
   loud, which helps.

## 8. What breaks as it grows

| At | What breaks | What it costs to fix |
|---|---|---|
| 1 | **You cannot see anything.** ~~No analytics, no crash reporting. A scan that fails on a customer's phone is invisible.~~ | **Done, 2026-08-26.** MetricKit for native crashes and hangs, `window.onerror` for the web half that MetricKit cannot see, both written to `Documents/Reports` and sent only on a tap. `ios/Trueline/Diagnostics.swift`, `web/src/Trouble.tsx`. |
| 10 | **Support is your inbox.** | Nothing. Do it by hand on purpose — the first fifty conversations are the product research. |
| 50 | **No way to help somebody whose data is wrong.** Everything is on their phone in their iCloud. You cannot look, cannot repair, cannot restore. | A one-tap "send me this scan" that shares the folder. The share sheet is already built; this is a button and a mail template. |
| 500 | **One person cannot answer the email.** Every hour on support is an hour not building. | The handbook is already written and ships inside the app. Point at it, and add the three questions everyone asks to a real FAQ. |
| 5,000 | **Android.** The research is explicit: ARCore has no RoomPlan equivalent and there is an open feature request with no ship date. | Wall-plane fitting, corner solving and opening detection from scratch. Its own project, months not weeks. The data format is already designed for it to arrive later. |

## 9. What has to be true

Each is falsifiable and cheap to test, in this order, because each makes the next
worth doing.

1. **The scan is right in a real room.** Any room with four walls. Tape it
   yourself and compare. One afternoon. If this fails nothing else here is worth
   reading.
2. **A restoration contractor will sit through the change-order demo.** Not buy —
   watch. If five minutes of attention cannot be held on the strongest thing the
   product does, the positioning is wrong, not the price.
3. **One of them will pay $78 before the App Store listing exists.** Invoice them
   directly. If somebody will pay for a TestFlight build with no store page and
   no reviews, there is a business. If nobody will, the store page will not
   change that.
4. **They are still paying in month three.** The only churn number that will ever
   exist that is not a guess. Everything in §5 hangs on it.

## 10. The next thirty days

| Days | What |
|---|---|
| 1–2 | Build to the phone, walk a real room, run the six tests in `docs/first-six-tests.md`. Fix whatever the real room breaks. |
| 3–5 | Support and privacy pages on trueline.tools. They gate the submission and they take an afternoon. |
| 6–10 | App Store Connect: products at $78 and $780, screenshots, privacy label, TestFlight to Gilbert. |
| 10–20 | Five restoration contractors. Not a launch — five conversations, in person, with the change-order demo. Ask each of them to pay. Write down the exact words they use when they say no. |
| 20–30 | Act on what they said. If three of five said the same thing, that is the roadmap, and it beats everything guessed in this document. |

---

Competitor figures: `MARKET-RESEARCH.md`, researched 2026-08-19.
Product facts: read from the code, 26 August 2026.
Everything commercial: assumption, marked.
