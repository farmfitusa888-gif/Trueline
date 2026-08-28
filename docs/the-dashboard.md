# The owner's dashboard on more than one device

You asked for the dashboard on more than one device, and then for the part that
decided how: *"figure out a way to do 2 for free and implement that now if you
can do it for free forever."*

This is how it works, what to set up once, and what to do when it stops.

**Read the two honesty notes first.** Everything marked **[unverified]** is
something this machine could not check, because the container this was built in
cannot reach GitHub's documentation, GitHub's pricing pages, or any
repository-scoped part of GitHub's API — see *What was actually tested* at the
bottom for exactly what that means. And the token you are about to make is a
password: the section on what it does and does not protect is not boilerplate.

---

## What it does

The dashboard's books — the free months you have given out, what Apple has paid
you, the TestFlight list, the crashes people sent in, and your notes about who
got in touch — are kept as **one JSON file in a private GitHub repository of
your own**. Each device reads that file, merges it with what it has, and writes
it back.

No contractor's work is in it, and none can get into it. That is not a habit,
it is enforced: the file format refuses to carry any field the dashboard does
not recognise, so a room, a photograph or a client's name cannot ride along
even by accident.

## What it costs, and why that is not a free tier

**Nothing.** There is no server, no database, no subscription and nobody to
invoice you.

The reason that holds is not that GitHub currently gives away private
repositories — that is a company's pricing decision and companies change those.
It is that **your books are a plain text file in a git repository, and git
repositories are copies all the way down.** Every machine that has ever cloned
it holds the whole thing, including the entire history. If GitHub changed its
terms tomorrow you would not need an export, a migration or a support ticket:
you already have the file, on your Mac, and it would push to anywhere else that
speaks git. There is nothing to be locked out of.

That is a different kind of promise from a free tier, and it is the only kind
worth building on.

The side benefit is the one that made this the right answer rather than merely
a cheap one: **the commit history is the audit trail.** A book of grants and
takings is append-only by nature, and every change to it now arrives with a
date, a device name and a diff you can read.

## What it is not

- **It is not live.** Nothing pushes. A device learns what the other one did
  when you press sync, and not before.
- **It is not a database.** Every read is the whole file and every write is the
  whole file. That is right for hundreds of rows and would be wrong for
  hundreds of thousands. If it ever gets there, the answer is to say so, not to
  bolt an index onto a git blob.
- **It does not merge two edits of the same thing.** If the Mac and the phone
  each changed the same grant, the app tells you and writes nothing. It will
  not pick one. See *When two devices disagree*.

---

## Part 1 — make the repository, once

On **github.com**, signed in as yourself:

1. Top right, **+** → **New repository**.
2. Owner: your own account. Name: `trueline-books`.
3. **Private.** This one matters — it holds what Apple pays you.
4. Tick **Add a README file** so the repository is not empty.
5. **Create repository**.

That is the whole of it. You never have to open it again, though the history is
worth looking at once in a while — every sync is a commit, and the diff shows
exactly what changed.

If you would rather reuse a private repository you already have, you can: the
dashboard writes one file and touches nothing else. Just know that anyone you
ever give access to that repository gets the books with it.

## Part 2 — make the token

The dashboard signs in to GitHub with a **fine-grained personal access token**
scoped to that one repository and nothing else.

**[unverified]** — the wording on these screens could not be checked from the
machine this was written on, so the labels below are what to look for rather
than a transcript. The shape of it will be right even if a word has moved.

1. On github.com: your avatar, top right → **Settings**.
2. Bottom of the left sidebar → **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new
   token**.
4. **Token name:** `trueline books`. Give it an expiry you can live with —
   fine-grained tokens expire, and the app will tell you plainly when yours
   has.
5. **Repository access:** *Only select repositories* → pick **`trueline-books`**
   and nothing else. Do not choose "All repositories".
6. **Permissions** → **Repository permissions** → find **Contents** and set it
   to **Read and write**. Leave every other permission alone. Contents is the
   only one this needs.
7. **Generate token**, then copy it. **GitHub shows it once.** If you lose it,
   you do not recover it — you delete it and make another, which takes a
   minute.

## Part 3 — put it into the app

Open the dashboard, and in the owner's settings fill in:

- **Owner** — your GitHub username.
- **Repository** — `trueline-books`.
- **File** — `books.json`.
- **Branch** — `main`.
- **This device** — what you call the machine you are sitting at: *the office
  Mac*, *the iPhone*. It goes into the commit message, so the history reads
  like a history.
- **Token** — paste it.

Then press sync. The first sync on the first device creates the file. The first
sync on the second device pulls it down.

Do the same on the second device, with the same repository and the same file
name, **its own device name**, and either the same token pasted again or a
second one made the same way. A second token is slightly better housekeeping:
if you lose the phone you revoke that one and the Mac keeps working.

---

## What the token protects, and what it does not

**It protects:** the token can touch that one repository and nothing else. It
cannot read your other code, cannot open issues, cannot act as you anywhere on
GitHub, and it can be revoked in one click without disturbing anything else you
have.

**It does not protect against somebody using your unlocked device.** The token
is kept in the browser's own storage on that device. It is not in a keychain,
it is not encrypted, and this app is not going to pretend otherwise: anyone who
can pick up your unlocked phone or sit at your unlocked Mac can read it.

