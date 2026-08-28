import { useId, useState } from 'react';

/**
 * A block that folds back up, and says what is in it while it is shut.
 *
 * > "WHEN YOU DROPDOWN ANY MENU, HAVE A WAY TO COLLAPSE THEM BACK"
 * >                                                          — Sam
 *
 * ## The bug
 *
 * Tapping a control in this app opens a block of fields. Rename a wall, move
 * it, cut it in two, notch a corner, the openings in it, what a store charges,
 * an item invented for the rate book, the claim's own paperwork. Several of
 * them opened and then simply stayed open: the panel had grown by a screen and
 * a half, and the only ways out were to change something you did not want to
 * change or to scroll past it for the rest of the job. On a phone held in one
 * hand, a block that will not fold is dead weight in front of the next thing
 * somebody needs.
 *
 * The mark row in `Damage.tsx` had already been fixed once, for the same
 * reason and in Sam's same words, and it is what this is copied from: the same
 * row toggles, it carries `aria-expanded`, the word changes between **Open**
 * and **Close**, a chevron turns over, and the shut row says what is behind it
 * — `3 photographs` / `No photograph yet — open it to take one`. One correct
 * disclosure in one file is a fix; eight files each inventing their own is the
 * next bug. So it lives here once.
 *
 * ## Four decisions in it that could have gone the other way
 *
 * **The word is not part of the accessible name.** The chevron and the word are
 * `aria-hidden`, and the state a screen reader is told is `aria-expanded`. That
 * is the correct ARIA and it is also the safe one: several parts of the audit
 * find the mark row by asking for a button whose name ENDS in "Open", and a
 * header two inches higher up the same screen that also ended in "Open" would
 * quietly steal every one of those clicks. The word is for eyes; `aria-expanded`
 * is for everybody else; the name stays the title and its summary.
 *
 * **The children stay mounted and are hidden.** Not `{open && children}`.
 * Half a typed shelf-tag lives in the state of a component INSIDE the block —
 * a store picked, a price half typed, a photograph already taken and waiting on
 * a number — and unmounting on a fold would throw it away. Somebody who shuts a
 * block to see what is under it and opens it again has not asked to start over.
 * `hidden` takes it out of the layout, out of `innerText` and out of the
 * accessibility tree, which is everything except the memory.
 *
 * **The heading stays a heading.** Where the block already had an `<h3>` on it,
 * the heading element wraps the button rather than being replaced by it —
 * `<h3><button aria-expanded>…</button></h3>`, which is how the ARIA disclosure
 * pattern is written and the only shape that keeps both. Several parts of the
 * audit reach a whole section by asking for its heading, and turning eight
 * headings into plain buttons would have taken those parts' only handle on the
 * screen away.
 *
 * **`open` is what most callers pass.** A block that is on the screen today
 * stays on the screen and gains a way to fold; a block starts shut only where
 * nothing was ever showing. Sam asked for a way back, not for everything he
 * can see to disappear the next time he opens the app.
 *
 * The header is a real `<button>` at least 48 px tall — `min-h-12`, one size up
 * from the 44 px the rest of this app settled on, because this is the control
 * somebody hits repeatedly while looking for something else. Opening a block
 * never moves the header: the panel is drawn after it, so what grows is always
 * below the thing that was pressed. `web/audit/a39-collapse.mjs` proves that at
 * 430 by 800, which is a phone, and it is the only thing that can — no static
 * check can see where a thumb is.
 */
export function Disclosure({
  title,
  summary,
  heading: Heading,
  open: startOpen = true,
  children,
}: {
  /** What this block is, in the words the screen already used for it. */
  readonly title: string;
  /**
   * What is inside, for somebody who has not opened it.
   *
   * Shown only while it is shut, and it is the whole point of the pattern: a
   * row that says "Open" and nothing else asks somebody to open eight of them
   * to find the one they wanted. Say the number, the current value, or what is
   * missing — `No photograph yet` is worth more than `Photographs`.
   */
  readonly summary?: string;
  /**
   * The heading this block already had, if it had one — `h2`, `h3`, `h4`.
   *
   * It wraps the button, so the outline of the page is unchanged and every
   * `getByRole('heading', …)` in the audit still lands on it.
   */
  readonly heading?: 'h2' | 'h3' | 'h4';
  /** Whether it starts open. True unless nothing was ever showing here. */
  readonly open?: boolean;
  readonly children: React.ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  // `useId` rather than the title: two walls can each have a "Call it
  // something", and `aria-controls` pointing at two elements with one id is a
  // pointer at neither.
  const panel = useId();

  const header = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      aria-controls={panel}
      className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-700">{title}</span>
        {!open && summary && (
          <span className="mt-0.5 block text-xs leading-snug text-slate-500">{summary}</span>
        )}
      </span>
      <span
        aria-hidden="true"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300
                   px-2 py-1 text-xs font-medium text-slate-700"
      >
        {open ? 'Close' : 'Open'}
        <svg viewBox="0 0 16 16" className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor"
                strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );

  return (
    <div className="mt-3">
      {Heading ? <Heading>{header}</Heading> : header}

      {/* Both, and on purpose. The attribute is what takes it out of the
          accessibility tree; the class is what makes sure a stylesheet that
          sets a display on this element cannot put it back on the screen. */}
      <div id={panel} hidden={!open} className={open ? undefined : 'hidden'}>
        {children}
      </div>
    </div>
  );
}
