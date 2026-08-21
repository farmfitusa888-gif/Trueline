# The mark

Two lines, which is the whole product. Across the top a **dimension line** with
its end ticks — a true length, the thing a tape gives you and a scanner only
estimates. Down the middle a **plumb line** with the bob on the end — true
vertical, the oldest measuring instrument there is and the only one that cannot
drift. Together they read as a T.

Colours are the ones the rest of the product already uses: ink `#14181B`, and
the amber `#B8590A` that means *measured* on the plan, on the field card, and in
the app.

| File | Where it is used |
|---|---|
| `trueline-mark.svg` | The app icon: white on ink, full bleed, no rounded corners — iOS supplies the mask. |
| `trueline-mark-light.svg` | The same mark in ink on nothing, for light ground. |
| `trueline-wordmark.svg` | The horizontal lockup, mark then name, `line` in amber. |
| `trueline-icon-*.png` | Rasterised from the mark. 1024 is the App Store size. |
| `trueline-wordmark.png` | The lockup at 2×, for anywhere that will not take an SVG. |

**Do not hand-edit the PNGs.** They are rendered from the SVGs; change the SVG
and rasterise again.

The icon actually shipped by the app is
`ios/Trueline/Assets.xcassets/AppIcon.appiconset/icon-1024.png` — a copy of
`trueline-icon-1024.png` with no alpha channel, which is what the App Store
requires. The favicon is `web/public/icon.svg`, redrawn with heavier strokes
because the original's end ticks disappear at 16 px.
