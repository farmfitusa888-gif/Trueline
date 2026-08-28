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
 * priced, written up, signed and invoiced. Every stop has something real to
 * point at, because every number on every screen came out of that job.
 *
 * ## The card competes with the thing it exists to explain
 *
 * This is the whole design problem, and the first two versions of this card
 * lost it. A heading, four lines of prose, Next, Back and "Stop the tour" is
 * around 230 pixels; on a 800-pixel phone, with the section bar under it, that
 * is better than a third of the screen permanently covered — and the drawing
 * being described is what is underneath. Twenty stops of that is a tour that
 * is easier to stop than to follow, which is what happened:
 *
 *     "NEED TO FIX THE TOUR, CANT SEE ANYTHING PROPERLY"
 *
 * So the card is built to a budget rather than to a paragraph, and `a21-tour`
 * measures it on a 430x800 screen and fails the build if it goes over:
 *
 *   - **The card is at most a fifth of the screen** with its body showing, and
 *     at most an eighth folded.
 *   - **What a stop rings fits in what is left, and all of it is on screen.**
 *     Not most of it, and never with the top cut off.
 *
 * Both numbers come out of what somebody actually needs at a stop, which is
 * four things: where they are in the tour, what they are looking at, one
 * sentence saying what to notice, and a way onward. Everything else this card
 * used to say is still here, behind `More` — one tap, for the person who wants
 * the reason rather than the label. Nothing was deleted to hit the budget.
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
  /**
   * One sentence: what to notice, on the screen this stop just moved to.
   *
   * Kept to two lines at phone width on purpose. A third line costs eighteen
   * pixels of the drawing at every one of the twenty stops, and the sentence
   * that would go in it is almost always the *reason* rather than the thing —
   * which is what `more` is for.
   */
  readonly body: string;
  /** The reason, the caveat, the second half. Behind `More`, and never needed. */
  readonly more?: string;
  /**
   * What to put a ring around, as a CSS selector.
   *
   * It has to be the smallest element that is actually the subject. Ringing a
   * whole panel — which four of these stops used to do — draws a line round
   * something 2,800 pixels tall on a phone: the top edge is off the top of the
   * screen, the bottom edge is off the bottom, and what somebody sees is a
   * vertical line down each side of the page pointing at everything at once.
   * `a21-tour` measures the height of whatever this matches and fails if it
   * cannot fit in the free part of the screen.
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
    body: 'Every wall with its length, the door and the window drawn as openings, and north.',
    more: 'The line underneath says whether anybody has put a tape on it. Nobody has, on this '
        + 'one, so it reads Scanned — and every number on every screen after this is the '
        + 'scanner’s guess until somebody does.',
    find: 'svg[aria-label^="Plan of"]' },
  { section: 'plan', look: 'plan',
    title: 'Tap a wall',
    body: 'Any wall, on the drawing or in 3D, opens the box for a tape reading and what is '
        + 'behind it.',
    more: 'A wall you have measured turns from amber to black, and every quantity that depends '
        + 'on it moves. The tour will not tap one for you — it changes nothing.',
    find: 'svg[aria-label^="Plan of"]' },
  { section: 'plan', look: 'room',
    title: 'The same room in 3D',
    body: 'Drag to walk around it, pinch to zoom. Tap a wall in here and it picks the same wall.',
    more: 'One model, two ways of looking at it — and the furniture toggle proves the furniture '
        + 'moves no number.',
    find: 'svg[aria-label*="dimensions"], svg[aria-label*="Standing in"]' },
  { section: 'plan', look: 'room',
    title: 'Stand inside it',
    body: 'Stand inside puts you at eye height with the ceiling on — the view for showing a '
        + 'client.',
    more: 'Every wall carries its name and its length, every opening its size. Closer, Further '
        + 'out and Straighten up are along the same row.',
    find: '[data-panel="plan"] [data-sheet="yes"] > div:nth-of-type(4) > div:nth-of-type(1)' },
  { section: 'room',
    title: 'The ceiling height',
    body: 'The one dimension every wall area is multiplied by. Type a real one and it becomes '
        + 'measured.',
    more: 'A scan takes it from the tallest wall it saw and says how sure it is, which is not '
        + 'the same as knowing it.',
    find: '[data-panel="room"] > section:nth-of-type(1)' },
  { section: 'room',
    title: 'Wall thickness, for framing',
    body: 'The one number that has to be said rather than measured — a scan cannot see inside a '
        + 'wall.',
    more: 'Pick a build-up — 2x4, 2x6, block — and plates, studs and headers appear on the '
        + 'takeoff.',
    find: '[data-panel="room"] > section:nth-of-type(3)' },
  { section: 'room',
    title: 'What still needs doing',
    body: 'Ranked by what being wrong costs: the longest wall first, because it holds the most '
        + 'floor.',
    more: 'The number on the Room tab is the length of this list.',
    find: '[data-panel="room"] > div > section:nth-of-type(3)' },
  { section: 'takeoff',
    title: 'The takeoff',
    body: 'Floor, ceiling, wall face, baseboard, framing, and every door and window counted.',
    more: 'Each one carries its own workings, so a number can be checked rather than trusted. '
        + 'Send it, copy it, or open it in a spreadsheet.',
    find: '[data-panel="takeoff"] section > div:nth-of-type(2)' },
  { section: 'price',
    title: 'What it comes to',
    body: 'Every line is a rate you set times a quantity the room measured. None of it is '
        + 'market data.',
    more: 'An item with no rate against it is named rather than priced at zero — a quote that '
        + 'adds up perfectly and is short by a floor is the worst thing this could produce.',
    find: '[data-tour="priced-lines"]' },
  { section: 'price',
    title: 'Your rates',
    body: 'The same book as the Business tab, reachable from here so you keep your place.',
    more: 'Mark jobs won and it will suggest rates out of your own history — the middle one, so '
        + 'a single emergency job does not move your book.',
    find: '[data-panel="price"] button' },
  { section: 'price',
    title: 'Price a different number',
    body: 'Override any quantity, with a reason, and the takeoff goes on showing both figures.',
    more: 'The override travels onto the proposal, so nobody has to wonder later why a line does '
        + 'not match the room.',
    find: '[data-panel="price"] > section:nth-of-type(1) > dl > div:nth-of-type(1)' },
  { section: 'agree',
    title: 'The proposal',
    body: 'The quantities and the rates are already here, so the two documents cannot disagree.',
    more: 'It names what is still missing rather than looking finished, and it carries the '
        + 'scanned caveat onto the client’s paper.',
    find: '[data-panel="agree"] > div > section:nth-of-type(1)' },
  { section: 'agree',
    title: 'Signed, with a record worth having',
    body: 'Who signed, when, on what, the exact words they agreed to, and a fingerprint of the '
        + 'document.',
    more: 'And that they consented to sign electronically. That record is what decides a '
        + 'dispute — not the picture of a name.',
    find: '[data-panel="agree"] > div > section:nth-of-type(3)' },
  { section: 'agree',
    title: 'And what changed since',
    body: 'The signed scope is never edited. Anything different becomes a change order against '
        + 'it.',
    more: 'So at any point you can show what was agreed, what changed, and who signed for each.',
    find: '[data-panel="agree"] > div > section:nth-of-type(4)' },
  { section: 'work',
    title: 'When it happens',
    body: 'Days go into your own calendar — no service, no monthly fee, no account for the '
        + 'client.',
    more: 'A client’s calendar reads the file whatever they use.',
    find: '[data-panel="work"] > div > section:nth-of-type(1) > div' },
  { section: 'work',
    title: 'Asking to be paid',
    body: 'Invoices are built from what somebody signed, never from what the room measures '
        + 'today.',
    more: 'A bill for work nobody agreed to is not a mistake, it is a dispute. There is a '
        + 'QuickBooks export at the foot of this screen.',
    find: '[data-panel="work"] > div > section:nth-of-type(3) > div:nth-of-type(1)' },
  { section: 'claim',
    title: 'Insurance mode',
    body: 'Off unless you turn it on, and turning it off again puts the screen back as it was.',
    more: 'Mark damage while standing in front of it and the room works out the square feet of '
        + 'board and the feet of base, because it already knows how long the wall is.',
    find: '[data-panel="claim"] > section:nth-of-type(1) > div:nth-of-type(1)' },
  { section: 'claim',
    title: 'What the damage takes',
    body: 'What has to come out, and under it what goes back — both worked out from the marks.',
    more: 'Photographs attach to the damage they belong to rather than to an email, and '
        + 'moisture readings keep their scale — the app refuses to draw a curve across a change '
        + 'of scale, lists them instead, and says why.',
    find: '[data-panel="claim"] > section:nth-of-type(2) > div:nth-of-type(2)' },
  { section: 'claim',
    title: 'Send it to the adjuster',
    body: 'One file: the drawings, every damaged area, what it measures and how that was worked '
        + 'out.',
    more: 'No prices are on it — the scope and what it costs are two documents on purpose. '
        + '“Mark more on the phone” opens the camera again for marks only, and nothing measured '
        + 'changes.',
    find: '[data-panel="claim"] > section:nth-of-type(3)' },
  { section: 'files',
    title: 'Everything that leaves',
    body: 'The drawing, the client file, CAD, the field sheet, the claim PDF, the whole job '
        + 'zipped.',
    more: 'A client opens what you send without an account, and there is ESX for Xactimate.',
    find: '[data-panel="files"] > section:nth-of-type(1)' },
];

/**
 * How much of the window the card is allowed to have, as a fraction.
 *
 * Exported because `a21-tour` holds the tour to exactly these numbers on a
 * 430x800 screen: a budget only one of the two files knows about is a budget
 * that drifts the first time somebody adds a line of prose.
 */
