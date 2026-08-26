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

## 2. CloudKit console — the two indexes

This is the step the app complains about on the scan list:

> iCloud refused the query. In the CloudKit console, mark recordName Queryable
> on the Scan record type and the scan field Queryable on DamagePhoto, then
> deploy the schema.

It is not a bug and there is nothing to fix in code. CloudKit will store records
it will not let you *search* for, and searching is what a second phone does when
it asks "what is in here?". Here is exactly what to click.

### First: make the record types exist

CloudKit invents its schema the first time the app saves something, so there is
nothing to index until the app has saved. On the phone, with iCloud signed in:

1. Open Trueline, open a room, and **type one tape reading**. That writes a
   `Scan` record.
2. If you use insurance mode, **take one damage photograph** as well. That
   writes a `DamagePhoto` record. If you skip this, `DamagePhoto` will not be in
   the list yet and you can come back for it.

### Then: the console

1. Go to **https://icloud.developer.apple.com/dashboard/** and sign in with the
   Apple ID that owns the developer account.
2. Click **CloudKit Database**.
3. Top left, the container dropdown — choose **iCloud.com.sunnyacres.trueline**.
4. Beside it, the environment dropdown — make sure it says **Development**.
   (Production comes in step 3 below.)
5. In the left sidebar, under **Schema**, click **Indexes**.

**Index one — so a second phone can list your scans:**

6. In the record-type list, click **Scan**.
7. Click **Add Index**.
8. Field: **recordName**. Index type: **QUERYABLE**.
9. Click **Save Changes**.

**Index two — so a room's damage photographs can be found:**

10. In the record-type list, click **DamagePhoto**.
11. Click **Add Index**.
12. Field: **scan**. Index type: **QUERYABLE**.
13. Click **Save Changes**.

That is both. `Company` needs nothing — the app fetches it by a fixed record id
rather than searching for it.

### Why those two exactly

| The app asks | In code | What it needs |
|---|---|---|
| "every scan in this account" | `CKQuery(recordType: "Scan", predicate: NSPredicate(value: true))` | `recordName` QUERYABLE on **Scan** |
| "the damage photographs belonging to this scan" | `CKQuery(recordType: "DamagePhoto", predicate: NSPredicate(format: "scan == %@", name))` | the **`scan`** field QUERYABLE on **DamagePhoto** |

Both are in `ios/Trueline/Backup.swift`. If either index is missing, the query
comes back refused rather than empty — which is why the app can print that
sentence at all instead of quietly showing you nothing.

### Checking it worked

Back on the phone, pull the Rooms list down to refresh, or close and reopen the
app. The amber iCloud line should be gone and the line at the bottom should say
how many scans are copied.

## 3. Before the App Store — deploy the schema

A container has **two** schemas, development and production, and they are
separate. Your Xcode builds talk to development. Anything from TestFlight or
the App Store talks to production.

In the same console: left sidebar → **Schema** → **Deploy Schema Changes** →
read what it lists → **Deploy**.

Both indexes from step 2 have to exist in Development *before* you deploy, or
you will deploy a schema without them and TestFlight will hit the same refusal
you just fixed.

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
