# Putting the app on the web, at app.trueline.tools

The same screens that run on your phone also run in an ordinary browser. They
always have — the whole audit drives them there — and this page is about turning
that into a thing anybody can open, at `app.trueline.tools`, for nothing.

**What it costs: nothing.** Not "nothing for now" and not "nothing until it gets
popular". The real limits are in Part 5, and they were checked rather than
assumed. Where a number came off a search result instead of Cloudflare's own
page, it says so — this machine's network refuses connections to
`developers.cloudflare.com`, so nothing here is claimed as read from the vendor.

**What it is for.** Somebody with no iPhone can draw a room by hand, look at it
in 3D, and correct it — free, no account. Everything that turns that drawing
into money is the subscription, the same line the phone draws, and a contractor
who already pays pastes one code and stops being asked. Part 6 is about that.

---

## Part 1 — Terminal, one command

This is the whole of what you type. It builds the site once so you can look at
it before anybody else does.

```bash
cd ~/trueline && git pull && npm install && npm run build
```

That writes `web/dist`. To open it on your own machine before it goes anywhere:

```bash
cd ~/trueline/web && npx vite preview --port 4173
```

Then open <http://127.0.0.1:4173/> in Safari. That is exactly what a visitor
will get, served the same way, with no network calls of any kind.

Press **Ctrl-C** in the Terminal window to stop it.

---

## Part 2 — Cloudflare, once, in a browser

Cloudflare Pages builds the site from the repository every time you push. There
is no upload step and nothing to remember.

1. Go to <https://dash.cloudflare.com> and sign in. Make an account if you have
   none — the free plan needs no card.
2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Authorise GitHub and pick the `trueline` repository.
4. Fill in exactly these three fields and nothing else:

   | Field | What to put |
   |---|---|
   | Project name | `trueline-app` |
   | Production branch | `main` |
   | Build command | `npm install && npm run build` |
   | Build output directory | `web/dist` |

5. Under **Environment variables**, add one:

   | Name | Value |
   |---|---|
   | `NODE_VERSION` | `22` |

   The build needs Node 22 — `package.json` says `>=22.6.0` — and Cloudflare's
   default is older than that. Without it the build fails on a syntax it does
   not know, which reads as a code error and is not one.

6. **Save and Deploy.**

The first build takes two or three minutes. When it finishes you get an address
like `trueline-app.pages.dev`. Open it. That is the app.

**There is nothing else to configure.** The headers and the one redirect the app
needs are files in the repository — `web/public/_headers` and
`web/public/_redirects` — which Vite copies into `web/dist` and Cloudflare reads
from there. No dashboard settings, and they are in git where they can be
reviewed.

---

## Part 3 — the name

`app.trueline.tools`, so it sits beside the marketing site without colliding
with it.

1. In the Pages project → **Custom domains** → **Set up a custom domain**.
2. Type `app.trueline.tools` → **Continue** → **Activate domain**.

If `trueline.tools` is already on Cloudflare's DNS, that is the whole of it —
Cloudflare adds the record itself and the certificate is issued automatically,
free, and renewed without being asked. HTTPS is not optional and not extra.

If the domain is registered somewhere else, Cloudflare shows you a `CNAME`
record to add at that registrar. Add it exactly as shown. It usually works
within minutes; the dashboard says **Active** when it has.

**This is a second site from the same repository.** `site/netlify.toml` already
deploys the marketing website — a different Netlify site with its own base
directory — and it is untouched by any of this. The two never share a build, a
domain or a deploy.

---

## Part 4 — checking it actually worked

Three things, in this order, and the first two take a minute.

1. **Open it on a machine with no Trueline on it.** You should get a page headed
   *"Trueline, in your browser. All of it but the scan."* If you get a blank
   page, the build output directory is wrong — it must be `web/dist`, not
   `dist`.

2. **Draw a room.** *Draw it by hand* → tap four corners → *Open it*. You should
   get a drawing with dimensions on it. That is the free half working.

3. **Check the headers arrived**, which is the one thing you cannot see by
   looking:

   ```bash
   curl -sI https://app.trueline.tools | grep -i "content-security-policy\|referrer-policy"
   ```

   Both lines should come back. If they do not, `_headers` did not reach the
   published directory — check that `web/public/_headers` exists in git and that
   the build output directory is `web/dist`.

---

## Part 5 — what it costs, and where the free plan actually ends

**Nothing, and the reason is one line: static hosting on Cloudflare Pages is
unmetered for bandwidth and requests.** There is no traffic budget to run out
of, so a link passed round a trade group cannot produce a bill. That is the
whole reason this is on Cloudflare rather than Netlify.

