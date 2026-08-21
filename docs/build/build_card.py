import re, subprocess, os, sys
import pypdfium2 as pdfium
from diagrams import STAND, HOLD, WALK, FURNITURE, OPENPLAN, PLANKEY

CH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
ROW = '      <tr><td class="b"></td><td class="b"></td><td class="b"></td><td class="b"></td><td class="b"></td></tr>\n'

def css(body_pt, lead):
    return f'''
  @page {{ size: letter; margin: 12mm 12mm 10mm; }}
  * {{ box-sizing:border-box; }} html,body {{ margin:0; padding:0; }}
  body {{ font-family:"Liberation Sans",Arial,sans-serif; color:#14181B;
         font-size:{body_pt}pt; line-height:{lead}; -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
  header.mast {{ border-bottom:2.5pt solid #14181B; padding-bottom:6pt; margin-bottom:9pt;
                display:flex; justify-content:space-between; align-items:flex-end; gap:12pt; }}
  .brand {{ font-size:19pt; font-weight:bold; letter-spacing:-0.5pt; line-height:1; }}
  .brand span {{ color:#B8590A; }}
  .sub {{ flex:0 0 auto; white-space:nowrap; font-size:7.4pt; color:#4A5459; letter-spacing:.6pt; text-transform:uppercase;
         font-family:"DejaVu Sans Mono",monospace; text-align:right; line-height:1.5; }}
  h2 {{ font-size:11pt; margin:0 0 4pt; letter-spacing:-0.2pt;
       border-bottom:1pt solid #B9C1C6; padding-bottom:2.5pt; }}
  h2 .n {{ font-family:"DejaVu Sans Mono",monospace; color:#B8590A; font-size:9pt; margin-right:6pt; }}
  section {{ margin-bottom:8pt; break-inside:avoid; }}
  p {{ margin:0 0 4pt; }}
  figure {{ margin:4pt 0 5pt; break-inside:avoid; }}
  figure svg {{ width:100%; height:auto; display:block; }}
  table {{ border-collapse:collapse; width:100%; font-size:8.8pt; }}
  th,td {{ border:0.7pt solid #9AA4AA; padding:3.4pt 5pt; text-align:left; vertical-align:top; }}
  th {{ background:#E4E9EB; font-size:7.8pt; text-transform:uppercase; letter-spacing:.5pt; }}
  td.k {{ white-space:nowrap; font-family:"DejaVu Sans Mono",monospace; }}
  td.b {{ height:19pt; background:#FCFCFD; }}
  ul.rules {{ margin:0; padding:0; list-style:none; display:flex; flex-wrap:wrap; gap:3pt 10pt; }}
  ul.rules li {{ flex:1 1 46%; position:relative; padding-left:19pt; }}
  ul.rules li::before {{ content:counter(r); counter-increment:r; position:absolute; left:0; top:0.5pt;
    width:13pt; height:13pt; border-radius:50%; background:#14181B; color:#fff;
    font-family:"DejaVu Sans Mono",monospace; font-size:8pt; font-weight:bold;
    display:flex; align-items:center; justify-content:center; }}
  ul.rules {{ counter-reset:r; }}
  .warn {{ border-left:3pt solid #B8590A; background:#FBF3EA; padding:5pt 8pt; margin:6pt 0; }}
  .warn .lbl {{ font-family:"DejaVu Sans Mono",monospace; font-size:7.6pt; text-transform:uppercase;
               letter-spacing:.8pt; color:#B8590A; display:block; margin-bottom:1.5pt; }}
  footer {{ break-inside:avoid; margin-top:7pt; padding-top:4pt; border-top:0.7pt solid #B9C1C6;
           font-size:7pt; color:#5B656B; line-height:1.4; }}
  .pb {{ break-before:page; }}
'''

def mast(right):
    return f'''<header class="mast"><div class="brand">True<span>line</span></div>
  <div class="sub">{right}</div></header>'''

FOOT1 = ("Figures are published manufacturer and industry values, not measurements taken by Trueline. "
  "Range ~5 m / 16 ft; minimum working distance ~8&ndash;10 in; recommended max scan area ~9 &times; 9 m. "
  "Validate against your own device before quoting any of them to a customer.")
FOOT3 = ("<b>What to send back:</b> one export file per room, scanned separately &mdash; not merged. Two rooms "
  "that share a wall are worth far more than two at opposite ends of the house. JSON above all other "
  "formats; DXF and PDF too if the app offers them. Plus this page, filled in.")

