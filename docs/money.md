# How this makes money, what a server would cost, and how to put that off

Every competitor price in here comes from `MARKET-RESEARCH.md`, which cites its
source and labels whether it was read off a vendor's own page or reported by a
review site. Nothing is estimated. Where I could not find a number, it says so.

---

## 1. What the field charges, and the hole in it

| Product | Price | Source class |
|---|---|---|
| magicplan | ~$33.33/mo; free tier is 2 complete projects | review |
| Polycam | ~$150/yr Basic; $36/mo Business for 20 plans | review |
| CubiCasa | $22.99–$29.99 **per scan**; $460–$600 per scan on some plans | review |
| Canvas / Twindo | ~$29/mo, plus humans doing scan-to-CAD in 1–2 days | review |
| Matterport | $65/mo (5 spaces) up to ~$309/mo | review |
| Hover | $99/mo **plus $29–$139 per project** | review |

**Two structural facts, both of them ours to exploit:**

1. **Nobody owns interiors + accuracy + estimating in one product.** Hover owns
   exteriors. magicplan owns insurance restoration. Polycam owns raw 3D. Canvas
   pays humans. CubiCasa owns real-estate volume. The remodeler doing interior
   as-builts to price a job is served by pieces of all of them and the whole of
   none.
2. **Everyone meters.** Per scan, per project, per space. The reviews say
   outright that this punishes low-volume contractors — under ten jobs a month
   the arithmetic stops working. Gilbert is a low-volume contractor. So is
   almost every remodeler.

## 2. The price

**$39/month per seat, flat. Unlimited scans, unlimited rooms, unlimited
exports.** Annual at $390 — two months free.

Why that number:

- It sits just above magicplan's ~$33 and well under Hover's $99 + per project.
  We are not the cheap option; being cheapest in a trade tool signals a toy.
- It has to beat *one avoided second trip to site* by a wide margin. A
  remodeler's return visit is half a day. At $39 the app pays for itself the
  first time it stops one, and that is the sentence the pricing page should say.
- Flat is the weapon. **"No per-scan charge. Scan the same room nine times
  because the light was bad — it costs nothing."** Every competitor's pricing
  page is an argument for ours.

**Free tier: one project, complete, forever.** Not a trial and not a watermark
and not a dimension paywall. Polycam's angriest reviews are about exactly those
three, and the loudest complaint in the whole research file is that *dimensions
are locked behind higher tiers* — "essential to using the application". A tool
that hides the measurement is not a measuring tool. **Dimensions are never
paywalled here, on any tier, ever.** That is worth writing into the pricing page
as a promise, because it is a promise no competitor can match without admitting
what they currently do.

**What a paid seat adds:** more than one project, sharing, the client link, and
the exports.

### Later, and only when it exists

- **A team price** — $99/month for up to five seats. The research is explicit
  that seat limits push teams into password sharing, which is a security problem
  and a growth blocker. Do not build the problem in.
- **Per-company, not per-app-store-account.** The schema has had company
  isolation since commit one, so this does not need a rewrite when it arrives.

### What Apple takes

**15%, not 30%** — the App Store Small Business Program, for developers under
$1 million in proceeds in a calendar year, which Sam is already enrolled in. So
$39 nets **$33.15**. Cross a million in a year and it goes to 30% for the rest
of that year; drop back under and you requalify the year after. That is a
problem worth having and it is a long way off.

