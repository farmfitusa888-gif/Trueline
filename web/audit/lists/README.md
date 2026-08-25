# Sample price lists — shapes, not prices

**Every number in these files is invented. None of them is any retailer's
price, and none of them may be used as one.**

They exist to prove the importer copes with the *shapes* real supplier files
arrive in, which is the part that can be verified without a price feed:
different column names and orders, quoted commas inside descriptions, dollar
signs and thousands separators, blank cells, duplicate rows, and — the one that
matters most — the units the building-materials trade actually prices in.

## Why there are no real prices in here

Every retailer domain is blocked by this build environment's network policy:
`homedepot.com`, `menards.com`, `flooranddecor.com`, `lowes.com` and
`build.com` were all tried and all refused. Rather than write numbers that look
like Home Depot's and are not, these carry obviously invented ones and say so
in the first column of the first row.

Nor is there such a thing as "the Home Depot CSV format" to code against.
Researched in August 2026:

- **Home Depot** has no native spreadsheet export of purchase history or Pro
  Xtra orders; contractors use third-party extractors or the Pro Desk.
- **Menards** has a *Transaction Report* download for business accounts.
- **Floor & Decor**'s Pro Premier app builds quotes and shares them by email.

So what actually reaches a contractor's phone is a transaction report, a quote
a pro-desk person exported, or a spreadsheet somebody typed — all of them "a
table with a description, a unit and a price in some arrangement". That is
exactly what the two-step mapping is for, and it is why the columns are
confirmed on screen rather than assumed.

## The files

| File | The shape it proves |
|---|---|
| `home-depot-pro-desk.csv` | A quote-style export: SKU, description with commas in it, UOM, extended and unit price columns, dollar signs |
| `menards-transaction-report.csv` | A transaction report: dates, a store column, quantities, and a price column that is not called "price" |
| `floor-and-decor-pro.csv` | Priced **by the box**, with a coverage column — the file that does not import at all without coverage |
| `abc-supply-roofing.csv` | Priced by the **square** and by the **bundle** — definitional conversion and a refusal side by side |
| `ferguson-plumbing.csv` | Each, dozens, and a hundredweight that is correctly refused |
| `sherwin-williams-paint.csv` | Gallons — a unit this book does not price in, refused with the reason |

## Which suppliers these are modelled on, and why those

Researched August 2026. For a residential remodeler the money goes to:

- **Home Depot / Lowe's / Menards** — the daily counter run.
- **Floor & Decor** — tile and flooring, and the reason coverage exists.
- **Builders FirstSource / 84 Lumber / US LBM** — structural, millwork, doors
  and windows.
- **Ferguson** — plumbing, HVAC and lighting.
- **ABC Supply / SRS** — roofing and exteriors.
- **Sherwin-Williams** — paint, priced by the gallon.

ABC Supply, Andersen, Builders FirstSource, Enterprise Wholesale and Ferguson
together held 15–20% of the 2024 market, which is why the list above is not
just the orange and blue stores.