That is exactly why the scoping in Part 2 matters. Scoped the way it is
described there, the worst case is one repository holding grants, takings and
notes you typed. Scoped to "All repositories", the worst case is your whole
account. It is one dropdown and it is the difference.

Two things follow from that, and they are the whole of the security advice:

- **Lock your devices.** That is the actual control here.
- **If a device goes missing, revoke that token.** github.com → Settings →
  Developer settings → Fine-grained tokens → the one named `trueline books` →
  **Delete**. It stops working immediately, everywhere it was pasted. Nothing
  in the repository is lost, and the other device keeps working once you give
  it a new one.

The token never leaves the device it was typed on except as an `Authorization`
header to `api.github.com`. It is never written into the file, never put in a
web address, never logged, and never included in an error message — the code
checks every message it produces against the stored token before showing it,
so that is a property of the program rather than a promise about it.

---

## When two devices disagree

If you added a grant on the Mac and a different one on the phone, both survive.
That is the ordinary case and it needs nothing from you.

If the **same** record says different things in the two places — the same offer
code with a different number of months, say — the app stops, shows you both
versions side by side, and **writes nothing at all**. It will not choose.

That is deliberate, and it is the same rule the rest of the app runs on: a
number nobody can point at is worse than no number. There are only two ways a
program can resolve that automatically. It can take the newer one, which means
taking whichever device's clock is ahead. Or it can take one side by rule,
which means silently throwing away something you typed. Both produce a business
record that quietly disagrees with what you remember, and you would not find
out until it mattered.

**What to do:** look at the two, decide which is right, correct the other one
on the device that has it wrong, and sync again.

The one case where this bites without you having made a mistake is the free
months. Apple tells the app that a code was redeemed; only you know who you
gave it to. If the Mac has your note about Gilbert and the phone has Apple's
redemption, those are two different facts about the same code and the app will
not staple them together — because the result would read as though Apple
confirmed Gilbert redeemed it, and Apple does not report that and never will.
Put both on one device, sync, and it is one record from then on.

---

## When it stops working

Every message the app gives you here says what was wrong and what nothing was
written. These are the ones you will actually see.

**"There is no token on this device."** Paste one in. Browsers clear site data;
this is the ordinary reason.

**"GitHub refused the token."** It expired or you deleted it. Make a new one —
Part 2 — and paste it in. Nothing on either side has changed.

**"GitHub will not show this token the repository."** Either the owner or
repository name has a typo, or the token was made without that repository
listed under its access. Check both. GitHub answers the same way for a
repository that does not exist and one the token cannot see — on purpose, so
that a token cannot be used to discover which private repositories somebody has
— so the message names both, and both are worth a look.

**"The token can read … and may not write to it."** The token's **Contents**
permission is on read-only. Make a new one with read and write.

**"GitHub could not be reached."** The network. Nothing was written; try again
when you have signal.

**"Another device wrote to the books twice while this one was syncing."** Rare,
and harmless. Two devices happened to write at the same moment, twice running.
Nothing was lost — what is on this device is still on it. Press sync again.

**"GitHub described the books but did not send them."** The file has grown past
what GitHub will hand back in one piece. This is the message that means the
approach on this page has reached its limit, rather than something you can fix
by pressing a button. Tell me and I will change how it is read; do not work
around it, because the quiet version of this failure is reading an empty book
and writing it back over the top of everything.

---

## What was actually tested, and what was not

You should know which parts of this have been run and which have only been
read, because they are not the same and the difference is where bugs live.

**Run, and passing:** the whole merge — every kind of record, both devices
adding things, both devices disagreeing, a file from a newer version of the
format, a file with a field that does not belong, money that arrived as an
ordinary number instead of an exact one. 36 checks. And the failures only a
running system shows: no token, a repository answering 404, a network that is
not there, a write refused because another device got there first and the
recovery that follows it, a file too big to send, a status nobody planned for.
20 more. Every one of those 56 was watched failing on purpose before it was
believed — the thing it checks was broken, the check went red, the break was
put back, the check went green.

**[unverified] — not run against GitHub.** No call in this feature has ever
reached a real repository. The container this was built in can reach
`api.github.com` and can ask it who the session's token belongs to, but every
`repos/…` path and the "create a repository" call are intercepted by that
container's own outbound proxy, which answers **403** before the request gets
to GitHub. So no scratch repository could be made to test against, and the
conflict this design turns on — GitHub refusing a write that was based on a
version of the file that has since moved on — **could not be provoked against
the real thing.** The status codes are GitHub's documented ones. They are
handled, and they are tested against recorded shapes, but nobody has watched
GitHub produce one.

That is the one thing on this page to keep an eye on, so it was built to fail
loudly rather than quietly if the documentation turns out to be wrong: **only
"200 OK" and "201 Created" count as written.** Every other answer writes
nothing and says so, there is no fall-through that means success, and if GitHub
answers a stale write with a different code than the documented one, the result
is still *"read it again"* and never *"done"*. The first real sync between your
Mac and your phone is the test that has not been run. Do it with one grant in
it before you trust it with a year of takings.

---

## The commands

There is nothing to install and nothing to run for this feature — it is all in
the app and on github.com. What is below is the check that the repository as a
whole is sound, which is worth running on your Mac after a pull:

```bash
cd ~/trueline && npm test && npm run typecheck && npm run build
```
