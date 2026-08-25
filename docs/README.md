# docs

| File | What it is |
|---|---|
| `scanning-field-card.pdf` | Six-page illustrated field card. Print it double-sided, take it on site, write on page 4. |
| `scanning-field-card.html` | Generated. Do not hand-edit — it is overwritten on every build. |
| `build/diagrams.py` | The seven SVG diagrams. Edit here. |
| `build/build_card.py` | Composes the card and finds a layout that fits. Edit here. |
| `market-research.html` | What the field already does, and where the gap is. |
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
