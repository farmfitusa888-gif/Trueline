/**
 * The named parts of a room, and the bar that moves between them.
 *
 * Everything used to be one page. The drawing, the 3D view, wall editing,
 * openings, ceiling height, wall thickness, the takeoff, the claim, the scope,
 * the quote, the client file, the field sheet and the punch list were stacked
 * on top of each other in one column, and on a phone that put *"Is this an
 * insurance job?"* about ten screens below the fold. The report was "I couldn't
 * even use the insurance mode, no way to get there or try it, probably the same
 * for other features" -- and it was: the work was finished and unreachable,
 * which is indistinguishable from the work not existing.
 *
 * Nothing is hidden that was not already off the bottom of the screen. The
 * panels stay in the document either way -- printing a drawing walks the DOM,
 * so a section that unmounts is a sheet that loses half of itself.
 */
import type { ReactNode } from 'react';

export type SectionKey = 'plan' | 'room' | 'takeoff' | 'price' | 'claim' | 'files';

interface Section {
  readonly key: SectionKey;
  readonly title: string;
  /** What a contractor would call it, for the empty state and the heading. */
  readonly what: string;
}

export const SECTIONS: readonly Section[] = [
  { key: 'plan', title: 'Plan', what: 'the drawing, and everything you change on it' },
  { key: 'room', title: 'Room', what: 'ceiling, wall thickness, and what still needs checking' },
  { key: 'takeoff', title: 'Takeoff', what: 'how much of everything is in this room' },
  { key: 'price', title: 'Price', what: 'what it comes to, and where the job stands' },
  { key: 'claim', title: 'Insurance', what: 'the claim, the damage, and the adjuster’s paperwork' },
  { key: 'files', title: 'Files', what: 'the client file, the field sheet, and what leaves this phone' },
];

/**
 * How many things in a section want attention, drawn on its tab.
 *
 * A count on a tab is the only way an unopened section can ask to be opened.
 * Nothing here is a warning about the app -- every one of these is a thing
 * somebody has to do before a number can be trusted.
 */
export type SectionFlags = Partial<Record<SectionKey, number>>;

export function SectionBar({
  active,
  flags,
  onPick,
}: {
  readonly active: SectionKey;
  readonly flags: SectionFlags;
  readonly onPick: (key: SectionKey) => void;
}) {
  return (
    <nav
      aria-label="Parts of this room"
      data-sheet="no"
      // Scrolls sideways rather than wrapping to two rows: a bar that changes
      // height when a badge appears moves everything under it.
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1
                 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {SECTIONS.map((section) => {
        const on = section.key === active;
        const count = flags[section.key] ?? 0;
        return (
          <button
            key={section.key}
            type="button"
            onClick={() => onPick(section.key)}
            aria-current={on ? 'page' : undefined}
            className={[
              'relative min-h-11 shrink-0 rounded-lg px-4 text-sm font-semibold',
              'transition-colors',
              on
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 active:bg-slate-200',
            ].join(' ')}
          >
            {section.title}
            {count > 0 && (
              <span
                className={[
                  'ml-2 inline-flex min-w-5 items-center justify-center rounded-full',
                  'px-1.5 text-xs font-bold tabular-nums',
                  on ? 'bg-white/25 text-white' : 'bg-amber-500 text-white',
                ].join(' ')}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * One section's contents.
 *
 * `hidden` rather than not rendering it, so the print walk and anything else
 * that reads the document still finds every card.
 */
export function Panel({
  section,
  active,
  children,
}: {
  readonly section: SectionKey;
  readonly active: SectionKey;
  readonly children: ReactNode;
}) {
  const on = section === active;
  return (
    <div
      data-panel={section}
      hidden={!on}
      aria-hidden={!on}
      className="space-y-5"
    >
      {children}
    </div>
  );
}
