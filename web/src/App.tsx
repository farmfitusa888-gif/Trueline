import { useEffect, useMemo, useReducer, useState } from 'react';
import { area, isDiagonal, runLength } from '../../core/src/room.ts';
import { isAdjusted } from '../../core/src/measurement.ts';
import { EditWall, RenameRoom } from './Edit.tsx';
import { WorkOnRoom, WorkOnSurface, WorkOnWall, type WorkOnProps } from './WorkOn.tsx';
import { useUnits } from './units.tsx';
import { readiness } from '../../core/src/issue.ts';
import { extent } from '../../core/src/health.ts';
import { DEFAULT_REACH, obstructions, punchList } from '../../core/src/obstruction.ts';
import { missingFromClaim } from '../../core/src/claim.ts';
import { missingFromProposal } from '../../core/src/proposal.ts';
import { EMPTY, mayKeep, persist, reduce } from './state.ts';
import { installBridge } from './bridge.ts';
import { Plan, legendFor } from './Plan.tsx';
import { Corrections } from './Corrections.tsx';
import { FieldSheet } from './FieldSheet.tsx';
import { Mark } from './Mark.tsx';
import { Room3D } from './Room3D.tsx';
import { Takeoff } from './Takeoff.tsx';
import { Thickness } from './Thickness.tsx';
import { Measure } from './Measure.tsx';
import { planThumbnail } from './sheet.ts';
import { Agree } from './Agree.tsx';
import { Gate, RoomLimit } from './Locked.tsx';
import { Work } from './Work.tsx';
import { Tags } from './Tags.tsx';
import { Zones } from './Zones.tsx';
import { Panel, SectionBar, type SectionFlags, type SectionKey } from './Sections.tsx';
import { Tour, TOUR } from './Tour.tsx';
import { handBackThumbnail, insideApp } from './bridge.ts';
import { Openings } from './Openings.tsx';
import { Ceiling, CeilingPanel } from './Ceiling.tsx';
import { CEILING, surfaceKey } from '../../core/src/work.ts';
import { Settings } from './Settings.tsx';
import { PriceList } from './PriceList.tsx';
import { RateBook } from './Rates.tsx';
import { Trouble } from './Trouble.tsx';
import { Sheet } from './Sheet.tsx';
import { Sketch } from './Sketch.tsx';
import { Price } from './Price.tsx';
import { JobStatus } from './JobStatus.tsx';
import { Floor } from './Floor.tsx';
import { Draw } from './Draw.tsx';
import { WallPhotos } from './WallPhotos.tsx';
import { VoiceNotes } from './Voice.tsx';
import { notesOnWall } from '../../core/src/voice.ts';
import { losses } from '../../core/src/damage.ts';
import { Elevation } from './Elevation.tsx';
import { DamageOnWall } from './Damage.tsx';
import { Claim } from './Claim.tsx';
import { Scope } from './Scope.tsx';
import { ClaimSend } from './ClaimSend.tsx';

/**
 * The first screen of Trueline: correct an imported scan.
 *
 * It is deliberately the first one. A scan closes perfectly whether it is right
 * or wrong, so the moment that decides whether the whole product is worth
 * anything is the one where a person looks at what the scanner produced,
 * disagrees with a number, and types the real one. Everything else — projects,
 * accounts, exports — is scaffolding around that moment.
 *
 * No server. A scan is a `room.json` dropped on the page, which is exactly the
 * file the reference app already exports. That means this is usable today, on a
 * phone, on a real scan, before an API exists.
 */

function Opener({
  onOpen,
  onDraw,
}: {
  onOpen: (json: unknown, fileName: string) => void;
  onDraw: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function take(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      onOpen(JSON.parse(await file.text()), file.name);
    } catch {
      onOpen(null, file.name);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void take(event.dataTransfer.files[0]);
      }}
      className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center"
    >
      <h2 className="text-lg font-semibold text-slate-900">Open a scan</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        Drop the <code className="rounded bg-slate-100 px-1">room.json</code> from a RoomPlan export,
        or pick it below. Nothing is uploaded — the file is read in this browser and stays there.
      </p>
      <label className="mt-5 inline-block">
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => void take(event.target.files?.[0])}
        />
        <span className="inline-block min-h-12 cursor-pointer rounded-md bg-slate-900 px-6 py-3 font-semibold text-white active:bg-slate-700">
          {busy ? 'Reading…' : 'Choose a file'}
        </span>
      </label>

      <p className="mt-6 text-sm text-slate-600">
        No scan?{' '}
        <button
          type="button"
          onClick={onDraw}
          className="min-h-11 font-semibold text-slate-900 underline underline-offset-4"
        >
          Draw it by hand
        </button>{' '}
        — a tape and this phone, or an old drawing.
      </p>
    </div>
  );
}

/**
 * What to offer on a phone when there is no room on the screen.
 *
 * Not a file picker. In the app there is no filesystem to pick from, and
 * offering one is how somebody whose capture would not open ended up looking at
 * a drag-and-drop box with nothing on the device to drag into it — an error
 * message above a control that could not do anything about it.
 *
 * What can actually be done from here is: go back and scan the room again, or
 * draw it. So that is what it says.
 */
function NothingHere({ onDraw }: { onDraw: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
      <h2 className="text-lg font-semibold text-slate-900">Nothing to show for this one</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
        This capture has no room in it. That happens when a scan is stopped before the phone has
        found any walls — there is nothing here to correct, and nothing that can be recovered
        from it.
      </p>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-600">
        Go back and scan the room again, or measure it by hand — that needs no LiDAR and every
        number in it is measured from the first keystroke.
      </p>
      <button
        type="button"
        onClick={onDraw}
        className="mt-5 min-h-12 rounded-md bg-slate-900 px-6 font-semibold text-white active:bg-slate-700"
      >
        Draw it by hand
      </button>
    </div>
  );
}

