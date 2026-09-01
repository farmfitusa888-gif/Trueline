# Getting Trueline onto TestFlight

Your Apple Developer membership is paid and active, so everything below is
possible today. Nothing here costs anything further.

---

## The short answer on money, first

**A TestFlight tester can never be charged.** Not by configuration — by Apple.
Every in-app purchase in a TestFlight build runs against the **StoreKit sandbox**;
sandbox transactions involve no payment method and no money, and a sandbox
subscription renews on a compressed clock and cancels itself. There is no
setting that could make a TestFlight build take a real payment.

On top of that, Trueline is not even asking:

```swift
static let onSale = false            // Subscription.swift
static var freeUntilLaunch: Bool { !onSale }
subscribed = found || freeRunning || Self.testing || Self.freeUntilLaunch
```

While `onSale` is `false`, `subscribed` is true for everybody, every paid
feature is on, and no purchase code runs at all. Gilbert sees the whole app and
is never shown a price.

So the answer to "working properly but not active on TestFlight" is: **both are
already true**, and they are true for two independent reasons.

### Proving the purchase path still works, without charging anyone

`ios/Trueline/Trueline.storekit` is a StoreKit configuration file and the scheme
already points at it. Running the app from Xcode uses it instead of the App
Store: real StoreKit 2 code, real `Product.products(for:)`, real transaction
verification, local fake products, no account, no money.

`core/tools/check-testflight.py` fails the build if the product ids in that file
and the `Plan` enum in `Subscription.swift` ever drift apart, and if the local
product names stop containing "Founding rate" — because `Subscription.founding`
reads the product's display name, so without that word the founding terms on the
paywall cannot be seen until the App Store is involved.

**To exercise it:** flip `onSale` to `true` in a local build only, run from
Xcode, buy both plans against the local configuration, then set it back to
`false` before you archive. `check-paywall.py --release` refuses a release build
that has it wrong.

---

## 1. Check the things App Store Connect refuses builds for

```bash
cd ~/trueline && npm run check-testflight
```

It reads what would otherwise come back as an email hours after the upload:

- `PrivacyInfo.xcprivacy` exists, parses, is in the target, and names **exactly**
  the required-reason APIs the code actually calls — `UserDefaults` (CA92.1) and
  file timestamps (C617.1). Missing or wrong is `ITMS-91053`.
- `ITSAppUsesNonExemptEncryption` is answered in `Info.plist`, so no upload sits
  on **Missing Compliance** waiting for you to click through export questions.
- Every framework used has its usage string, so no screen kills the app.
- Version, build number and bundle id are set.

## 2. Create the app record

App Store Connect → **My Apps** → **+** → **New App**.

| Field | Value |
|---|---|
| Platform | iOS |
| Name | Trueline |
| Primary language | English (U.S.) |
| Bundle ID | `com.sunnyacres.trueline` |
| SKU | `trueline-ios` (any unique string; never shown) |
| User access | Full Access |

If the bundle ID is not in the dropdown, create it first at
<https://developer.apple.com/account/resources/identifiers> with the same string,
and enable **In-App Purchase** on it.

## 3. Create the two subscriptions

Not needed for TestFlight to work — needed before you can ever charge, and
needed for `Product.products(for:)` to return anything on a real device.

App Store Connect → the app → **Subscriptions** → create a group called
`Trueline Pro`, then two subscriptions inside it:

| Product ID | Reference name | Duration | Price |
|---|---|---|---|
| `com.sunnyacres.trueline.pro.monthly` | Trueline Pro monthly (Founding rate) | 1 month | $78 |
| `com.sunnyacres.trueline.pro.yearly` | Trueline Pro yearly (Founding rate) | 1 year | $780 |

The product IDs must match `Subscription.Plan` **exactly** — that is what the
checker guards. Keep "Founding rate" in the display name while the founding
terms are being offered; the app reads that word to decide whether to say so.

## 4. Archive and upload

```bash
cd ~/trueline && trueline check
```

Then in Xcode: **Product → Destination → Any iOS Device (arm64)**, then
**Product → Archive**. When the Organizer opens: **Distribute App** →
**TestFlight & App Store** → **Upload**.

Two things that stop people here:

- **The destination must be a real device or "Any iOS Device"**, never a
  simulator. Archive is greyed out otherwise.
- **The build number must be higher than every build you have uploaded before**,
  even for the same version. Bump `CURRENT_PROJECT_VERSION`.

Processing takes 5 to 30 minutes. You get an email.

## 5. Send it to Gilbert

App Store Connect → the app → **TestFlight**.

- **Internal Testing** — up to 100 people who are in your team. No review, live
  in minutes. Add Gilbert as a user (**Users and Access** → **+** → role
  *Developer* or *Marketing*) and he is testing today. **This is the one you
  want.**
- **External Testing** — up to 10,000 people, needs a light Beta App Review
  (usually a day) and a public link. For later.

Gilbert installs **TestFlight** from the App Store, opens the invite email on
the phone, and taps **Install**.

## 6. What to hand him with it

`docs/give-it-to-gilbert.md` and `docs/first-six-tests.md`. Six tests, any room
with four walls, one afternoon — they are the ones that decide whether the rest
of this is worth doing.

---

## Every time after the first

```bash
cd ~/trueline && trueline check
```

Bump the build number, **Product → Archive**, **Distribute**, and it appears in
TestFlight for everyone already on the list. Builds expire after 90 days.
