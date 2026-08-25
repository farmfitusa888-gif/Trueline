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

export type SectionKey = 'plan' | 'room' | 'takeoff' | 'price' | 'agree' | 'claim' | 'files';

interface Section {
  readonly key: SectionKey;
  readonly title: string;
  /** What fits under an icon at a sixth of a phone's width. */
  readonly short: string;
  /** What a contractor would call it, for the empty state and the heading. */
  readonly what: string;
}

export const SECTIONS: readonly Section[] = [
  { key: 'plan', short: 'Plan', title: 'Plan', what: 'the drawing, and everything you change on it' },
  { key: 'room', short: 'Room', title: 'Room', what: 'ceiling, wall thickness, and what still needs checking' },
  { key: 'takeoff', short: 'Takeoff', title: 'Takeoff', what: 'how much of everything is in this room' },
  { key: 'price', short: 'Price', title: 'Price', what: 'what it comes to, and where the job stands' },
  { key: 'agree', short: 'Agree', title: 'Agreement', what: 'the proposal, the signature on it, and what has changed since' },
  { key: 'claim', short: 'Claim', title: 'Insurance', what: 'the claim, the damage, and the adjuster’s paperwork' },
  { key: 'files', short: 'Files', title: 'Files', what: 'the client file, the field sheet, and what leaves this phone' },
];

/**
 * How many things in a section want attention, drawn on its tab.
 *
 * A count on a tab is the only way an unopened section can ask to be opened.
 * Nothing here is a warning about the app -- every one of these is a thing
 * somebody has to do before a number can be trusted.
 */
export type SectionFlags = Partial<Record<SectionKey, number>>;

/**
 * A mark for each section, so the bar reads at a glance and fits six across a
 * phone. Stroked rather than filled, one weight, drawn on a 24 grid.
 */
function Glyph({ of }: { readonly of: SectionKey }) {
  const path = {
    // A rectangle with a dimension line under it: the drawing.
    plan: <><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M3 20h18M3 18.5v3M21 18.5v3" /></>,
    // A folding rule.
    room: <><path d="M3 14l6-6 6 6-6 6z" /><path d="M15 8l6-6" /><path d="M11 6l2 2M13 4l2 2" /></>,
    // A list of quantities.
    takeoff: <><path d="M4 6h16M4 12h16M4 18h10" /></>,
    // A price tag.
    price: <><path d="M3 12V4h8l9 9-8 8z" /><circle cx="7.5" cy="7.5" r="1.4" /></>,
    // A shield: the claim.
    claim: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
    // A pen over a line: the signature.
    agree: <><path d="M4 19h16" /><path d="M6 15.5L15.6 5.9a2 2 0 112.8 2.8L8.8 18.3l-3.6.8z" /></>,
    // A folder.
    files: <path d="M3 7a1 1 0 011-1h5l2 2h9a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1z" />,
  }[of];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
         strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
      {path}
    </svg>
  );
}

/**
 * The bar, along the bottom.
 *
 * At the bottom because that is where a thumb is. It used to be a strip under
 * the header, which on a phone is the one part of the screen a hand holding the
 * phone cannot reach, and which scrolls away the moment you look at anything.
 * Fixed, so every section is one thumb away from every other section at every
 * point in the app — including from the far end of a long list, which is where
 * somebody actually decides they want to be somewhere else.
 */
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95
                 backdrop-blur print:hidden
                 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-3xl">
        {SECTIONS.map((s) => {
          const on = s.key === active;
          const count = flags[s.key] ?? 0;
          return (
            <li key={s.key} className="flex-1">
              <button
                type="button"
                onClick={() => onPick(s.key)}
                aria-current={on ? 'page' : undefined}
                // The visible label is short enough to fit a sixth of a phone
                // ("Claim"); the accessible name is the one a person would say
                // out loud, and it is what a screen reader announces.
                aria-label={s.title}
                title={s.what}
                className={`relative flex min-h-14 w-full flex-col items-center justify-center
                            gap-0.5 px-0.5 ${on ? 'text-slate-900' : 'text-slate-400'}`}
              >
                <Glyph of={s.key} />
                <span className={`text-[10px] leading-none ${on ? 'font-bold' : 'font-medium'}`}>
                  {s.short}
                </span>
                {count > 0 && (
                  <span
                    aria-label={`${count} to do`}
                    className="absolute right-[18%] top-1.5 flex h-4 min-w-4 items-center
                               justify-center rounded-full bg-amber-500 px-1 text-[10px]
                               font-bold tabular-nums text-white"
                  >
                    {count}
                  </span>
                )}
                {on && (
                  <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-slate-900" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
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
