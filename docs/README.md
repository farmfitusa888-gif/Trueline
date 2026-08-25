# docs

| File | What it is |
|---|---|
| `scanning-field-card.pdf` | Six-page illustrated field card. Print it double-sided, take it on site, write on page 4. |
| `scanning-field-card.html` | Generated. Do not hand-edit — it is overwritten on every build. |
| `build/diagrams.py` | The seven SVG diagrams. Edit here. |
| `build/build_card.py` | Composes the card and finds a layout that fits. Edit here. |
| `handbook.html` | **The handbook.** Every screen and every button, in 47 cards, with a live search. Open it in a browser. |
| `handbook.pdf` | The same handbook, printed. 16 pages, letter. |
| `build/build_handbook.py` | Prints the handbook. Does not restate any of it. |
| `build/check-guide.py` | Every button the handbook quotes must exist in the app. Run it before publishing. |
| `market-research.html` | What the field already does, and where the gap is. |
| `what-trueline-should-cost.html` | The price, argued against what the competition charges. |
| `the-trueline-wedge.html` | Why this app exists in a market with six scanners in it. |
| `on-the-phone.md` | Pulling the current build onto an iPhone, and the ordered list of what to test on it. |
| `give-it-to-gilbert.md` | Getting the app onto somebody else's phone — TestFlight, and the two alternatives. |
| `icloud-setup.md` | The three console steps that turn the backup on. One of them fails silently if skipped. |
| `where-the-data-lives.md` | Why the backup is the user's own iCloud rather than a server. |
| `money.md` | The price, what a server would cost, the ESX finding, and the pitch. |
| `v3.md` | What to build after V2, and the three things it changes about what to store today. |

## Rebuilding the card

```bash
cd docs/build && python3 build_card.py          # writes guide.html, prints the page count
chromium --headless --no-pdf-header-footer \
  --print-to-pdf=../scanning-field-card.pdf guide.html
```

`build_card.py` walks a ladder of type sizes and tape-log row counts and stops at the
first combination that lands on exactly `TARGET_PAGES`, so adding content does not silently
push the card to an extra sheet — it re-fits by shortening the tape log, or the ladder runs
out and the build fails rather than shipping the wrong page count.

**When the app changes, this changes.** Pages 5 and 6 describe what the screen does with a scan
and what walking a room without LiDAR involves.
If the colours on the plan, the wording of a refusal, or what the importer decides for you
changes, the card is wrong until it is rebuilt — and a wrong field card is worse than none,
because somebody is holding it in a room believing it.

## Two rules for editing it

**Never shrink the type to make something fit.** It is read at arm's length on a job site.
Cut words, or let the card grow a page. The ladder starts at 9.2pt and will not go below
what was set when it was last verified.

**Look at the rendered pages before committing.** Every layout change here has broken
something that only showed up in the render — labels running off an SVG artboard, a caption
landing under a sofa, a masthead clipped at the margin, footers stranded on their own page.
Rasterise and look:

```python
import pypdfium2 as pdfium
pdf = pdfium.PdfDocument("scanning-field-card.pdf")
[pdf[i].render(scale=1.5).to_pil().save(f"p{i+1}.png") for i in range(len(pdf))]
```

Check greyscale too — the card gets photocopied. The diagrams carry meaning in line weight
and dash pattern as well as colour, and that has to stay true.


## Rebuilding the handbook

```bash
python3 docs/build/check-guide.py docs/handbook.html   # must pass first
python3 docs/build/build_handbook.py                   # writes docs/handbook.pdf
```

`check-guide.py` is not optional and runs first on purpose. It reads every string the
handbook puts in bold — which is how the handbook marks *this is what the screen says* —
and looks for it in the app's own source. A guide that tells somebody to tap a button the
app does not have is worse than no guide: they conclude the app is broken and stop. It
caught three wrong quotes on its first run.

`handbook.html` is the source and the web version both. It is hand-edited; the PDF is
generated and must never be. Everything in it lives in one `GUIDE` array near the bottom,
so adding a feature means adding one card there and rebuilding.

**When a button is renamed, this breaks** — which is the point. `check-guide.py` fails,
names the string it could not find, and the handbook gets corrected in the same commit as
the rename.
