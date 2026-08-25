# Where the data lives — a recommendation, and why

You asked for a recommendation on this rather than a build, so this is a
recommendation. Nothing here has been built.

Everything below marked **[research]** comes from `MARKET-RESEARCH.md`, which
cites its sources. Everything marked **[unverified]** is something I believe and
could not check from this machine, because outbound connections to Apple's
documentation are refused by this environment's network policy. Treat those as
things to confirm before spending a day on them, not as facts.

---

## Where it lives today

Every scan is a folder in the app's own Documents directory on the phone.
Nothing leaves the device. That has three consequences and only one of them is
good:

- **Good:** it works in a basement with no signal, which is where half the
  scanning happens, and there is no bill, no login, no password reset and no
  privacy surface. The screen says *"nothing here left this device"* and it is
  true.
- **Bad:** Gilbert drops his phone down a stairwell and a morning's work is
  gone. There is no copy anywhere.
- **Bad:** there is no way to open a job on a second device, and no way for two
  people to work the same job.

The first of those is the one that will decide whether contractors keep using
it, and it is a real near-term risk rather than a hypothetical one.

## The three shapes this can take

| | Where the truth is | Works with no signal | Monthly cost to you | What it gets you |
|---|---|---|---|---|
| **Cloud-never** (today) | the phone | yes | nothing | privacy, simplicity |
| **Local-first** | the phone; a copy elsewhere | yes | see below | backup, second device |
| **Cloud-first** | a server; the phone caches | no, not really | servers from day one | nothing this product needs |

**Cloud-first is out.** A scanner that needs a signal is a scanner that does not
work in the rooms it is for. That is not a close call and I am not going to
present it as one.

So the real question is whether to stay at cloud-never or move to local-first,
and the answer is **local-first — but through the user's own iCloud first,
not through a server of yours.**

## The recommendation

**Now: iCloud (CloudKit private database) for the room model only.**

- The phone stays the source of truth. Everything works offline exactly as it
  does today; a copy goes up when there is signal.
- **[unverified]** CloudKit's private database stores data in *each user's own*
  iCloud account and against their own quota, not yours — so there is no server
  to run and no monthly bill before there is a customer. This is the single
  reason to prefer it, and it is the thing to confirm first.
- You already pay the $99 developer fee. This adds nothing to it.
- No accounts to build. No sign-up screen, no password reset, no email
  deliverability, no support burden — the phone already knows who its owner is.
- The privacy line stays honest and stays good. It changes from *"nothing here
  left this device"* to *"your scans are in your own iCloud, not ours"*, which
  is still true and still better than every competitor.

**The room model only, and this part matters.** A corrected room is a few
kilobytes of JSON. A scan's photographs are hundreds of megabytes. Free iCloud
is 5 GB **[unverified — the number is long-standing but confirm it]**, and
filling a customer's iCloud with your app's photos is how an app gets deleted.
So: the model syncs always, silently, and photos stay on the phone unless
somebody asks for them to go up over Wi-Fi. Say that on the screen rather than
letting somebody find out.

**Then, when somebody is paying: a small server, for the things iCloud cannot
do.** Not before.

- Two people on the same job. Roles and permissions. A job handed from Gilbert
  to a sub without either of them sharing an Apple ID.
- A client link — a plan somebody can look at in a browser with no app and no
  login. **[research]** Matterport's entire business is that one feature, and
  the review sites are explicit that seat limits pushing teams into credential
  sharing is a growth blocker in this market.
- These are worth real money and they are worth building **after** somebody has
  said they will pay for them, not before.

**Never by default: photographs off the device.** A remodeler's photos are the
inside of somebody's house — their kitchen, their bathroom, their stuff. That
should be a decision somebody makes per job, out loud, not a default.

## Why not simply keep it cloud-never

Because the failure it leaves open is the one that loses you the customer. Every
other risk on this list is recoverable; a contractor who loses a job's
measurements does not come back. And the fix costs nothing per month, which is
the unusual part — normally "add backup" means "start paying for servers", and
here it does not.

## Why not go straight to your own server

Three reasons, in order of size:

1. **It costs money from the day you turn it on**, before there is a customer,
   and it never stops. Everything else in this project so far has cost the $99
   you had already paid.
2. **It is a lot of product that is not the product.** Sign-up, sign-in, forgot
   password, email, sessions, per-company isolation, backups of your own,
   somebody to call when it is down at seven in the morning. None of it makes a
   drawing more accurate.
3. **It changes what you can say.** "Nothing left your phone" is a sentence you
   can say to a contractor who is nervous about a customer's house being on
   somebody's server. Once you run the server, that sentence is gone and you
   have to earn trust some other way.

## What I would do in what order

1. **iCloud sync of the room model.** Silent, offline-first, and a line on the
   screen saying plainly what is backed up and what is not.
2. **A visible "this is not backed up" state** for a phone with no iCloud signed
   in. An app that quietly fails to back up is worse than one that never
   claimed to.
3. **Photos: opt in, Wi-Fi only, per job.**
4. **Nothing else until somebody is paying.** Then the server, for shared jobs
   and the client link.

## What this does not decide

Sharing a *finished* thing — a takeoff, a drawing — is already solved and does
not need any of this. It goes out through the iPhone share sheet into Messages
or email, today, and that is how a takeoff actually reaches whoever is pricing
it. Do not let "we need sync" become a reason to delay that; it is already
built and it works.
