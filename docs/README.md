# docs

| File | What it is |
|---|---|
| `scanning-field-card.pdf` | Two-page field card for scanning a room. Print it, take it on site, fill in the tape log. |
| `scanning-field-card.html` | The source the PDF is built from. Edit this, never the PDF. |
| `market-research.html` | What the field already does, and where the gap is. |

## Rebuilding the field card

```bash
chromium --headless --no-pdf-header-footer \
  --print-to-pdf=docs/scanning-field-card.pdf docs/scanning-field-card.html
```

It must come out at **exactly two US Letter pages**. If it grows to three, content was
added — trim it rather than letting it spill, because a field card that runs onto a
near-empty third page stops getting printed.
