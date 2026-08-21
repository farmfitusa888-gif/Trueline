# web

The Trueline web shell. Today it is one screen: **correct an imported scan.**

```bash
npm install          # from the repository root
npm run dev          # http://localhost:5173
```

Drop a `room.json` from a RoomPlan export onto the page. Nothing is uploaded and
there is no server — the file is read in the browser and stays there.

## Why this screen first

A scan closes perfectly whether it is right or wrong. So the moment that decides
whether any of this is worth anything is the one where a person looks at what the
scanner produced, disagrees with a number, and types the real one. Everything
else — projects, accounts, exports — is scaffolding around that moment.

The importer already named every decision it made: which edges had no wall, which
wall belonged to the room next door, how much each edge was straightened. Until
this screen existed those notes went nowhere. A note that says *"if that is really
a wall, change it here"* is a confession with no remedy unless "here" exists.

## What it does

- Draws the plan, with **every dimension marked scanned or measured**. Amber is
  the scanner's number; ink is one somebody stood behind. Dashed is an edge with
  no wall across it. Red hatching is a wall something was standing against.
- **Type a real measurement on any wall.** The room re-solves around it, the
  other walls move in proportion to how unsure the sensor was, and it says how
  many moved further than the scanner's own tolerance.
- **Fix the import's guesses**: an open span becomes a wall or a cased opening.
- **Says what is blocking the drawing** and which wall to measure first, ranked
  by area at stake and by how much of it the scanner could actually see.
- Undo, which is exact: every edit keeps the room it started from.

## How it is put together

- `state.ts` is the only file that touches `core`. No component computes a
  length, a heading or an area — they render what the model says. A number
  recomputed in a component is a number that will disagree with the export.
- `core` is imported straight from source, not through a build step. One copy of
  the measurement code, and the browser runs the same files the tests do.
- Every touch target is at least 44 px and no input is under 16 px, because iOS
  zooms the page if it is. This gets used on a phone in a half-built kitchen.
