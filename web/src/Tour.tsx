import { useEffect, useRef, useState } from 'react';
import type { SectionKey } from './Sections.tsx';

/**
 * A guided tour of every feature, over a job that already has work in it.
 *
 * ## Why a tour, and why over the demo
 *
 * This app has a lot in it, and almost none of it is visible until there is a
 * room on the screen. Somebody opening it for the first time sees an empty list
 * and an instruction, which is a poor way to find out whether the takeoff is
 * any good — and a poorer way to discover that there is a change-order screen
 * at all.
 *
 * So the tour runs on top of the worked example: a kitchen that was scanned,
 * taped on two walls, priced, written up, signed and invoiced. Every stop has
 * something real to point at, because every number on every screen came out of
 * that job.
 *
 * ## What it will not do
 *
 * Change anything. The tour moves you between sections and views and says what
 * you are looking at. It never taps a control on your behalf, because a tour
 * that edits your work is a tour nobody trusts enough to start.
 */

export interface Stop {
  /** Which part of the room this stop is about. */
  readonly section: SectionKey;
  /** Blueprint or 3D, where it matters. */
  readonly look?: 'plan' | 'room';
  readonly title: string;
  readonly body: string;
  /**
   * What to put a ring around, as a CSS selector.
   *
   * Optional: several stops are about a whole panel rather than one control,
   * and a ring drawn round nothing is worse than no ring.
   */
  readonly find?: string;
}

/**
 * Every feature in the app, in the order somebody meets them.
 *
 * The order is the order of a job — the room, the numbers, the money, the
 * paperwork — not the order of the tab bar, because the tab bar is alphabetical
 * by accident of layout and a job is not.
 */
