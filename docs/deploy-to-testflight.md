# Getting ScanToBid onto TestFlight

Your Apple Developer membership is paid and active, so everything below is
possible today. Nothing here costs anything further.

---

## The short answer on money, first

**A TestFlight tester can never be charged.** Not by configuration — by Apple.
Every in-app purchase in a TestFlight build runs against the **StoreKit sandbox**;
sandbox transactions involve no payment method and no money, and a sandbox
subscription renews on a compressed clock and cancels itself. There is no
setting that could make a TestFlight build take a real payment.

On top of that, ScanToBid is not even asking:

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

`ios/ScanToBid/ScanToBid.storekit` is a StoreKit configuration file and the scheme
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
| Name | see **The name is taken** below — not bare `ScanToBid` |
| Primary language | English (U.S.) |
| Bundle ID | `com.sunnyacres.trueline` |
| SKU | `trueline-ios` (any unique string; never shown) |
| User access | Full Access |

### The name is taken

App Store Connect refuses bare `ScanToBid`:

> The app name you entered is already being used.

App Store display names are unique across the whole store and first come,
first served. Somebody has it.

**Nothing in the app changes.** That field is the store listing's name and
nothing else:

| | |
|---|---|
| Bundle ID `com.sunnyacres.trueline` | unaffected — it is an identifier, not a name |
| `CFBundleDisplayName` = `ScanToBid` | unaffected — this is the name under the icon on the phone, and Gilbert still sees "ScanToBid" |
| scantobid.app, the site, the logo, the repo | all unaffected |

Only the store listing needs a longer, unique string. It is capped at **30
characters**, and it is the single heaviest factor in App Store search — so the
words after the brand should be the ones a remodeler actually types.

The **subtitle** is a separate 30-character field, also indexed. Between them
there are 60 characters of ranking-weighted text, so do not waste either.

Suggested, all inside 30:

| Name | Subtitle |
|---|---|
| `ScanToBid: Scan & Estimate` | `LiDAR room takeoff and bids` |
| `ScanToBid: Room Takeoff` | `Scan, price and get it signed` |
| `ScanToBid Room Measure` | `LiDAR takeoff, proposal, claim` |

The only reliable availability test is typing it into that same field. If it is
accepted, the name is reserved from that moment — but the reservation lapses if
no build is submitted, so do not create the record months before uploading.

**Worth two minutes first:** search the App Store for "ScanToBid" and see what
already holds it. If it is unrelated — a fishing app, a design tool — a longer
name alongside it is ordinary. If it is another construction or measuring app,
that is a genuine confusion problem for customers as well as a naming one, and
worth knowing before the listing, the icon and the screenshots are all built
around it.

If the bundle ID is not in the dropdown, create it first at
<https://developer.apple.com/account/resources/identifiers> with the same string,
and enable **In-App Purchase** on it.

## 3. Create the two subscriptions

Not needed for TestFlight to work — needed before you can ever charge, and
needed for `Product.products(for:)` to return anything on a real device.

App Store Connect → the app → **Subscriptions** → create a group called
`ScanToBid Pro`, then two subscriptions inside it:

| Product ID | Reference name | Duration | Price |
|---|---|---|---|
| `com.sunnyacres.trueline.pro.monthly` | ScanToBid Pro monthly (Founding rate) | 1 month | $78 |
| `com.sunnyacres.trueline.pro.yearly` | ScanToBid Pro yearly (Founding rate) | 1 year | $780 |

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
  in minutes. **This is the one you want.**
- **External Testing** — up to 10,000 people, needs a light Beta App Review
  (usually a day) and gives you a public link. For later.

### What you need from Gilbert

**One thing: the email address on his Apple ID.** Nothing else. Not his phone,
not his device UDID, not his name as it appears anywhere — TestFlight is not
provisioning-profile territory, and internal testers are invited by Apple ID.

Two things worth telling him before you ask:

- **It must be the Apple ID he actually signs into his iPhone with.** If he
  gives you a work address and his phone is signed in with a personal one, the
  invite lands in a mailbox the phone cannot redeem it from. When in doubt he
  can read it off the phone: **Settings → tap his name at the top**.
- **He will get an Apple invitation to join your team as a user, and he has to
  accept it.** It arrives as "You have been invited to join Sunny Acres on App
  Store Connect". Until he clicks through, he is not a tester.

Then, in App Store Connect:

1. **Users and Access** → **+** → his Apple ID email, first and last name.
2. Role: **Developer** if you want him to see builds and crash logs, or
   **Marketing** if you would rather he saw nothing but the app. Either can
   test. Leave everything else unticked.
3. **Invite.** He accepts the email.
4. The app → **TestFlight** → **Internal Testing** → **+** on the tester list →
   tick him → **Add**.
5. He installs **TestFlight** from the App Store, opens the invite on the phone,
   taps **Install**.

Every build you upload after that reaches him automatically. He does not get
re-invited and you do not repeat any of this.

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
