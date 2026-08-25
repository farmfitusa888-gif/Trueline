#!/usr/bin/env python3
"""Prints the handbook to PDF, from the same HTML the web version uses.

There is one source for the handbook and it is `docs/handbook.html`. This does
not restate any of it -- restating it is how a guide and its printout drift
apart until one of them is wrong. It swaps two things and prints:

  * the webfont link for fonts this machine has, because the print box has no
    network and a missing font silently changes every line break;
  * a print stylesheet on top of the one already in the file, for the things
    that only matter on paper.

The search box and the animated phone are already hidden by the handbook's own
`@media print` rules, which is correct: a printed page cannot search and cannot
animate, and the printed contents list below replaces the one thing lost.

    python3 docs/build/build_handbook.py

Writes docs/handbook.pdf.
"""
import os
import re
import subprocess
import sys

import pypdfium2 as pdfium

CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(HERE, 'handbook.html')
OUT = os.path.join(HERE, 'handbook.pdf')

# What the screen version asks for -> what this machine actually has. Archivo is
# a grotesque and Liberation Sans is the closest thing installed; Source Serif is
# a transitional serif and Charter is its nearest neighbour.
SWAPS = [
    (r'Archivo,\s*"Helvetica Neue",\s*Arial,\s*sans-serif', '"Liberation Sans", Arial, sans-serif'),
    (r'Archivo,\s*sans-serif', '"Liberation Sans", Arial, sans-serif'),
    (r'"Source Serif 4",\s*Georgia,\s*serif', '"Bitstream Charter", "DejaVu Serif", Georgia, serif'),
    (r'"IBM Plex Mono",\s*monospace', '"DejaVu Sans Mono", monospace'),
]

PAPER = '''
<style>
  @page { size: letter; margin: 14mm 13mm 12mm; }
  /* The screen file themes itself from the reader's system. Paper is paper. */
  :root {
    --ground:#FFFFFF; --sheet:#FFFFFF; --ink:#14181B; --ink-2:#3E484D; --ink-3:#5B656B;
    --rule:#B9C1C6; --rule-soft:#D8DEE1; --amber:#B8590A; --amber-wash:#FBF3EA;
    --built:#1B6340; --built-wash:#EDF5F0; --violet:#6D28D9; --sky:#0369A1;
    --shadow:none;
  }
  body { -webkit-print-color-adjust:exact; print-color-adjust:exact;
         background:#fff; padding:0; font-size:9.4pt; line-height:1.4; }
  .wrap { max-width:none; }
  /* The cards rise into place on screen. On paper the fill mode would leave
     them at the first frame -- transparent -- so nothing animates here. */
  *, *::before, *::after { animation:none !important; transition:none !important;
                           opacity:1 !important; transform:none !important; }

  /* Two things about paper that the screen layout does not have to solve.
     One: CSS grid does not fragment across printed pages in this browser --
     items straddling a page break are dropped rather than moved on, and the
     first build of this PDF printed eleven headings and not one card.
     Two: a separate two-column box per group leaves the spare card on a
     sheet of its own, because a multi-column box that continues onto the
     next page takes the whole page with it.
     So the whole handbook is one column set, and cards flow through it. */
  /* Without column-fill:auto the browser balances every page to the shortest
     column, and each sheet gets used down to about half its height. */
  #out { columns:2; column-gap:12pt; column-fill:auto; }
  .cards { display:block !important; columns:auto !important; }
  .card { display:block !important; break-inside:avoid; page-break-inside:avoid;
          border:0.7pt solid #B9C1C6; border-radius:3pt; padding:8pt 10pt;
          margin:0 0 8pt; }

  header.mast { padding:0 0 10pt; }
  h1 { font-size:30pt; }
  .standfirst { font-size:11pt; }
  /* The screen file starts each group on its own page. On paper that left
     half of them with one card and eight inches of nothing, because a
     two-column group of three cards spills the third onto a fresh sheet.
     Groups run on instead, with a rule and a heading to find them by. */
  .group { break-before:auto; padding-top:0; }
  .group > h2 { font-size:15pt; margin-bottom:2pt;
                break-after:avoid; page-break-after:avoid;
                border-top:1.4pt solid #14181B; padding-top:8pt; }
  .group:first-of-type > h2 { border-top:none; padding-top:0; }
  /* The heading keeps its one-line why with it, and no more. Asking for the
     first card as well means a tall card and half a column left over move the
     whole group to the next page, and the page before it is half blank. */
  .group > .why { font-size:9.6pt; margin-bottom:9pt; }
  .card h3 { font-size:10.6pt; }
  .card .where { font-size:7.2pt; }
  .card ol, .card ul { margin:4pt 0 0; }
  .card li { margin-bottom:2.5pt; }

  /* A printed page cannot be searched, so it gets a contents list instead. */
  #contents { break-after:page; }
  #contents h2 { margin:14pt 0 6pt; }
  #contents .g { break-inside:avoid; margin:0 0 5pt; }
</style>
'''