/**
 * Which screen the app was asked to open on.
 *
 * ## Why there is a route at all now
 *
 * The iOS app used to have exactly one way in: open a scan, and everything —
 * the floor, the handbook, the contractor's own business details — lived behind
 * links inside that scan's page. So setting your licence number meant first
 * picking some room you did not want to look at. The report was blunt: *"have
 * to go through a project to get to the options"*.
 *
 * The app has a tab bar now, and Floor and Business are tabs. Both load this
 * same bundle with no scan handed over, and both need it to open somewhere
 * other than the top. The fragment is how they say which — `#floor`,
 * `#business` — because it is the one part of a URL a custom scheme handler
 * never sees and never has to serve.
 *
 * ## And `#draw`, which was a screen with no door
 *
 * Drawing a room by tapping its corners is built, tested and audited, and on a
 * phone it could not be opened. The only thing that ever rendered it was the
 * no-room branch below, and the app never loads this bundle without a room
 * except on Floor and Business. So the one way to reach it was to start a scan,
 * fail it, open the dead capture and take the way out — which is not a way in.
 *
 * That is the same failure `Sections.tsx` and `RootTabs.swift` each exist to
 * fix, for the third time: work that is finished and unreachable is
 * indistinguishable from work that was never done.
 *
 * `#draw` is the door. `DrawScreen.swift` is what opens it, from the Rooms tab.
 *
 * Anything unrecognised opens the room, which is the old behaviour and the
 * right default: a bad route should cost nothing.
 */
export function openedAt(): 'room' | 'floor' | 'business' | 'draw' | 'demo' | 'tour' {
  let hash = '';
  try {
    hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  } catch {
    return 'room';
  }
  return hash === 'floor' || hash === 'business' || hash === 'draw' || hash === 'demo'
    || hash === 'tour'
    ? hash
    : 'room';
}