| Limit | Free plan | Where this site is | Checked how |
|---|---|---|---|
| Bandwidth | unmetered | — | search summary |
| Requests | unmetered | — | search summary |
| Builds | 500 a month | one per push | search summary |
| Files per site | 20,000 | **18** | counted: `find web/dist -type f \| wc -l` |
| Size of one file | 25 MiB | **0.9 MiB**, the biggest | measured, `web/dist` |
| Whole site | — | **1.9 MiB** | measured, `du -sh web/dist` |
| Custom domain + HTTPS | included | one | search summary |

**Be careful with the word "checked".** The three numbers marked *measured* were
measured on this machine, with the commands beside them, against a real build.
Everything marked *search summary* came from web search results, **not** from
Cloudflare's own pricing page: this machine's network refuses connections to
`developers.cloudflare.com` and `netlify.com` alike, so no vendor page was
opened. Before you rely on the free tier, read
<https://developers.cloudflare.com/pages/functions/pricing/> yourself. It takes
a minute and it is the only source that is actually authoritative.

**The one way to leave the free plan by accident** is Pages *Functions* — server
code — which draws on the Workers free allowance instead of being unmetered.
This site uses none, and should keep using none. There is no `functions/`
directory and nothing that would create one. If a future change adds server
code, this table stops being true.

### Netlify is still wired up, and stays wired up

`netlify.toml` at the top of the repository still publishes `web/dist`, with the
same headers and the same redirect in Netlify's own syntax. Nothing points at it
and it costs nothing to keep — it is a way out if Cloudflare's terms ever
change, and a second host that has been checked is worth more than a plan.

Netlify's free plan is a **credit budget**, not an unmetered one: search results
put it at 300 credits a month with bandwidth charged at 20 credits a gigabyte
since April 2026, which works out at roughly fifteen gigabytes before a free
site is paused until the next month. Again: search summary, not a vendor page.
That difference — a budget that runs out versus no meter at all — is the whole
of why Cloudflare won.

---

## Part 6 — what is free in a browser, and the code

The line is the same one the phone draws, and it is written down once, in
`core/src/entitlement.ts`, for both halves of the app:

**Free, with no account and no card:** scanning, measuring by hand, the drawing,
the 3D view, correcting anything on the plan, and the room's dimensions and
floor area.

**The subscription:** the takeoff, your rates applied, proposals, signatures,
change orders, insurance mode, every export, the supplier price list, and more
than one room kept at once.

Opening the app in a browser is not a way round that, and was never meant to be.
Before this, it was: scan on the phone, open the `room.json` in Safari, and the
takeoff and the proposal were free.

### The code, and exactly what it is worth

A contractor who already pays must not meet a paywall in his own browser, and
there is no account to ask — **there is no login anywhere in Trueline and there
is not going to be one.** The phone asks Apple who paid. The browser asks a
code.

On the phone, under *Your business*, there is a code that looks like
`TL-EHS7-EW4Z-Y733-7FWX`. Paste it into the box on the browser's front page,
once. From then on that browser does what the phone does.

**Say what this is, and do not let anybody imply more.** It is a **courtesy
lock, not security**:

- a code can be forwarded, and the browser it is forwarded to will take it;
- anybody who wants to make one can work out how, by reading the page they have
  already downloaded.

Neither is a bug to be fixed by making it cleverer. A stronger scheme running in
a browser the user controls is the same thing with more arithmetic in front of
it, and it would let the screen imply a guarantee the design cannot keep. The
screen says exactly this, in these words, where the box is.

What it does buy is worth having: an honest customer is not nagged, and "just
open it in Safari" stops being the whole product for nothing.

### The format, for whoever writes the phone half

Sixteen characters, written as `TL-` and four groups of four.

- The alphabet is Crockford's base 32 — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`,
  with no I, L, O or U, so nothing is misread off a phone screen.
- **Twelve characters of body**, from repeated FNV-1a rounds over a seed the
  phone owns and never sends — Apple's original transaction identifier is the
  obvious one. Hashed, so nothing about the purchase can be read back out, and
  the same phone always produces the same code.
- **Four characters of check**, two from FNV-1a of the body salted `0x5eed` and
  two salted `0x1eaf`, each rendered as two base-32 characters.

`makeUnlockCode` and `checkUnlockCode` in `web/src/roomLink.ts` are the whole
implementation, and it is deliberately trivial to write again in Swift.

---

## Part 7 — the part nobody else tells a browser visitor

**A browser is not a safe place to keep somebody's work**, and the app says so on
its front page rather than burying it.

Two separate mechanisms, both real:

- **Safari, and every browser on iOS**, delete *all* of a site's script-written
  storage — `localStorage`, `sessionStorage`, IndexedDB, service workers — after
  **seven days of browsing** in which nobody has been back to that site. It is
  part of Intelligent Tracking Prevention and it is documented policy, not a
  fault. Treat the number as Apple's to change: the write-ups of it date from
  2020, and the behaviour is the thing to design for, not the figure.
