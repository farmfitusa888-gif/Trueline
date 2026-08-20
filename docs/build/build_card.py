import re, subprocess, os, sys
import pypdfium2 as pdfium
from diagrams import STAND, HOLD, WALK, FURNITURE

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

{mast("Field card &mdash; how to scan a room<br>Rev 2 &middot; iPhone / iPad LiDAR")}

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
{mast("Field card &mdash; page 2<br>The walk, furniture &amp; fixes")}

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

<section>
  <h2><span class="n">06</span>When it goes wrong</h2>
  <table>
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
{mast("Field card &mdash; page 3<br>Tape log &mdash; print and write on this")}

<section>
  <h2><span class="n">07</span>The tape log &mdash; the most valuable thing you do</h2>
  <p>A scan on its own has no ground truth. Tape three or four <b>clear</b> walls per room and write the
  numbers here. <b>Measure one wall twice</b>, at the start and end of the scan &mdash; if the two differ,
  that is drift, a different problem from sensor error.</p>
  <table>
    <thead><tr><th style="width:20%">Room</th><th style="width:22%">Which wall</th><th style="width:19%">Tape says</th><th style="width:19%">Scan says</th><th>Notes &mdash; &ldquo;B&rdquo; if blocked</th></tr></thead>
    <tbody>
@@ROWS@@    </tbody>
  </table>
  <p style="margin-top:4pt"><b>Also note:</b> scan time per room, which device, and anything it got visibly
  wrong &mdash; a double door read as one, a closet swallowed, a wall split in two.</p>
</section>

<footer>{FOOT3}</footer>

</body></html>'''

def pages(doc, path='try'):
    open(f'{path}.html','w').write(doc)
    subprocess.run([CH,'--headless','--no-sandbox','--disable-gpu','--no-pdf-header-footer',
        '--virtual-time-budget=6000',f'--print-to-pdf={path}.pdf', f'file://{os.getcwd()}/{path}.html'],
        capture_output=True)
    return len(pdfium.PdfDocument(f'{path}.pdf'))

if __name__ == '__main__':
    ladder = [(9.2,1.34,r) for r in (24,23,22,21,20,19,18,17,16,15,14)]
    for pt,lead,rows in ladder:
        doc = html(pt,lead).replace('@@ROWS@@', ROW*rows)
        n = pages(doc)
        print(f"body {pt}pt / lead {lead} / {rows} rows -> {n} pages")
        if n == 3:
            open('guide.html','w').write(doc)
            print(f"=> LOCKED IN at {pt}pt, {rows} log rows")
            sys.exit(0)
    print("!! could not reach 2 pages")