export function App() {
  const { len, area: showArea, borrow } = useUnits();
  const [state, dispatch] = useReducer(reduce, EMPTY);
  const [saveTrouble, setSaveTrouble] = useState<string | null>(null);
  /** Why a new room was not written down, or nothing. Never about an old one. */
  const [roomLimit, setRoomLimit] = useState<string | null>(null);
  // Plan or room. The same model, the same selection, the same tape box under
  // both — switching view never changes what is being measured.
  const [look, setLook] = useState<'plan' | 'room'>('plan');
  const [section, setSection] = useState<SectionKey>('plan');
  // Furniture is drawn faintly because it is why some walls are worth a tape.
  // On a sheet going to a client it is clutter, so it comes off -- and taking
  // it off moves nothing, because no number ever came from it.
  const [furniture, setFurniture] = useState(true);
  // Opened straight onto the grid when the app asked for `#draw`, which is what
  // the Rooms tab's "Draw a room" pushes. Everywhere else it starts closed and
  // a button opens it.
  const [drawing, setDrawing] = useState(() => openedAt() === 'draw');
  const [settings, setSettings] = useState(() => openedAt() === 'business');
  // One room, or all of them. The floor is a view over the rooms already saved
  // on this device plus the joins somebody declared between them, so switching
  // to it never touches what is being corrected.
  const [showing, setShowing] = useState<'room' | 'floor'>(
    openedAt() === 'floor' ? 'floor' : 'room'
  );
  /**
   * Which screen the page was asked for, kept up to date.
   *
   * Read once at start-up in the first version, which was wrong in a way that
   * only shows up outside the app: changing a URL's fragment is a
   * same-document navigation. Nothing reloads, no state changes, React does
   * not re-render, and the page goes on showing whatever it was showing. It
   * looked right on a phone -- where every tab builds a new web view and does
   * a real load -- and did nothing at all in a browser.
   *
   * A route that only works because of how its one caller happens to be built
   * is not a route. So the hash is followed.
   */
  const [openedOn, setOpenedOn] = useState(openedAt);
  useEffect(() => {
    const follow = () => setOpenedOn(openedAt());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  useEffect(() => {
    setSettings(openedOn === 'business');
    setShowing(openedOn === 'floor' ? 'floor' : 'room');
    // Only ever turned ON by the route. A finished drawing sets it false and
    // opens the room it made; re-asserting the route here would throw that room
    // straight back off the screen.
    if (openedOn === 'draw') setDrawing(true);
  }, [openedOn]);

  const loaded = state.loaded;
  /**
   * The worked example.
   *
   * ## Why there is a demo at all
   *
   * Everything in this app happens after a scan, and a scan needs a LiDAR
   * phone, a room, and ten minutes. So the first thing anybody sees is an empty
   * screen and an instruction — which is a bad way to find out whether a
   * takeoff is any good.
   *
   * `#demo` loads one finished job: a kitchen that was scanned, had a tape put
   * on two walls, was priced off a real rate book, written up as a proposal,
   * signed, and invoiced. Every screen is populated and every number is one the
   * app worked out.
   *
   * It is not a hand-written fixture. `site/tools/demo.mjs` builds it by
   * driving the real app through that whole path in a browser and saving
   * whatever came out — so it cannot drift away from what the app actually
   * does, and rebuilding it is how you find out that it has.
   */
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    if ((openedOn !== 'demo' && openedOn !== 'tour') || loaded) return;
    let dropped = false;
    void import('./demo.json')
      .then((file) => {
        if (dropped) return;
        const example = file.default ?? file;
        dispatch({ type: 'openSaved', project: JSON.stringify(example.project) });
        setDemo(true);
      })
      .catch(() => {
        // A build with no example in it. The screen is what it would have been
        // anyway, which is the right failure: nothing here is load-bearing.
      });
    return () => { dropped = true; };
  }, [openedOn, loaded]);

  /**
   * The rate book that priced the example, lent to the screen.
   *
   * ## Why the example needs one at all
   *
   * A project file does not carry rates — the book belongs to the contractor,
   * not to the room. So the example opened on a phone that had never had a rate
   * typed into it: every priced line came back empty, and the app correctly
   * reported that every line of the signed scope had been removed. The Work
   * screen read **"Agreed $0.00"** under an invoice for $2,889.45, and the
   * Agreement screen offered a change order that deleted the job.
   *
   * ## Why this is its own effect
   *
   * It depends on the ROUTE and nothing else. Folded into the loading effect
   * above it would also depend on `loaded`, which goes from nothing to a room
   * the instant that effect runs — so the cleanup would fire immediately and
   * hand the book straight back, one render after borrowing it.
   *
   * Nothing borrowed is written to storage or handed to the phone, and the
   * contractor's own profile comes back whichever way somebody leaves.
   */
  useEffect(() => {
    if (openedOn !== 'demo' && openedOn !== 'tour') return;
    let dropped = false;
    void import('./demo.json')
      .then((file) => {
        if (dropped) return;
        borrow((file.default ?? file).company);
      })
      .catch(() => {
        // No example in this build. Then there is no book to lend and the
        // screen is the contractor's own, which is the right failure.
      });
    return () => { dropped = true; borrow(null); };
  }, [openedOn, borrow]);

  /**
   * The guided tour.
   *
   * ## What it is for
   *
   * Twenty stops, in the order of a job rather than the order of the tab bar:
   * the drawing, the room, the takeoff, the money, the paperwork, the claim,
   * the files. It moves the app to each screen and says what is on it.
   *
   * ## Why it runs on the example and not on your room
   *
   * A tour of an empty app is a tour of the word "Nothing". Every stop needs
   * something real to point at, and only the worked example is guaranteed to
   * have one -- so `#tour` loads the example first, by the same effect above,
   * and starts here once there is a room to look at.
   *
   * It reads and never writes. No stop taps a control on anybody's behalf,
   * because a tour that edits your work is a tour nobody starts twice.
   */
  const [touring, setTouring] = useState(false);
  useEffect(() => {
    if (openedOn === 'tour') setTouring(true);
  }, [openedOn]);

  // Let the scanner in — and pick up whatever was being corrected last time.
  // A capture handed over at start-up wins: somebody who has just finished
  // walking a room wants that room, not the one they were looking at yesterday.
  useEffect(() => {
    // Everything the app has to say, live or parked, in one place. What order
    // it is applied in lives in `installBridge`'s own `take` and nowhere else
    // -- it used to be half here and half there, and the half that was here
    // knew nothing about the subscription, which is why every paid screen on
    // the phone drew itself as a blank rectangle.
    installBridge(dispatch);
  }, []);

  // And write it back after every change. Ten minutes of correcting a scan on a
  // tablet must not be lost because the phone rang.
  useEffect(() => {
    if (!loaded) return;
    // Asked first so the screen can explain in its own words. `persist` refuses
    // on its own as well — that is the safety net, not the message.
    const may = mayKeep(loaded);
    setRoomLimit(may.keep ? null : may.because);
    if (!may.keep) {
      setSaveTrouble(null);
      return;
    }
    setSaveTrouble(persist(loaded, new Date().toISOString()));
  }, [loaded]);

  // A picture of the plan for the app's list of scans, once per room. The list
  // showed three folders called "Room 2026-08-24 1819" and left somebody to
  // remember which was the kitchen. Keyed on the file name rather than the room
  // so it is not remade on every keystroke: a room does not change shape while
  // somebody types, and the drawing is only there to be recognised.
  const fileName = loaded?.fileName;
  useEffect(() => {
    if (!fileName || look !== 'plan') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const svg = document.querySelector<SVGSVGElement>('svg[aria-label^="Plan of"]');
      if (!svg) return;
      void planThumbnail(svg)
        .then((url) => {
          if (!cancelled) handBackThumbnail(fileName, url);
        })
        // A list without a picture is a list. Nothing depends on this, and it
        // must never be able to take the screen down.
        .catch(() => undefined);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fileName, look]);

  const derived = useMemo(() => {
    if (!loaded) return null;
    const blocking = obstructions(loaded.room, loaded.footprints, DEFAULT_REACH);
    return {
      state: readiness(loaded.room),
      obstructions: blocking,
      punchList: punchList(loaded.room, loaded.footprints, DEFAULT_REACH, 8),
      area: area(loaded.room),
      // How far the room reaches each way — the first thing anybody in the
      // trade says about a room, computed since the day the health checks were
      // written and never once put on a screen.
      extent: extent(loaded.room),
    };
  }, [loaded]);

  /// What each section is waiting on, counted from the same functions the
  /// sections themselves use. A number on a tab is the only way a part of the
  /// app nobody has opened can ask to be opened — and every one of these is a
  /// thing a person has to do, never a complaint about the app.
  const sectionFlags = useMemo<SectionFlags>(() => {
    if (!loaded || !derived) return {};
    return {
      room: derived.state.blocking.length + derived.punchList.length,
      claim: loaded.claim.on ? missingFromClaim(loaded.claim).length : 0,
      // What is still missing from a proposal that exists, and nothing at all
      // before one does: a badge on a tab nobody has been to yet is noise.
      agree: loaded.proposal ? missingFromProposal(loaded.proposal).length : 0,
    };
  }, [loaded, derived]);

  const selectedWall = loaded && state.selected ? loaded.room.walls.find((w) => w.id === state.selected) : undefined;

  /**
   * What is being done, wired once and handed to both places it is decided.
   *
   * The wall panel and the Room panel are two doors onto one record. Two copies
   * of these handlers is two chances for one of them to write a scope the other
   * cannot read, which is the same reason the takeoff and the proposal share
   * one quote rather than each working out a total.
   */
  const workProps: WorkOnProps | null = loaded && {
    room: loaded.room,
    scope: loaded.scope,
    onPick: (surface, item, items) =>
      dispatch({ type: 'pickWork', surface, item, items, by: 'me', at: new Date().toISOString() }),
    onDrop: (surface, item, items) =>
      dispatch({ type: 'dropWork', surface, item, items, by: 'me', at: new Date().toISOString() }),
    onStartFromEverything: (items) =>
      dispatch({ type: 'scopeAll', items, by: 'me', at: new Date().toISOString() }),
    onStartFromNothing: () =>
      dispatch({ type: 'scopeNone', by: 'me', at: new Date().toISOString() }),
    onPriceEverything: () => dispatch({ type: 'unscope' }),
  };

  const native = insideApp();

  return (
    // The bottom padding clears the room's own bar and nothing more. It was
    // 6.5rem for a 3.5rem bar, which left an inch of empty page under every
    // short panel -- visible under the takeoff in the report that started this.
    <main className="mx-auto max-w-3xl px-4 pt-6 pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {/* Hidden inside the iOS app, where the tab bar along the bottom and the
          navigation bar along the top are the real chrome and this row was a
          second, different-looking copy of both. It was the complaint: "the
          menu looks weird and not everything works". In a browser it is the
          only way to reach any of this, so there it stays. */}
      {!native && (
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        {/* The wordmark is the way home once a room is open, because that is
            where every app on this phone puts it. Not a link when there is
            nothing to go back from: a control that does nothing is worse than
            no control. */}
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          {loaded ? (
            <button
              type="button"
              onClick={() => dispatch({ type: 'close' })}
              // Just "Home". A longer label read well and collided with the
              // "Open another" link beside it -- two controls whose accessible
              // names share a phrase are two controls a screen reader user, and
              // anything driving this app by name, cannot tell apart.
              aria-label="Home"
              className="flex min-h-11 items-center gap-2"
            >
              <Mark className="h-7 w-auto text-slate-900" />
              <span>
                True<span className="text-[#B8590A]">line</span>
              </span>
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <Mark className="h-7 w-auto text-slate-900" />
              <span>
                True<span className="text-[#B8590A]">line</span>
              </span>
            </span>
          )}
        </h1>
        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {loaded && (
            <button
              type="button"
              onClick={() => dispatch({ type: 'close' })}
              className="inline-flex min-h-11 items-center text-sm text-slate-500 underline underline-offset-4"
            >
              Open another
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowing(showing === 'floor' ? 'room' : 'floor')}
            aria-label={showing === 'floor' ? 'Back to this room' : 'The whole floor'}
            className="inline-flex min-h-11 items-center text-sm text-slate-500 underline underline-offset-4"
          >
            {showing === 'floor' ? 'This room' : 'The floor'}
          </button>
          {/* The handbook travels with the app rather than living on a
              website, because the person who needs it is standing in an
              unfinished basement with no signal. It opens in this same view
              and has a way back at the top of it; what is being corrected is
              in this browser's own storage, so coming back finds the room
              exactly where it was left. */}
          <a
            href="./handbook.html"
            className="inline-flex min-h-11 items-center text-sm text-slate-500 underline underline-offset-4"
          >
            How to use it
          </a>
          <button
            type="button"
            onClick={() => setSettings(!settings)}
            // Named for what it does now, not for what it opens. It said
            // "Your business" while showing the word "Close", so a screen
            // reader announced one thing and the screen said the other — and
            // the announced one was wrong twice over, because pressing it
            // closed the business screen rather than opening it.
            aria-label={settings ? 'Close your business details' : 'Your business'}
            aria-expanded={settings}
            className="inline-flex min-h-11 items-center text-sm text-slate-500 underline underline-offset-4"
          >
            {settings ? 'Close' : 'Your business'}
          </button>
        </span>
      </header>
      )}

      {settings && (
        <div className="mb-5 space-y-5">
          {/* No Done when this IS the screen. On the Business tab there is
              nothing behind it to go back to, and a Done that closed it would
              leave somebody looking at a blank page. */}
          <Settings {...(openedOn === 'business' ? {} : { onClose: () => setSettings(false) })} />
          {/* What you charge, before any room exists.
              > "AND WHERES THE AREA THE CONTRACTOR CAN SET THEIR OWN RATES FOR
              >  EACH TYPE OF JOB?"
              It was inside a room, behind the subscription, on a screen that
              was rendering blank. The rates were never part of a room -- they
              save to this profile and are the same book on every job -- so
              they belong here, next to the licence number, where somebody
              types them once before the first scan. Still under Price → Your
              rates as well: same component, same book. */}
          {openedOn === 'business' && <RateBook />}
          {/* Beside the profile rather than beside a room: a price list belongs
              to the business, not to the job somebody happens to have open. */}
          <PriceList />
          {/* Last, and only when this IS the Business tab. It is about the app
              rather than about a room, and it must not be the first thing
              somebody meets when they open the sheet to type a licence number.
              It draws nothing at all outside the app -- see `Trouble`. */}
          {openedOn === 'business' && <Trouble />}
        </div>
      )}

      {roomLimit && <RoomLimit because={roomLimit} />}

      {saveTrouble && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {saveTrouble}
        </div>
      )}

      {state.error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="whitespace-pre-line">{state.error}</p>
          <button
            type="button"
            onClick={() => dispatch({ type: 'dismissError' })}
            className="mt-3 min-h-11 rounded-md border border-red-300 px-4 py-2 font-medium active:bg-red-100"
          >
            Close
          </button>
        </div>
      )}

      {demo && loaded && (
        <div
          role="note"
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm
                     leading-relaxed text-amber-900"
        >
          <strong>This is the worked example.</strong> A kitchen that was scanned, had a tape
          put on two walls, was priced off a rate book, written up, signed and invoiced — every
          number on every screen came out of it. It is not your work and nothing you change here
          matters. Tap <em>Rooms</em> below to start your own.
          {!touring && (
            <p className="mt-3">
              <button
                type="button"
                onClick={() => setTouring(true)}
                className="min-h-11 rounded-md border border-amber-400 bg-white px-4
                           font-semibold text-amber-900 active:bg-amber-100"
              >
                Take the tour — {TOUR.length} stops
              </button>
            </p>
          )}
        </div>
      )}

      {openedOn === 'business' ? null : showing === 'floor' ? (
        <Floor
          onOpenRoom={(fileName) => {
            dispatch({ type: 'restore', fileName, force: true });
            setShowing('room');
          }}
        />
      ) : !loaded ? (
        drawing ? (
          <div className="space-y-4">
            {/* Two ways to draw a room by hand, and they are genuinely
                different rather than a choice of skin.

                Tapping corners takes the SHAPE first and leaves naming and
                measuring for afterwards — any shape, no compass, edit
                anything. Nothing it produces is measured, and it says so.

                Typing walls is measured from the first keystroke and cannot
                draw a shape that is not a run of compass headings.

                So the tapped one is offered first, because it is the one
                somebody reaches for, and the typed one is right underneath
                for the room somebody already has the numbers for. */}
            <Sketch
              onDone={(room, name) => {
                dispatch({ type: 'openDrawn', room, fileName: name });
                setDrawing(false);
              }}
              {...(openedOn === 'draw' ? {} : { onCancel: () => setDrawing(false) })}
            />
            <details className="rounded-lg border border-slate-200 bg-white p-4">
              <summary className="min-h-11 cursor-pointer text-sm font-medium text-slate-700">
                Or type it in wall by wall, with the tape readings you already have
              </summary>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Slower, and the only way where every number is measured from the first
                keystroke — nothing comes off a grid. Right when you are working from a
                sheet of dimensions rather than from the room.
              </p>
              <div className="mt-3">
                <Draw
                  onDone={(room, name) => {
                    dispatch({ type: 'openDrawn', room, fileName: name });
                    setDrawing(false);
                  }}
                  {...(openedOn === 'draw' ? {} : { onCancel: () => setDrawing(false) })}
                />
              </div>
            </details>
          </div>
        ) : insideApp() ? (
          <NothingHere onDraw={() => setDrawing(true)} />
        ) : (
          <Opener
            onOpen={(json, fileName) =>
              dispatch({ type: 'open', json, fileName, at: new Date().toISOString() })
            }
            onDraw={() => setDrawing(true)}
          />
        )
      ) : (
        derived && (
          <div className="space-y-5 sheet-root">
            <SectionBar active={section} flags={sectionFlags} onPick={setSection} />

            <Panel section="plan" active={section}>
              <div data-sheet="yes" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div data-sheet="no" className="mb-2 flex items-baseline justify-between gap-3 px-1">
                  <h2 className="text-base font-semibold text-slate-900">{loaded.room.name}</h2>
                  <p className="text-sm font-mono tabular-nums text-slate-600">
                    {len(derived.extent.x)} × {len(derived.extent.y)} ·{' '}
                    {showArea(derived.area.value)}
                  </p>
                </div>

                {/* Out of the importer the name is a file name, and "garage.json"
                    at the head of a document going to an insurer reads as a
                    machine's output rather than a contractor's. */}
                <div data-sheet="no" className="mb-3 px-1">
                  <RenameRoom
                    room={loaded.room}
                    onRename={(name) => dispatch({ type: 'renameRoom', name })}
                  />
                </div>

                <div
                  role="tablist"
                  data-sheet="no"
                  aria-label="How to look at this room"
                  className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1"
                >
                  {(['plan', 'room'] as const).map((which) => (
                    <button
                      key={which}
                      type="button"
                      role="tab"
                      aria-selected={look === which}
                      onClick={() => setLook(which)}
                      className={`min-h-11 flex-1 rounded-md px-4 font-medium ${
                        look === which
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 active:bg-slate-200'
                      }`}
                    >
                      {which === 'plan' ? 'Blueprint' : '3D'}
                    </button>
                  ))}
                </div>

                {look === 'plan' ? (
                  <>
                    <Plan
                      room={loaded.room}
                      north={loaded.north}
                      selected={state.selected}
                      obstructions={derived.obstructions}
                      footprints={loaded.footprints}
                      furniture={furniture}
                      // Every mark, claim or no claim. A stretch of wall
                      // somebody marked is a fact about the building — where
                      // it lands afterwards is what the job decides, and a
                      // drawing that hid a rotten sill plate because nobody is
                      // claiming for it would be hiding the thing the drawing
                      // was made to show.
                      damages={loaded.damages}
                      // Always drawn too, for the same reason: what is behind
                      // the wall is true either way.
                      tags={loaded.tags}
                      divide={loaded.divide}
                      onSelect={(wallId) => dispatch({ type: 'select', wallId })}
                    />
                    {loaded.footprints.length > 0 && (
                      <div data-sheet="no" className="mt-2 px-1">
                        <button
                          type="button"
                          onClick={() => setFurniture((on) => !on)}
                          aria-pressed={furniture}
                          className="min-h-11 rounded-md border border-slate-300 px-3 text-sm
                                     font-medium text-slate-700 active:bg-slate-100"
                        >
                          {furniture
                            ? `Hide what was in the room (${loaded.footprints.length})`
                            : `Show what was in the room (${loaded.footprints.length})`}
                        </button>
                        <p className="mt-1 text-xs text-slate-500">
                          {furniture
                            ? 'The furniture the scan saw, drawn faintly. It is why some of these ' +
                              'walls are worth a tape.'
                            : 'The building on its own — what goes to a client or an adjuster. ' +
                              'Not one number changed: a scan reports the walls and the objects ' +
                              'separately, and no measurement here has ever read a piece of furniture.'}
                        </p>
                      </div>
                    )}
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-slate-500">
                      {legendFor(
                        loaded.damages.length > 0,
                        loaded.room.walls.some((wall) => isAdjusted(wall.length)),
                        furniture && loaded.footprints.length > 0,
                        loaded.claim.on
                      ).map((item) => (
                        <li key={item.label} className="flex items-center gap-1.5">
                          <span className={`inline-block h-2 w-4 rounded-sm ${item.className}`} />
                          {item.label}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <Room3D
                      room={loaded.room}
                      selected={state.selected}
                      footprints={loaded.footprints}
                      furniture={furniture}
                      onSelect={(wallId) => dispatch({ type: 'select', wallId })}
                    />
                    {/* "WHERE IS THE FURNITURE TOGGLE?" — here, and it has always been
                        here, but only when the scan found something standing in
                        the room. A control that is sometimes absent with no
                        explanation reads as a control that is missing. */}
                    {loaded.footprints.length === 0 && (
                      <p data-sheet="no" className="mt-2 px-1 text-xs text-slate-500">
                        This scan found nothing standing in the room, so there is no
                        furniture to show or hide. A scan that finds something gets a
                        button here.
                      </p>
                    )}
                    {loaded.footprints.length > 0 && (
                      <div data-sheet="no" className="mt-2 px-1">
                        <button
                          type="button"
                          onClick={() => setFurniture((on) => !on)}
                          aria-pressed={furniture}
                          className="min-h-11 rounded-md border border-slate-300 px-3 text-sm
                                     font-medium text-slate-700 active:bg-slate-100"
                        >
                          {furniture
                            ? `Hide what was in the room (${loaded.footprints.length})`
                            : `Show what was in the room (${loaded.footprints.length})`}
                        </button>
                        <p className="mt-1 text-xs text-slate-500">
                          Boxes, not models: a scan records where something stands and how much
                          floor it covers, and this app does not carry how tall it was — so every
                          one is drawn to the same waist height. Nothing here is measured, and
                          nothing here moves a number.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* A gesture nobody is told about is a feature nobody has. */}
              <p className="px-1 text-xs text-slate-500">
                Tap a wall to measure it. Tap the middle of the room for the ceiling.
              </p>

              {/* The ceiling, opened by tapping the empty middle of the plan.
                  Beside the wall panel and never with it: one selection, one
                  surface, exactly as a wall behaves. */}
              {!selectedWall && state.selected === surfaceKey(CEILING) && workProps && (
                <CeilingPanel
                  room={loaded.room}
                  onClose={() => dispatch({ type: 'select', wallId: null })}
                >
                  <WorkOnSurface {...workProps} surface={CEILING} />
                </CeilingPanel>
              )}

              {selectedWall && (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-semibold text-slate-900">
                      {len(runLength(selectedWall))}
                      {selectedWall.open ? ' — no wall here' : ''}
                      {isDiagonal(selectedWall.heading) ? ' — angled' : ''}
                    </h2>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'select', wallId: null })}
                      className="inline-flex min-h-11 items-center text-sm text-slate-500 underline underline-offset-4"
                    >
                      Done
                    </button>
                  </div>
                  <p className="mt-1 mb-3 text-sm text-slate-600">
                    Put a tape on it and type what it really is. Every other wall moves to fit, and
                    this one never moves again.
                  </p>
                  <Measure
                    name={`the length of ${selectedWall.id}`}
                    label={`e.g. ${len(runLength(selectedWall))}`}
                    onSubmit={(text) =>
                      dispatch({
                        type: 'verify',
                        wallId: selectedWall.id,
                        text,
                        by: 'me',
                        at: new Date().toISOString(),
                      })
                    }
                  />
                  <Openings
                    room={loaded.room}
                    wall={selectedWall}
                    onSet={(openingId, field, text) =>
                      dispatch({
                        type: 'opening',
                        wallId: selectedWall.id,
                        openingId,
                        field,
                        text,
                        by: 'me',
                        at: new Date().toISOString(),
                      })
                    }
                    onAdd={(kind, where) =>
                      dispatch({
                        type: 'addOpening',
                        wallId: selectedWall.id,
                        kind,
                        width: kind === 'cased' ? `4'` : kind === 'door' ? `3'` : `3'`,
                        height: kind === 'window' ? `4'` : `6'8"`,
                        offsetFromStart: where,
                        ...(kind === 'window' ? { sillHeight: `2'6"` } : {}),
                        by: 'me',
                        at: new Date().toISOString(),
                      })
                    }
                    onRemove={(openingId) =>
                      dispatch({ type: 'removeOpening', wallId: selectedWall.id, openingId })
                    }
                  />

                  {/* What is actually being done to this wall. High on the
                      panel on purpose: it is the decision that changes the
                      money, and it used to be a decision the app made for
                      everybody — everything replaced, every time. */}
                  {!selectedWall.open && workProps && (
                    <WorkOnWall {...workProps} wallId={selectedWall.id} />
                  )}

                  {!selectedWall.open && (
                    <Elevation room={loaded.room} wall={selectedWall} damages={loaded.damages} />
                  )}

                  {/* Marking is not an insurance feature and never was. It
                      was behind the claim switch because the claim was the
                      only thing that read a mark; a remodeler finding rot in a
                      sill plate wants the same three boxes, and what changes
                      is where it lands afterwards. `onClaim` decides which
                      vocabulary is offered — see `ConditionKind`. */}
                  <DamageOnWall
                    room={loaded.room}
                    wall={selectedWall}
                    damages={loaded.damages}
                    voice={loaded.voice}
                    onClaim={loaded.claim.on}
                    scanName={loaded.fileName}
                    onMark={(damage) => dispatch({ type: 'mark', damage })}
                    onUnmark={(damageId) => dispatch({ type: 'unmark', damageId })}
                    onCutTo={(damageId, text) => dispatch({ type: 'cutTo', damageId, text })}
                    onReading={(damageId, reading) =>
                      dispatch({ type: 'reading', damageId, reading })
                    }
                    onPhotos={(damageId, photos) =>
                      dispatch({ type: 'damagePhotos', damageId, photos })
                    }
                    onNote={(note) => dispatch({ type: 'voice', note })}
                    onForget={(noteId) => dispatch({ type: 'unvoice', noteId })}
                  />

                  <EditWall
                    room={loaded.room}
                    wall={selectedWall}
                    onRename={(name) =>
                      dispatch({ type: 'renameWall', wallId: selectedWall.id, name })
                    }
                    onDrag={(text) =>
                      dispatch({
                        type: 'drag',
                        wallId: selectedWall.id,
                        text,
                        by: 'me',
                        at: new Date().toISOString(),
                      })
                    }
                    onUnverify={() => dispatch({ type: 'unverify', wallId: selectedWall.id })}
                    onSplit={(at, newId, height) =>
                      dispatch({
                        type: 'split',
                        wallId: selectedWall.id,
                        at,
                        newId,
                        height,
                        by: 'me',
                        when: new Date().toISOString(),
                      })
                    }
                    onDelete={() => dispatch({ type: 'deleteWall', wallId: selectedWall.id })}
                        onHeight={(text) =>
                          dispatch({
                            type: 'wallHeight',
                            wallId: selectedWall.id,
                            text,
                            by: 'me',
                            when: new Date().toISOString(),
                          })
                        }
                    onNotch={(out, along, outId, alongId) =>
                      dispatch({
                        type: 'notch',
                        wallId: selectedWall.id,
                        out,
                        along,
                        outId,
                        alongId,
                        by: 'me',
                        at: new Date().toISOString(),
                      })
                    }
                  />

                  <WallPhotos room={loaded.room} wallId={selectedWall.id} photos={loaded.photos} />

                  {/* What somebody said about this wall, as opposed to about
                      something marked on it. Beside the photographs because
                      they are the same kind of thing: the record of what was
                      actually in front of somebody, which no dimension can
                      carry. */}
                  <VoiceNotes
                    notes={notesOnWall(loaded.voice, selectedWall.id)}
                    wallId={selectedWall.id}
                    onNote={(note) => dispatch({ type: 'voice', note })}
                    onForget={(noteId) => dispatch({ type: 'unvoice', noteId })}
                  />

                  {!selectedWall.open && (
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'make', wallId: selectedWall.id, as: 'open' })}
                      className="mt-3 text-sm text-slate-600 underline underline-offset-4"
                    >
                      There is no wall here
                    </button>
                  )}
                </div>
              )}

              {(loaded.lastEdit || loaded.undo.length > 0) && (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-4 py-3 text-sm">
                  <p className="text-slate-700">{loaded.lastEdit}</p>
                  {loaded.undo.length > 0 && (
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'undo' })}
                      className="min-h-11 shrink-0 rounded-md border border-slate-300 bg-white px-4 font-medium active:bg-slate-200"
                    >
                      Undo
                    </button>
                  )}
                </div>
              )}
            </Panel>

            <Panel section="room" active={section}>
              <Ceiling
                room={loaded.room}
                onSet={(text, how) =>
                  dispatch({ type: 'ceiling', text, how, by: 'me', at: new Date().toISOString() })
                }
              />

              {workProps && <WorkOnRoom {...workProps} ceilingHere={false} />}

              <Thickness
                room={loaded.room}
                selected={state.selected}
                onSet={(wallId, text, how) =>
                  dispatch({ type: 'thickness', wallId, text, how, by: 'me', at: new Date().toISOString() })
                }
              />

              <Corrections
                room={loaded.room}
                report={loaded.report}
                readiness={derived.state}
                obstructions={derived.obstructions}
                punchList={derived.punchList}
                photos={loaded.photos}
                rejectedPhotos={loaded.rejectedPhotos}
                refusedPins={loaded.refusedPins}
                cameraHeights={loaded.cameraHeights}
                selected={state.selected}
                onSelect={(wallId) => dispatch({ type: 'select', wallId })}
                onMake={(wallId, as) => dispatch({ type: 'make', wallId, as })}
              />

              {/* What is behind the wall. Under Room rather than Insurance,
                  because a joist is a fact about the building and not a loss —
                  it belongs to the room for as long as the room exists, on a
                  claim or on an ordinary remodel alike. */}
              <Tags
                room={loaded.room}
                tags={loaded.tags}
                onAdd={(input) =>
                  dispatch({
                    type: 'tag',
                    id: `tag-${Date.now()}`,
                    conditions: input.conditions,
                    at: input.at,
                    ...(input.height !== undefined ? { height: input.height } : {}),
                    note: input.note,
                    at_: new Date().toISOString(),
                    by: 'me',
                  })
                }
                onRemove={(tagId) => dispatch({ type: 'untag', tagId })}
              />

              {/* Open plans. Under Room because a divide is a fact about the
                  space, and it changes every quantity downstream. */}
              <Zones
                room={loaded.room}
                boundary={loaded.divide?.boundary ?? null}
                onSplit={(boundary, names) => dispatch({ type: 'divide', boundary, names })}
                onClear={() => dispatch({ type: 'undivide' })}
              />
            </Panel>

            <Panel section="takeoff" active={section}>
              <Gate feature="takeoff">
              <div data-sheet="yes">
                <Takeoff
                  onSetThickness={() => setSection('room')}
                  onScope={() => setSection('room')}
                  scope={loaded.scope}
                  room={loaded.room}
                  readiness={derived.state}
                  divide={loaded.divide}
                />
              </div>
              </Gate>
            </Panel>

            <Panel section="agree" active={section}>
              <Gate feature="proposal">
              <Agree
                room={loaded.room}
                overrides={loaded.overrides}
                scope={loaded.scope}
                proposal={loaded.proposal}
                baseline={loaded.baseline}
                proposalSent={loaded.proposalSent}
                saleVenue={loaded.saleVenue}
                returnedCopies={loaded.returnedCopies}
                onProposal={(proposal) => dispatch({ type: 'proposal', proposal })}
                onBaseline={(baseline) => dispatch({ type: 'baseline', baseline })}
                onProposalSent={(sent) => dispatch({ type: 'proposalSent', sent })}
                onSaleVenue={(venue) => dispatch({ type: 'saleVenue', venue })}
                onReturnedCopies={(returnedCopies) =>
                  dispatch({ type: 'returnedCopies', returnedCopies })}
              />
              </Gate>
            </Panel>

            <Panel section="price" active={section}>
              <Gate feature="pricing">
              <Price
                room={loaded.room}
                overrides={loaded.overrides}
                scope={loaded.scope}
                onOverride={(override) => dispatch({ type: 'override', override })}
                onClearOverride={(item, unit) => dispatch({ type: 'clearOverride', item, unit })}
              />

              <JobStatus room={loaded.room} fileName={loaded.fileName} scope={loaded.scope} />
              </Gate>
            </Panel>

            <Panel section="work" active={section}>
              <Gate feature="proposal">
                <Work
                  room={loaded.room}
                  overrides={loaded.overrides}
                  scope={loaded.scope}
                  proposal={loaded.proposal}
                  baseline={loaded.baseline}
                  agreedChanges={loaded.agreedChanges}
                  raisedChange={loaded.raisedChange}
                  visits={loaded.visits}
                  invoices={loaded.invoices}
                  payments={loaded.payments}
                  onVisits={(visits) => dispatch({ type: 'visits', visits })}
                  onAgreedChanges={(agreedChanges) => dispatch({ type: 'agreedChanges', agreedChanges })}
                  onRaisedChange={(raisedChange) => dispatch({ type: 'raisedChange', raisedChange })}
                  onInvoices={(invoices) => dispatch({ type: 'invoices', invoices })}
                  onPayments={(payments) => dispatch({ type: 'payments', payments })}
                />
              </Gate>
            </Panel>

            <Panel section="claim" active={section}>
              <Gate feature="insurance">
              {/* Losses only, on every insurance screen. A condition note
                  somebody wrote on the same wall is not part of the loss and
                  must never appear on an insurer's estimate as though it
                  were — see `losses` in `core/src/damage.ts`. */}
              <Claim
                room={loaded.room}
                damages={losses(loaded.damages)}
                claim={loaded.claim}
                onChange={(claim) => dispatch({ type: 'claim', claim })}
              />

              {/* The restoration sheet, only on a job that is one, and never
                  folded into the takeoff above it. Two payers, two sheets. */}
              {loaded.claim.on && <Scope room={loaded.room} damages={losses(loaded.damages)} />}

              {loaded.claim.on && (
                <ClaimSend
                  room={loaded.room}
                  fileName={loaded.fileName}
                  damages={losses(loaded.damages)}
                  claim={loaded.claim}
                  scope={loaded.scope}
                />
              )}
              </Gate>
            </Panel>

            <Panel section="files" active={section}>
              <Gate feature="exports">
              <Sheet
                room={loaded.room}
                photos={loaded.photos}
                overrides={loaded.overrides}
                scope={loaded.scope}
              />

              <FieldSheet
                room={loaded.room}
                footprints={loaded.footprints}
                marks={loaded.damages}
                voice={loaded.voice}
              />
              </Gate>
            </Panel>

            <p className="px-1 text-xs text-slate-400 print:hidden">
              {loaded.fileName} · imported from RoomPlan v{loaded.report.sourceVersion ?? '?'} ·
              nothing here left this device · kept in this browser only, so it is not a backup
            </p>

            {/* Room for the tour card, which is fixed to the bottom of the
                window. Without it the last stop's ring lands underneath the
                card that is telling you to look at it. */}
            {touring && <div aria-hidden="true" className="h-56 print:hidden" />}
          </div>
        )
      )}

      {touring && loaded && (
        <Tour
          onGo={(stop) => {
            setSection(stop.section);
            if (stop.look) setLook(stop.look);
          }}
          onDone={() => setTouring(false)}
        />
      )}
    </main>
  );
}