export const TOUR: readonly Stop[] = [
  { section: 'plan', look: 'plan',
    title: 'The drawing',
    body: 'Every wall with its length, the door and the window drawn as openings, real dimension '
        + 'lines and north. The line underneath says whether anybody has put a tape on it — this '
        + 'one has, on two walls, so it reads Measured.',
    find: '[data-sheet="yes"]' },
  { section: 'plan', look: 'plan',
    title: 'Tap a wall',
    body: 'Any wall, on the drawing or in 3D. It opens the box for a tape reading, the openings '
        + 'on that wall, and what is behind it. A wall you have measured turns from amber to '
        + 'black, and every quantity that depends on it moves.',
    find: 'svg[aria-label^="Plan of"]' },
  { section: 'plan', look: 'room',
    title: 'The same room in 3D',
    body: 'Drag to walk around it. Pinch or scroll to zoom. Tap a wall in here and it selects '
        + 'the same wall as on the drawing — one model, two ways of looking at it, and the '
        + 'furniture toggle proves the furniture moves no number.',
    find: 'svg[aria-label*="dimensions"], svg[aria-label*="Standing in"]' },
  { section: 'plan', look: 'room',
    title: 'Stand inside it',
    body: 'Perspective, from eye height, with the ceiling on. Every wall carries its name and '
        + 'its length, every opening its size. This is the view for showing a client what you '
        + 'are quoting on.',
    find: '[data-panel="plan"] button' },
  { section: 'room',
    title: 'The ceiling height',
    body: 'The one dimension every wall area is multiplied by. A scan takes it from the tallest '
        + 'wall it saw and says how sure it is; type a real one and it becomes measured.',
    find: '[data-panel="room"] section' },
  { section: 'room',
    title: 'Wall thickness, for framing',
    body: 'A scan cannot see inside a wall, so this is the one number that has to be said rather '
        + 'than measured. Pick a build-up — 2x4, 2x6, block — and plates, studs and headers '
        + 'appear on the takeoff.',
    find: '[data-panel="room"] section:nth-of-type(2)' },
  { section: 'room',
    title: 'What still needs doing',
    body: 'The room lists what is unchecked and ranks it: the longest wall first, because an '
        + 'error there costs the most floor area. The number on the Room tab is this list.',
    find: '[data-panel="room"]' },
  { section: 'takeoff',
    title: 'The takeoff',
    body: 'Floor, ceiling, wall face, baseboard, framing, and every door and window counted — '
        + 'each with its own workings so a number can be checked rather than trusted. Send it, '
        + 'copy it, or open it in a spreadsheet.',
    find: '[data-panel="takeoff"] section' },
  { section: 'price',
    title: 'What it comes to',
    body: 'Every line is a rate you set times a quantity the room measured. Nothing here comes '
        + 'from market data, and an item with no rate against it is named rather than priced at '
        + 'zero — a quote that adds up perfectly and is short by a floor is the worst thing this '
        + 'could produce.',
    find: '[data-panel="price"] section' },
  { section: 'price',
    title: 'Your rates',
    body: 'The same book as the Business tab, reachable from here so you can change a number '
        + 'without losing your place. Mark jobs won and it will suggest rates from your own '
        + 'history — the middle one, so a single emergency job does not move your book.',
    find: '[data-panel="price"] button' },
  { section: 'price',
    title: 'Price a different number',
    body: 'Override any quantity, with a reason. The override travels onto the proposal and the '
        + 'takeoff shows both figures, so nobody has to wonder later why a line does not match '
        + 'the room.',
    find: '[data-panel="price"] section' },
  { section: 'agree',
    title: 'The proposal',
    body: 'The quantities and the rates are already here, so nothing is retyped and the two '
        + 'documents cannot disagree. It names what is still missing rather than looking '
        + 'finished, and it carries the scanned caveat onto the client’s paper.',
    find: '[data-panel="agree"] section' },
  { section: 'agree',
    title: 'Signed, with a record worth having',
    body: 'Who signed, when, on what, the exact words they agreed to, that they consented to '
        + 'sign electronically, and a fingerprint of the document. That record is what decides a '
        + 'dispute — not the picture of a name.',
    find: '[data-panel="agree"]' },
  { section: 'agree',
    title: 'And what changed since',
    body: 'The signed scope is never edited. Anything different becomes a change order against '
        + 'it, so at any point you can show what was agreed, what changed, and who signed for '
        + 'each.',
    find: '[data-panel="agree"]' },
  { section: 'work',
    title: 'When it happens',
    body: 'Days go into your own calendar — no service, no monthly fee, and a client’s calendar '
        + 'reads the file whatever they use.',
    find: '[data-panel="work"] section' },
  { section: 'work',
    title: 'Asking to be paid',
    body: 'Invoices are built from what somebody signed, never from what the room measures '
        + 'today. A bill for work nobody agreed to is not a mistake, it is a dispute. There is a '
        + 'QuickBooks export here too.',
    find: '[data-panel="work"]' },
  { section: 'claim',
    title: 'Insurance mode',
    body: 'Off unless you turn it on. Mark damage while standing in front of it and the room '
        + 'works out the square feet of board and the feet of base, because it already knows how '
        + 'long the wall is.',
    find: '[data-panel="claim"] section' },
  { section: 'claim',
    title: 'Photographs and readings',
    body: 'Every photograph attaches to the damage it belongs to rather than to an email. '
        + 'Moisture readings keep their scale, and the app refuses to draw a curve across a '
        + 'change of scale — it lists them and says why.',
    find: '[data-panel="claim"]' },
  { section: 'claim',
    title: 'Mark more, without rescanning',
    body: 'Damage turns up on the second visit. This opens the camera again for marks only — the '
        + 'walls and every measurement stay exactly as they are.',
    find: '[data-panel="claim"]' },
  { section: 'files',
    title: 'Everything that leaves',
    body: 'The drawing, the client file, CAD, the field sheet, the claim PDF, ESX for Xactimate, '
        + 'and the whole job in one archive. A client opens what you send without an account.',
    find: '[data-panel="files"]' },
];