Sources: [Apple's programme page](https://developer.apple.com/app-store/small-business-program/) ·
[the announcement](https://www.apple.com/newsroom/2020/11/apple-announces-app-store-small-business-program/)

## 3. What a server would cost — and how long it can be avoided

**Right now: nothing.** The scans live on the phone and back up to the owner's
own iCloud, which Apple describes as storing *"private data securely in your
users' iCloud accounts"* — their storage, their quota, no bill to us. See
`docs/where-the-data-lives.md`.

**What actually forces a server**, in the order these usually arrive:

| The thing somebody asks for | Needs a server? |
|---|---|
| A backup of my work | **No** — iCloud, today |
| The same job on my iPad | **No** — same iCloud account |
| Send a takeoff / a drawing to somebody | **No** — the share sheet, today |
| **My foreman edits the same job** | **Yes** |
| **A client link with no app and no login** | **Yes** |
| Roles and permissions | Yes |
| Anything on Android | Yes |

So there are exactly two things worth paying for a server to get, and both are
worth real money: **two people on one job**, and **a link a homeowner can open
in a browser**. Matterport's whole business is the second one.

**What it costs when it does arrive.** I have not priced hosts from this machine
and will not print a number I did not read. What is worth knowing is the
*shape*, because the shape is what decides whether it is $20 a month or $2,000:

- A small managed database and one small application host, for a product with
  tens of contractors on it, is the cheapest tier of any provider. This is not a
  high-traffic product: a remodeler saves a room a few dozen times a day.
- **The thing that gets expensive is storage of photographs**, not compute. One
  55-shot garage scan is 26 MB. A hundred contractors doing five jobs a week is
  megabytes turning into terabytes inside a year, and object storage is billed
  by the gigabyte-month **forever**, including for customers who have stopped
  paying.
- So the rule is the same one that already governs iCloud: **the model syncs,
  the photographs do not**, unless somebody asks and is paying for it. A
  corrected room is 6 kB. A hundred contractors' entire measured history is
  smaller than one of their photo libraries.

**How to put it off, concretely:**

1. **Ship on iCloud only.** Backup, second device, and the two people who
   already share an Apple ID. That covers the first ten customers.
2. **Sharing a finished thing is not sync.** A takeoff, a drawing, a PDF — those
   go out through the share sheet today and reach whoever is pricing them.
   Nobody needs an account to receive a text message.
3. **When the client link is the thing being asked for, price it.** It is worth
   more than $39 on its own, and it is the first feature that should carry the
   server's cost rather than being absorbed into the base price.
4. **Never store photographs server-side by default.** That is the line that
   turns a $20/month bill into a $2,000/month one, and once it is crossed it
   cannot be uncrossed for the customers already on it.

## 4. Xactimate ESX — what I found and why it is not built

`ESX` is on the roadmap because the research says magicplan's strongest moat is
exactly that integration, and it is why restoration contractors pay $33/mo.

**It cannot be written honestly from here.** ESX is a proprietary Xactware
format — a ZIP of XML — and there is no public specification for it. What is
publicly documented is that it exists, that it is zipped XML, and a handful of
keyword names. That is not enough to write one, and an export that Xactimate
rejects is worse than no export at all: somebody would try it once, on a real
claim, in front of a client.

**So it is not built, and it is not stubbed.** What it needs is access, not
engineering time:

- Verisk/Xactware run a partner programme. The spec comes from asking them,
  under an agreement.
- Until then the same quantities reach an estimator through the CSV the takeoff
  already produces — every row carrying its own unit and its own provenance,
  which is more than most integrations pass along.

This is worth doing **only if Gilbert or the next few customers touch insurance
restoration work**. If they are remodel-and-renovation, ESX is a moat around
somebody else's market and the effort belongs in the client link instead.

## 5. The pitch — what this is actually selling

The current framing is accuracy, and accuracy is the *proof*, not the promise.
Nobody buys a tape measure because it is accurate; they buy it because it is
Tuesday and they have to price a kitchen.

**The promise is speed to a number you can stand behind.**

> Professionals spend **8 to 24 hours** measuring and documenting a single
> residential space. Miss one measurement and it is another trip.
> — from the as-built research

That is what is being sold against. So:

**"Walk the room. Put a tape on two walls. Send the takeoff before you leave
the driveway."**

Everything the product does slots under that sentence:

- **The scan** is what makes it twenty minutes instead of a day.
- **The two tape readings** are what make the number defensible — and the
  verification punch list is what makes it *two* readings instead of thirty.
- **The takeoff** is the number itself: floor, ceiling, wall face less every
  opening, baseboard less every door, the jamb to order, the framing.
- **The provenance** is what lets somebody put their name on it. Every figure
  says whether a person stood behind it, on the screen and on the export, and
  it says so to the person receiving it too.

And the line that no competitor can copy without rebuilding their product:

> **Nothing here is called a measurement until somebody has put a tape on it.**

Say it on the pricing page. It is a strange thing for a measuring app to admit
and it is the most trustworthy sentence in the category — because everybody in
the trade already knows a scan is a guess, and this is the only app that says so
out loud.

### What to say to Gilbert, in one paragraph

> Scan the room in twenty minutes instead of measuring it for half a day. The
> app tells you which two walls are worth a tape and moves everything else to
> fit when you type them. Then it hands you drywall, paint, flooring, baseboard,
> the jamb size to order and the stud count, and you text it to whoever is
> pricing it before you get back in the truck. Every number says whether it came
> off the scanner or off your tape — so when a client argues with one, you can
> show them which.