def paper_html() -> str:
    doc = open(SOURCE, encoding='utf-8').read()
    doc = re.sub(r'<link rel="preconnect"[^>]*>\s*', '', doc)
    doc = re.sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>\s*', '', doc)
    # On paper there is no search box, so the invitation to use one would be a
    # lie. Same document, one sentence that knows which medium it is on.
    doc = doc.replace('Search below, or read it straight through.',
                      'The contents list overleaf is the fastest way in.')
    for pattern, replacement in SWAPS:
        doc = re.sub(pattern, replacement, doc)
    # Appended, so it wins over everything the file already declared.
    doc = doc.replace('</style>', '</style>' + PAPER, 1) if '</style>' in doc else doc + PAPER
    # The renderer runs on load and fills #out; printing needs the contents list
    # built from the same data rather than written out again here.
    doc = doc.replace('render(\'\');', "render('');\n" + CONTENTS)
    return doc


CONTENTS = r'''
// Paper cannot search, so it gets a contents list built from the same data.
(function () {
  const list = document.createElement('section');
  list.id = 'contents';
  const sans = "'Liberation Sans',Arial,sans-serif";
  list.innerHTML = '<h2 style="font-family:' + sans + ';font-weight:600;font-size:15pt">'
    + 'What is in here</h2>'
    + GUIDE.map(function (g) {
        return '<div class="g">'
          + '<div style="font-family:' + sans + ';font-weight:600;font-size:10pt;'
          + 'border-bottom:0.7pt solid #B9C1C6;padding-bottom:1.5pt;margin-bottom:2pt">'
          + g.group + '</div>'
          + '<div style="font-size:8.6pt;line-height:1.34;color:#3E484D;columns:3;'
          + 'column-gap:14pt">'
          + g.cards.map(function (c) { return '<div>' + c.t + '</div>'; }).join('')
          + '</div></div>';
      }).join('');
  out.parentNode.insertBefore(list, out);
})();
'''


def main() -> int:
    if not os.path.exists(CHROME):
        print(f'No browser at {CHROME}', file=sys.stderr)
        return 2

    work = os.path.join(HERE, 'build', '.handbook-print.html')
    open(work, 'w', encoding='utf-8').write(paper_html())

    subprocess.run(
        [CHROME, '--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer',
         '--virtual-time-budget=12000', f'--print-to-pdf={OUT}', f'file://{work}'],
        capture_output=True, check=False)

    if not os.path.exists(OUT):
        print('The browser produced no PDF.', file=sys.stderr)
        return 1
    pages = len(pdfium.PdfDocument(OUT))
    size = os.path.getsize(OUT)
    print(f'docs/handbook.pdf — {pages} pages, {size // 1024} KB')
    # A one-page PDF means the renderer never ran and only the masthead printed.
    if pages < 6:
        print('That is too short: the cards did not render.', file=sys.stderr)
        return 1
    os.remove(work)
    return 0


if __name__ == '__main__':
    sys.exit(main())
