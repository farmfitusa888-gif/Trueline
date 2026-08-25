# Getting the app onto somebody else's phone

There are three ways and only two of them are worth doing.

---

## The one to use: TestFlight

Gilbert installs Apple's **TestFlight** app from the App Store, taps a link you
send him, and Trueline appears on his phone. No cable, no Xcode, no Mac. When
you push a new build he gets a notification. This is what Apple built for
exactly this.

**Limits, from Apple's own page:**

- Up to **100 internal testers** — people on your developer team, who get builds
  immediately with no review.
- Up to **10,000 external testers** — anybody else, by email or a public link.
  **The first build for external testers goes through Beta App Review**, which
  is lighter than full App Store review but is not instant. Later builds in the
  same group are usually straight through.

Source: [Apple's TestFlight page](https://developer.apple.com/testflight/)

### What you do, once

1. In Xcode: **Product → Archive**. Wait for it. Then **Distribute App → App
   Store Connect → Upload**.
   - This needs a real signing team and the bundle ID
     `com.sunnyacres.trueline`, both of which the project already has.
   - The build number has to go up every time. `CURRENT_PROJECT_VERSION` in the
     project settings; bump it before each archive.
2. Go to **appstoreconnect.apple.com** → **My Apps**. If Trueline is not there
   yet, **+ → New App**, and give it the same bundle ID.
3. **TestFlight** tab. The build appears after processing — a few minutes.
4. Apple asks **"does this app use encryption?"** Answer **no**: Trueline makes
   no network connections of its own. Answering it once sets it for good.
5. **External Testing → + → New Group** → call it something like "Gilbert and
   the crew" → add the build → add Gilbert's email → submit.
6. First build waits on Beta App Review. After that, uploading a build and
   adding it to the group is the whole loop.

### What Gilbert does

1. Install **TestFlight** from the App Store.
2. Open the invitation email, tap **View in TestFlight**.
3. Install. It looks and behaves like any other app.

He will need to **allow the camera** and, for the compass on the plan, **allow
location while using the app**. The app explains both at the moment it asks.

---

## The one for right now: a cable and your Mac

If Gilbert is standing next to you, plug his phone into your Mac, pick it in
Xcode's destination menu, press ⌘R. It works today, with no upload and no
review, and it is the fastest way to get one build onto one phone.

Two things to know:

- A build installed this way **expires**. On a paid developer account it lasts
  a year; on a free one, seven days. Yours is paid.
- His phone has to trust you: **Settings → General → VPN & Device Management →
  your Apple ID → Trust**.

It does not scale past the people who will physically hand you their phone,
which is why TestFlight exists.

---

## The one not to do: sending him the app file

You cannot. iOS will not install an app from a file somebody sent. Anyone
telling you otherwise is describing enterprise distribution, which needs a
different, more expensive Apple programme and is meant for a company's own
employees.

---

## Before you send it to anybody

Two things matter more once somebody else is holding it:

1. **Deploy the CloudKit schema to production.** A TestFlight build talks to the
   container's *production* schema, not the development one your Xcode builds
   use. Skip this and the app backs nothing up for Gilbert while working
   perfectly for you. See `docs/icloud-setup.md`.
2. **Do test 1 in `docs/on-the-phone.md` first** — is the plan the right way
   round in a real room. It is the only bug in this project that no test can
   catch, and it is the one that would waste Gilbert's afternoon.