export function Tour({
  onGo,
  onDone,
}: {
  readonly onGo: (stop: Stop) => void;
  readonly onDone: () => void;
}) {
  const [at, setAt] = useState(0);
  /**
   * Folded down to one line.
   *
   * The card is fixed to the bottom of the window, and on a phone a card with
   * a title, three lines of text and three buttons in it is a third of the
   * screen -- so the thing it is pointing at is behind the thing pointing at
   * it. Folded, it is one bar: the stop, the title, and the two controls that
   * move you. Everything is still reachable and the room is on the screen.
   */
  const [folded, setFolded] = useState(false);
  const card = useRef<HTMLElement | null>(null);
  const stop = TOUR[at]!;

  // `onGo` is written inline by the caller, so it is a new function on every
  // render. Depended on directly it would re-run the effect below on every
  // render -- and the effect calls `onGo`, which sets state, which renders.
  // A ref is read at the moment of use and never changes identity, so the
  // effect runs when the STOP changes and at no other time.
  const go = useRef(onGo);
  go.current = onGo;

  // Move the app to where this stop is about, then put a ring round the thing.
  useEffect(() => {
    go.current(stop);
    const timer = window.setTimeout(() => {
      for (const old of document.querySelectorAll('[data-tour-ring]')) {
        old.removeAttribute('data-tour-ring');
      }
      if (!stop.find) return;
      const target = document.querySelector(stop.find);
      if (!target) return;
      target.setAttribute('data-tour-ring', '');

      // Centred in what is LEFT of the screen, not in the screen.
      //
      // `scrollIntoView({ block: 'center' })` centres in the viewport, and the
      // bottom of this viewport is the card and the section bar. So a stop
      // about a control near the foot of a panel scrolled it to the middle of
      // the window and the card sat on top of it -- which is exactly the
      // complaint: "the banner box on the bottom is blocking everything".
      //
      // So the free area is measured -- from under the section tabs to the top
      // of the card -- and the target is put in the middle of THAT.
      const free = window.innerHeight - (card.current?.getBoundingClientRect().height ?? 0);
      const box = target.getBoundingClientRect();
      const want = box.top + window.scrollY - Math.max(16, (free - box.height) / 2);
      window.scrollTo({ top: Math.max(0, want), behavior: 'smooth' });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [at, stop]);

  // And take the ring off on the way out, whichever way somebody leaves.
  useEffect(() => () => {
    for (const old of document.querySelectorAll('[data-tour-ring]')) {
      old.removeAttribute('data-tour-ring');
    }
  }, []);

  const last = at === TOUR.length - 1;

  return (
    <aside
      ref={card}
      role="dialog"
      aria-label="Guided tour"
      className="fixed inset-x-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-40
                 mx-auto max-w-3xl px-3"
    >
      <div className="rounded-xl border border-slate-900 bg-slate-900 p-3 text-white shadow-lg">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] uppercase tracking-widest text-slate-400">
              Tour · {at + 1} of {TOUR.length}
            </p>
            <h2 className="mt-0.5 font-semibold">{stop.title}</h2>
          </div>
          {/* Out of the way, and back again. The one control that decides
              whether this card is help or an obstruction. */}
          <button
            type="button"
            onClick={() => setFolded(!folded)}
            aria-expanded={!folded}
            className="-m-1 min-h-11 shrink-0 rounded-md px-3 font-mono text-xs uppercase
                       tracking-widest text-slate-300 active:bg-slate-800"
          >
            {folded ? 'Show' : 'Hide'}
          </button>
        </div>
        {!folded && (
          <p className="mt-1.5 text-sm leading-relaxed text-slate-200">{stop.body}</p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (last ? onDone() : setAt(at + 1))}
            className="min-h-11 flex-1 rounded-md bg-white px-4 font-semibold text-slate-900
                       active:bg-slate-200"
          >
            {last ? 'Finish' : 'Next'}
          </button>
          <button
            type="button"
            disabled={at === 0}
            onClick={() => setAt(at - 1)}
            className="min-h-11 rounded-md border border-slate-600 px-4 font-medium text-slate-200
                       active:bg-slate-800 disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onDone}
            className="min-h-11 px-3 text-sm text-slate-400 underline underline-offset-4"
          >
            Stop the tour
          </button>
        </div>
      </div>
    </aside>
  );
}
