import { useEffect, useMemo, useReducer, useState } from 'react';
import { area, isDiagonal, runLength } from '../../core/src/room.ts';
import { isAdjusted } from '../../core/src/measurement.ts';
import { EditWall, RenameRoom } from './Edit.tsx';
import { useUnits } from './units.tsx';
import { readiness } from '../../core/src/issue.ts';
import { extent } from '../../core/src/health.ts';
import { DEFAULT_REACH, obstructions, punchList } from '../../core/src/obstruction.ts';
import { EMPTY, persist, reduce } from './state.ts';
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
import { handBackThumbnail, insideApp } from './bridge.ts';
import { Openings } from './Openings.tsx';
import { Ceiling } from './Ceiling.tsx';
import { Settings } from './Settings.tsx';
import { PriceList } from './PriceList.tsx';
import { Sheet } from './Sheet.tsx';
import { Price } from './Price.tsx';
import { JobStatus } from './JobStatus.tsx';
import { Floor } from './Floor.tsx';
import { Draw } from './Draw.tsx';
import { WallPhotos } from './WallPhotos.tsx';
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

export function App() {
  const { len, area: showArea } = useUnits();
  const [state, dispatch] = useReducer(reduce, EMPTY);
  const [saveTrouble, setSaveTrouble] = useState<string | null>(null);
  // Plan or room. The same model, the same selection, the same tape box under
  // both — switching view never changes what is being measured.
  const [look, setLook] = useState<'plan' | 'room'>('plan');
  const [drawing, setDrawing] = useState(false);
  const [settings, setSettings] = useState(false);
  // One room, or all of them. The floor is a view over the rooms already saved
  // on this device plus the joins somebody declared between them, so switching
  // to it never touches what is being corrected.
  const [showing, setShowing] = useState<'room' | 'floor'>('room');
  const loaded = state.loaded;

  // Let the scanner in — and pick up whatever was being corrected last time.
  // A capture handed over at start-up wins: somebody who has just finished
  // walking a room wants that room, not the one they were looking at yesterday.
  useEffect(() => {
    const waiting = installBridge(dispatch);
    // A room the app kept outranks the capture it was made from: it is the same
    // room with somebody's tape readings already in it.
    if (waiting?.saved) {
      dispatch({ type: 'openSaved', project: waiting.saved });
      return;
    }
    if (waiting?.trace) {
      dispatch({
        type: 'openTrace',
        trace: waiting.trace,
        fileName: waiting.fileName ?? 'room walked on this device',
        at: new Date().toISOString(),
      });
      return;
    }
    if (waiting?.room) {
      dispatch({
        type: 'open',
        json: waiting.room,
        photos: waiting.photos,
        fileName: waiting.fileName ?? 'scan from this device',
        at: new Date().toISOString(),
      });
      return;
    }
    dispatch({ type: 'restore' });
  }, []);

  // And write it back after every change. Ten minutes of correcting a scan on a
  // tablet must not be lost because the phone rang.
  useEffect(() => {
    if (!loaded) return;
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

  const selectedWall = loaded && state.selected ? loaded.room.walls.find((w) => w.id === state.selected) : undefined;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
          <Mark className="h-7 w-auto text-slate-900" />
          <span>
            True<span className="text-[#B8590A]">line</span>
          </span>
        </h1>
        <span className="flex shrink-0 items-baseline gap-4">
          {loaded && (
            <button
              type="button"
              onClick={() => dispatch({ type: 'close' })}
              className="text-sm text-slate-500 underline underline-offset-4"
            >
              Open another
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowing(showing === 'floor' ? 'room' : 'floor')}
            aria-label={showing === 'floor' ? 'Back to this room' : 'The whole floor'}
            className="text-sm text-slate-500 underline underline-offset-4"
          >
            {showing === 'floor' ? 'This room' : 'The floor'}
          </button>
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
            className="text-sm text-slate-500 underline underline-offset-4"
          >
            {settings ? 'Close' : 'Your business'}
          </button>
        </span>
      </header>

      {settings && (
        <div className="mb-5 space-y-5">
          <Settings onClose={() => setSettings(false)} />
          {/* Beside the profile rather than beside a room: a price list belongs
              to the business, not to the job somebody happens to have open. */}
          <PriceList />
        </div>
      )}

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

      {showing === 'floor' ? (
        <Floor
          onOpenRoom={(fileName) => {
            dispatch({ type: 'restore', fileName, force: true });
            setShowing('room');
          }}
        />
      ) : !loaded ? (
        drawing ? (
          <Draw
            onDone={(room, name) => {
              dispatch({ type: 'openDrawn', room, fileName: name });
              setDrawing(false);
            }}
            onCancel={() => setDrawing(false)}
          />
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
            <div data-sheet="yes" className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div data-sheet="no" className="mb-2 flex items-baseline justify-between gap-3 px-1">
                <h2 className="text-base font-semibold text-slate-900">{loaded.room.name}</h2>
                <p className="text-sm tabular-nums text-slate-600">
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
                    damages={loaded.claim.on ? loaded.damages : []}
                    onSelect={(wallId) => dispatch({ type: 'select', wallId })}
                  />
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-slate-500">
                    {legendFor(
                      loaded.claim.on && loaded.damages.length > 0,
                      loaded.room.walls.some((wall) => isAdjusted(wall.length))
                    ).map((item) => (
                      <li key={item.label} className="flex items-center gap-1.5">
                        <span className={`inline-block h-2 w-4 rounded-sm ${item.className}`} />
                        {item.label}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <Room3D
                  room={loaded.room}
                  selected={state.selected}
                  onSelect={(wallId) => dispatch({ type: 'select', wallId })}
                />
              )}
            </div>

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
                    className="text-sm text-slate-500 underline underline-offset-4"
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

                {!selectedWall.open && (
                  <Elevation room={loaded.room} wall={selectedWall} damages={loaded.damages} />
                )}

                {loaded.claim.on && (
                  <DamageOnWall
                    room={loaded.room}
                    wall={selectedWall}
                    damages={loaded.damages}
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
                  />
                )}

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

            <Ceiling
              room={loaded.room}
              onSet={(text, how) =>
                dispatch({ type: 'ceiling', text, how, by: 'me', at: new Date().toISOString() })
              }
            />

            <Thickness
              room={loaded.room}
              selected={state.selected}
              onSet={(wallId, text, how) =>
                dispatch({ type: 'thickness', wallId, text, how, by: 'me', at: new Date().toISOString() })
              }
            />

            <div data-sheet="yes">
              <Takeoff room={loaded.room} readiness={derived.state} />
            </div>

            <Claim
              room={loaded.room}
              damages={loaded.damages}
              claim={loaded.claim}
              onChange={(claim) => dispatch({ type: 'claim', claim })}
            />

            {/* The restoration sheet, only on a job that is one, and never
                folded into the takeoff above it. Two payers, two sheets. */}
            {loaded.claim.on && <Scope room={loaded.room} damages={loaded.damages} />}

            {loaded.claim.on && (
              <ClaimSend
                room={loaded.room}
                fileName={loaded.fileName}
                damages={loaded.damages}
                claim={loaded.claim}
              />
            )}

            <Price
              room={loaded.room}
              overrides={loaded.overrides}
              onOverride={(override) => dispatch({ type: 'override', override })}
              onClearOverride={(item, unit) => dispatch({ type: 'clearOverride', item, unit })}
            />

            <JobStatus room={loaded.room} fileName={loaded.fileName} />

            <Sheet room={loaded.room} photos={loaded.photos} overrides={loaded.overrides} />

            <FieldSheet room={loaded.room} footprints={loaded.footprints} />

            <Corrections
              room={loaded.room}
              report={loaded.report}
              readiness={derived.state}
              obstructions={derived.obstructions}
              punchList={derived.punchList}
              photos={loaded.photos}
              rejectedPhotos={loaded.rejectedPhotos}
              selected={state.selected}
              onSelect={(wallId) => dispatch({ type: 'select', wallId })}
              onMake={(wallId, as) => dispatch({ type: 'make', wallId, as })}
            />

            <p className="px-1 text-xs text-slate-400 print:hidden">
              {loaded.fileName} · imported from RoomPlan v{loaded.report.sourceVersion ?? '?'} ·
              nothing here left this device · kept in this browser only, so it is not a backup
            </p>
          </div>
        )
      )}
    </main>
  );
}