- **Any browser** may clear a site's storage sooner under storage pressure,
  oldest site first. Storage is "best-effort" by default and an origin is exempt
  only once its mode is persistent.

So the app asks. `navigator.storage.persist()` is the only lever there is, and
it is a request: the browser decides on its own criteria and returns what it
decided. **Whatever it answers is what the screen says** — never a hopeful
version of it — and even a yes is reported as a rule the browser keeps rather
than a promise it made.

And then it nags. Once there is real work in a room that is in no file — a wall
you measured, a scope, a proposal — a red line sits at the head of the room
saying so, with the button that answers it: **Write the job to a file**. It does
not go until a file has actually been written, and it is quiet before there is
anything to lose, because a warning that is on screen before it matters is a
warning nobody reads on the day it does.

It deliberately does **not** follow the screen down, which is the opposite of
what the app does with the line about the phone refusing a room. That one is
rare; this one is on for very nearly every browser visitor who has done
anything, and a banner that is almost always there and follows the screen is not
a warning, it is an obstacle. Made to follow the screen it sat on top of the
controls under it and stopped a change order being signed — six checks in
`a24-change`, measured. Under the room there is a panel that says the same thing
at length, with the same button, so both ends of the screen say it.

**Save the job file.** It is the only copy nothing can take back.

---

## Part 8 — getting a room from the phone into the browser

Three ways, and Sam asked for all three on condition each is free forever. All
three are, because none of them involves a server.

### iCloud Drive — no code was needed, and none was written

The phone already writes every corrected room into the owner's own iCloud. On a
Mac signed into the same Apple Account that is a folder in Finder, and the file
opens in the browser through the ordinary file picker. There was nothing to
build and nothing was built. See `docs/icloud-setup.md` for turning the backup
on; once it is on, this route already works.

### The job file — this needed the work

**Write the job to a file**, on any room, writes the whole job — the room, the
corrections, the scope, the prices, the proposal, what was signed — to one file.
Mail it to yourself, put it on a stick, drop it in Dropbox; open it with the
same *Choose a file* button a scan opens with.

**It did not work before.** Handed its own saved job through that picker, the
app ran it into the scan importer and answered *"The scan has no walls."* — a
wrong sentence about a perfectly good file. That was measured, and it is fixed:
the picker tries to read a job first and falls back to a scan.

### A link that carries the room inside it

*Make a link to this room* produces an address with the whole room packed into
the part after the `#`. **A fragment is never sent to any server** — not in the
request line, not in `Referer` — so nothing is uploaded by making the link or by
opening it, even though it goes through Cloudflare's network to load the page.

It refuses more often than it agrees, and each refusal says why:

- **A job with a picture in it** — a signature is stored as an image — is
  refused outright. Those bytes would go into somebody's message history.
- **A link longer than 8,000 characters** is refused, with its own length in the
  sentence.
- **A room with photographs** is refused. The job carries what each photograph
  is *called* and never its bytes; a link would open a room with every picture
  missing and nothing on screen to say why.

The link carries a warning on it, because it needs one: **it holds a customer's
room, and anyone forwarded it has that room** — the measurements, the scope and
the prices. Send it the way you would send the drawing itself.

#### Why 8,000, when the browser will take two megabytes

Measured, in Chromium 141.0.7390.37, by walking a real navigation up in length
until one stopped arriving whole: **a URL of 2,097,152 characters round-trips
and 2,097,153 does not.** Exactly 2 MiB. So the browser is never what breaks
one of these links.

Measured the same day, from real rooms driven through the real app:

| Room | The job | Packed into a link |
|---|---|---|
| A corrected garage | 3,579 characters | **1,168** |
| A kitchen | 3,581 | 1,167 |
| The garage with its furniture | 4,064 | 1,320 |
| Sam's dining and living room, nine walls | 12,133 | **3,764** |
| The same, walked with 9 photographs | 15,565 | 4,807 |
| The same, walked with 54 photographs | 32,113 | **8,808** |

Every room with no photographs in it fits inside 8,000 twice over. The one that
does not fit is the one with 54 photographs — which a link was never going to
carry anyway, because the pictures are not in the job.

**8,000 itself is a judgement and this page will not pretend otherwise.** What
is measured is 2,097,152. What could not be measured from this machine is what a
text message or a mail client will carry intact, so no number is claimed for
that. 8,000 is where a link stops being something a person can paste into a
message, and it is far enough above every real room measured here that no honest
use of it hits the limit.

---

## What there is to run, and what there is not

Everything in Part 1, once, to see it locally. Everything in Parts 2 and 3 is
clicking, once, and then never again — Cloudflare rebuilds on every push by
itself.