export const CARD_BUDGET = { open: 0.2, folded: 0.125, reading: 0.45 } as const;

/** Breathing room between the ring and the edges of the free area. */
const MARGIN = 8;

export function Tour({
  onGo,
  onDone,
}: {
  readonly onGo: (stop: Stop) => void;
  readonly onDone: () => void;
}) {
  const [at, setAt] = useState(0);
  /**
   * Folded down to the one bar that moves you.
   *
   * Two lines of body is already small, and it is still two lines somebody may
   * want out of the way while they drag the 3D view around. Folded, the card is
   * the counter, the title and the controls, and nothing else.
   */
  const [folded, setFolded] = useState(false);
  /**
   * The rest of what this stop has to say, for the person who wants it.
   *
   * Per stop rather than sticky: opening it on the proposal should not then
   * cover the drawing on the stop after. It is somebody asking a question about
   * *this* screen, and it is answered on this screen.
   */
  const [reading, setReading] = useState(false);
  const card = useRef<HTMLElement | null>(null);
  const stop = TOUR[at]!;

  // `onGo` is written inline by the caller, so it is a new function on every
  // render. Depended on directly it would re-run the effect below on every
  // render -- and the effect calls `onGo`, which sets state, which renders.
  // A ref is read at the moment of use and never changes identity, so the
  // effect runs when the STOP changes and at no other time.
  const go = useRef(onGo);
  go.current = onGo;

  // Move the app to where this stop is about. Nothing else: putting the ring on
  // in here as well would re-run the section switch every time the card is
  // folded, which flickers the panel underneath for no reason.
  useEffect(() => {
    go.current(stop);
    setReading(false);
  }, [at, stop]);

  // Ring the subject, and put it in the part of the screen the card is not on.
  //
  // Depends on `folded` and `reading` as well as the stop, because both change
  // the height of the card and therefore the height of the free area. Without
  // them, folding the card to see more of the drawing left the drawing exactly
  // where it was and simply exposed more of the page below it.
  useEffect(() => {
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
      // So the free area is measured -- from the top of the window to the top
      // of the card -- and the target is put in the middle of THAT.
      const top = MARGIN;
      const foot = card.current?.getBoundingClientRect().top ?? window.innerHeight;
      const free = Math.max(120, foot - MARGIN) - top;
      const box = target.getBoundingClientRect();

      // A target taller than the free area cannot be shown whole, and centring
      // it is the worst of the two ways to fail: both edges go off the screen
      // and the ring reads as a line down each side of the page. Its top edge
      // is put at the top of the free area instead, so the ring is visibly a
      // ring and reading it starts where reading anything starts.
      const want = box.height <= free
        ? box.top + window.scrollY - top - (free - box.height) / 2
        : box.top + window.scrollY - top;
      window.scrollTo({ top: Math.max(0, want), behavior: 'smooth' });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [at, stop, folded, reading]);

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
      <div className="rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-white
                      shadow-lg">
        {/* The counter, the title and the way out, on one line. As three lines
            it was fifty pixels of a phone saying where you are rather than
            what you are looking at. */}
        <div className="flex items-center gap-2">
          <p className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-slate-400">
            {at + 1} of {TOUR.length}
          </p>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{stop.title}</h2>
          {/* Negative margin so a 44-pixel tap target does not make this row
              44 pixels tall. The name is the sentence, not the glyph. */}
          <button
            type="button"
            onClick={onDone}
            aria-label="Stop the tour"
            className="-my-2 flex h-11 w-8 shrink-0 items-center justify-center text-lg
                       leading-none text-slate-400 active:text-white"
          >
            ×
          </button>
        </div>

        {!folded && (
          <p className="mt-1 text-[13px] leading-snug text-slate-200">{stop.body}</p>
        )}
        {!folded && reading && stop.more !== undefined && (
          <p className="mt-1.5 text-[13px] leading-snug text-slate-400">{stop.more}</p>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            disabled={at === 0}
            onClick={() => setAt(at - 1)}
            className="min-h-11 shrink-0 rounded-md border border-slate-600 px-3 text-sm
                       font-medium text-slate-200 active:bg-slate-800 disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => (last ? onDone() : setAt(at + 1))}
            className="min-h-11 flex-1 rounded-md bg-white px-4 font-semibold text-slate-900
                       active:bg-slate-200"
          >
            {last ? 'Finish' : 'Next'}
          </button>
          {!folded && stop.more !== undefined && (
            <button
              type="button"
              onClick={() => setReading(!reading)}
              aria-expanded={reading}
              className="min-h-11 shrink-0 rounded-md px-2 font-mono text-xs uppercase
                         tracking-widest text-slate-300 active:bg-slate-800"
            >
              {reading ? 'Less' : 'More'}
            </button>
          )}
          {/* Out of the way, and back again. The one control that decides
              whether this card is help or an obstruction. */}
          <button
            type="button"
            onClick={() => setFolded(!folded)}
            aria-expanded={!folded}
            className="min-h-11 shrink-0 rounded-md px-2 font-mono text-xs uppercase
                       tracking-widest text-slate-300 active:bg-slate-800"
          >
            {folded ? 'Show' : 'Hide'}
          </button>
        </div>
      </div>
    </aside>
  );
}