def html(body_pt=9.2, lead=1.34, rows=7):
    return f'''<!doctype html><html><head><meta charset="utf-8"><title>Trueline Field Card</title>
<style>{css(body_pt, lead)}</style></head><body>

{mast("Field card &mdash; how to scan a room<br>Rev 3 &middot; iPhone / iPad LiDAR")}

<section>
  <h2><span class="n">01</span>Where to stand</h2>
  <figure>{STAND}</figure>
  <p><b>Why:</b> the whole wall run has to be in frame, including where it meets the floor. Hug the wall
  and the sensor sees only a patch, with no long straight edge to fit a plane to. Minimum working
  distance is about 8&ndash;10 in; the range ceiling is about 5 m.</p>
</section>

<section>
  <h2><span class="n">02</span>How to hold it</h2>
  <figure>{HOLD}</figure>
  <p>Chest height, tilted slightly down, two hands, elbows in. Smooth beats fast.</p>
</section>

<section>
  <h2><span class="n">03</span>The limits &mdash; where it breaks</h2>
  <table>
    <tr><td class="k">Under 5 min</td><td>Per room. Longer sessions drift, the device heats up, tracking degrades.</td></tr>
    <tr><td class="k">Under 30 &times; 30 ft</td><td>Apple's recommended maximum scan area. Bigger spaces get split.</td></tr>
    <tr><td class="k">One room per scan</td><td>Do not walk the house in one go. Each room is its own capture.</td></tr>
    <tr><td class="k">Glass &amp; mirrors</td><td>Reflective surfaces cut reliability. Note them rather than trusting them.</td></tr>
  </table>
  <div class="warn"><span class="lbl">If the app tells you something, it wins</span>
  RoomPlan gives live feedback &mdash; "Move farther away", "Slow down", "More light". It reads your actual
  session; this card does not. Follow the screen.</div>
</section>

<footer>{FOOT1}</footer>

<div class="pb"></div>
{mast("Field card &mdash; page 2<br>The walk &amp; furniture")}

<section>
  <h2><span class="n">04</span>How to walk it</h2>
  <figure>{WALK}</figure>
  <ul class="rules">
    <li><b>Start in a corner</b>, never mid-wall.</li>
    <li><b>Move your body</b>, not your arms.</li>
    <li><b>Pause at every corner.</b> That is where the geometry gets pinned down.</li>
    <li><b>Finish where you started.</b> Biggest quality lever on the card.</li>
    <li><b>Lights on.</b> LiDAR does not care; the camera tracking does.</li>
  </ul>
</section>

<section>
  <h2><span class="n">05</span>Furniture &mdash; leave it, but know what it costs</h2>
  <figure>{FURNITURE}</figure>
  <p>A furnished room is the real job, so do not empty it. Pick up loose floor clutter, and note which
  walls are blocked.</p>
</section>

<footer>A furnished room is the real job. Pick up loose floor clutter, note which walls are
blocked, and tape only walls that are clear.</footer>

<div class="pb"></div>
{mast("Field card &mdash; page 3<br>Open plans &amp; when it goes wrong")}

<section>
  <h2><span class="n">06</span>Open plans &mdash; one scan, then split</h2>
  <figure>{OPENPLAN}</figure>
  <p>A kitchen running into a dining area running into a living room is <b>one capture</b>. Do not
  scan the areas separately: there is no wall between them to anchor on, so two captures of one
  continuous floor invent a seam the building does not have.</p>
  <p><b>The exception.</b> Over about 30 &times; 30 ft or five minutes it has to be split anyway
  &mdash; and this is the hardest case in the whole job. Overlap the two walks generously and make
  sure one shared feature appears in <b>both</b>: a column, a fireplace, a full corner.</p>
  <p><b>Write down two things.</b> Where <em>you</em> would draw the line between the areas, and
  whether the ceiling changes height across the space &mdash; a vaulted living room off a flat-ceiling
  kitchen is not the same ceiling, and the quantities have to know that.</p>
</section>

<section>
  <h2><span class="n">07</span>When it goes wrong</h2>
  <table>
    <tr><td class="k">It closed perfectly</td><td><b>That means nothing.</b> A scan always closes &mdash; the app squares it up before you ever see it. Two real scans, every corner meeting to a thousandth of a millimetre, both of them still unmeasured. Tape it anyway.</td></tr>
    <tr><td class="k">Will not close</td><td>Walk it again <b>in the opposite direction</b> before giving up.</td></tr>
    <tr><td class="k">Wall missing</td><td>Too close, or held level. Re-walk at 4&ndash;6 ft, angled at the floor joint.</td></tr>
    <tr><td class="k">Tracking jumped</td><td>Stop and start the room again. A lost-tracking scan is not worth saving.</td></tr>
    <tr><td class="k">Device hot</td><td>Scan was too long. Split the space up and let it cool.</td></tr>
    <tr><td class="k">Simple room first</td><td>It is the control case. If simple is right and awkward is wrong, the problem is geometry &mdash; the solver's job, not yours.</td></tr>
  </table>
</section>

<footer>A room walked wrong cannot be fixed afterwards &mdash; it has to be walked again. Four minutes
done properly beats twenty done badly.</footer>

<div class="pb"></div>
{mast("Field card &mdash; page 4<br>Tape log &mdash; print and write on this")}

<section>
  <h2><span class="n">08</span>The tape log &mdash; the most valuable thing you do</h2>
  <p>A scan on its own has no ground truth. <b>At least one wall running each way</b> &mdash; one
  left-to-right, one front-to-back &mdash; or the plan cannot be checked at all: the two directions
  are separate sums, and measuring one says nothing about the other. Then as many <b>clear</b> walls
  as you have patience for, longest first. <b>Measure one wall twice</b>, at the start and end of the
  scan &mdash; if the two differ, that is drift, a different problem from sensor error.</p>
  <div class="warn"><span class="lbl">The app will tell you which walls</span>
  Open the scan in Trueline first and it ranks them: longest and most blocked at the top, because
  that is the measurement that buys the most. Four of them is a two-minute job. Send the list to
  your phone before you go.</div>
  <table>
    <thead><tr><th style="width:20%">Room</th><th style="width:22%">Which wall</th><th style="width:19%">Tape says</th><th style="width:19%">Scan says</th><th>Notes &mdash; &ldquo;B&rdquo; if blocked</th></tr></thead>
    <tbody>
@@ROWS@@    </tbody>
  </table>
  <p style="margin-top:4pt"><b>Also note:</b> scan time per room, which device, any change of ceiling height, and anything
  it got visibly wrong &mdash; a double door read as one, a closet swallowed, a wall split in two.</p>
</section>

<footer>{FOOT3}</footer>

<div class="pb"></div>
{mast("Field card &mdash; page 5<br>What happens to the scan")}

<section>
  <h2><span class="n">09</span>Open the scan and check it</h2>
  <p>Take the <b>room.json</b> out of the export and drop it on the Trueline page in any browser,
  on the phone you scanned with. Nothing is uploaded &mdash; the file is read on the device and
  stays there. You get the plan, the floor area, and every dimension marked with where it came from.</p>
  <figure>{PLANKEY}</figure>
</section>

<section>
  <h2><span class="n">10</span>What the scanner never tells you</h2>
  <table>
    <tr><td class="k">Wall thickness</td><td>Not in the file at all. Every thickness on the drawing is one the app chose &mdash; check it against a door jamb.</td></tr>
    <tr><td class="k">Window sill height</td><td>Never stated. It is worked out from the window's centre, so it is worth a tape.</td></tr>
    <tr><td class="k">Door &amp; window sizes</td><td>Out by more than a foot in both directions on two real scans &mdash; a 6&#8242;8&#8243; door read as 6&#8242;10&#8243; and as 5&#8242;7&#8243;. Never order against one.</td></tr>
    <tr><td class="k">Which walls are yours</td><td>A scan can pick up a wall of the room next door through a doorway. The app drops it and says so &mdash; read that line.</td></tr>
    <tr><td class="k">Where there is no wall</td><td>A garage door or a wide opening comes in as a gap, not a wall. If it really is a wall, say so on the screen before anything gets priced.</td></tr>
  </table>
</section>

<section>
  <h2><span class="n">11</span>Type the tape numbers in</h2>
  <p>Tap a wall, type what your tape says &mdash; <span class="k">12' 3 1/2"</span>, or just
  <span class="k">12.5</span> for feet &mdash; and the whole room re-solves around it. The other
  walls give ground in proportion to how unsure the sensor was about each of them, and the one you
  measured never moves again.</p>
  <p><b>Watch for this:</b> if it says a wall had to move <em>further than the scanner's own
  tolerance</em>, that wall is the next one to tape. It is the room telling you where it is wrong.</p>
  <div class="warn"><span class="lbl">It is saved, but it is not backed up</span>
  Your corrections survive closing the tab, on that browser and that device only. Clearing site data
  clears them. Until accounts exist, finish a room in one visit.</div>
</section>

<footer>Nothing on the drawing is a measurement until somebody has stood behind it. That is the
whole point of the tape log on the previous page &mdash; and of the amber lines on this one.</footer>

</body></html>'''

def pages(doc, path='try'):
    open(f'{path}.html','w').write(doc)
    subprocess.run([CH,'--headless','--no-sandbox','--disable-gpu','--no-pdf-header-footer',
        '--virtual-time-budget=6000',f'--print-to-pdf={path}.pdf', f'file://{os.getcwd()}/{path}.html'],
        capture_output=True)
    return len(pdfium.PdfDocument(f'{path}.pdf'))

# Five sheets: scan, walk, open plans, tape log, and what to do with it afterwards.
# The ladder shortens the tape log rather than shrinking the type, because the
# card is read at arm's length on a job site.
TARGET_PAGES = 5

if __name__ == '__main__':
    ladder = [(9.2,1.34,r) for r in (24,22,20,18,16,14,12,10)]
    for pt,lead,rows in ladder:
        doc = html(pt,lead).replace('@@ROWS@@', ROW*rows)
        n = pages(doc)
        print(f"body {pt}pt / lead {lead} / {rows} rows -> {n} pages")
        if n == TARGET_PAGES:
            open('guide.html','w').write(doc)
            print(f"=> LOCKED IN at {pt}pt, {rows} log rows")
            sys.exit(0)
    print(f"!! could not reach {TARGET_PAGES} pages")
    sys.exit(1)
