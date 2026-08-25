# Turning on the iCloud backup — the parts Xcode cannot do for you

The code is written and committed. Three things have to be done once, by a
human, in Apple's web consoles. Until step 3 is done, **backing up works and
restoring finds nothing**, and that failure is silent — it looks exactly like
the backup not working at all.

## What it does, so it is clear what is being switched on

Every time you type a measurement, the corrected room is written into that
scan's own folder on the phone **and** copied into **your own iCloud** — the
private database, which Apple describes as storing *"private data securely in
your users' iCloud accounts"*. There is no Trueline server. Nobody is billed
for it. It is your iCloud, not ours, and the app says so on the list.

**Measured sizes, from your own scans:**

| | |
|---|---|
| A corrected garage, everything the app keeps | **6,194 bytes** |
| A corrected kitchen | 8,391 bytes |
| The photographs from one 55-shot garage scan | **26 MB** |
| Free iCloud on any Apple Account | 5 GB |

At 6 kB a room, 5 GB is hundreds of thousands of rooms. At 26 MB a scan it is
under two hundred — before any of the owner's own photos. That is the whole
reason the drawings go up and the photographs stay on the phone.

## 1. Xcode — the capability

Open `ios/Trueline.xcodeproj`, click the blue **Trueline** at the top of the
sidebar, then the **Trueline** target → **Signing & Capabilities**.

The entitlements file is already committed and already wired into the project,
so the iCloud capability should already be listed with **CloudKit** ticked and
the container `iCloud.com.sunnyacres.trueline`.

If it is not there: **+ Capability** → **iCloud** → tick **CloudKit** → **+**
under Containers → type `iCloud.com.sunnyacres.trueline`.

If Xcode says the container does not exist, click the refresh arrow beside the
container list — it creates it against your developer account.

## 2. CloudKit console — the one index

Go to **icloud.developer.apple.com** → sign in → pick the
**iCloud.com.sunnyacres.trueline** container.

CloudKit invents its own schema the first time the app saves a record, so
**run the app once and correct one measurement first**. That creates the `Scan`
record type. Then:

**Schema → Indexes → `Scan` → Add Index → `recordName` → Queryable → Save.**

Why this matters: CloudKit will happily store records it will not let you
search for. Without that index the app backs everything up correctly and a
second device asking "what is in here?" gets nothing back — and the app cannot
tell that apart from an empty account. The app names this exact step if
CloudKit refuses the query, but it is faster to do it now.

## 3. Before the App Store — deploy the schema

A container has **two** schemas, development and production, and they are
separate. Your Xcode builds talk to development. Anything from TestFlight or
the App Store talks to production.

**Schema → Deploy Schema Changes → Deploy.**

Skip this and the app works perfectly for you and does nothing at all for
Gilbert. Do it again any time the record shape changes.

## What to check on the phone

1. Open the app. At the bottom of the scan list there is a line about the copy.
   With iCloud signed in it says how many scans are copied; with no iCloud
   account it says so plainly rather than showing a tick it has not earned.
2. Correct a measurement. The line should say **Copying…** and then settle.
3. **The real test:** delete the app, reinstall it from Xcode, and open it. The
   scans should come back — with the tape readings in them, not the raw scan.
   That is the failure this exists for.

## What is deliberately not backed up

- **Photographs.** See the table above.
- **Anything at all when there is no iCloud account.** The app says so; it does
  not pretend.
