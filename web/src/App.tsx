import { useEffect, useMemo, useReducer, useState } from 'react';
import { formatFeetInches, parseLength } from '../../core/src/length.ts';
import { area, formatSquareFeet, isDiagonal, runLength } from '../../core/src/room.ts';
import { readiness } from '../../core/src/issue.ts';
import { DEFAULT_REACH, obstructions, punchList } from '../../core/src/obstruction.ts';
import { EMPTY, persist, reduce } from './state.ts';
import { installBridge } from './bridge.ts';
import { LEGEND, Plan } from './Plan.tsx';
import { Corrections } from './Corrections.tsx';
import { FieldSheet } from './FieldSheet.tsx';
import { Mark } from './Mark.tsx';
import { Room3D } from './Room3D.tsx';

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

/**
 * What the app made of what was typed, before it is committed to anything.
 *
 * `11.7` parses, and it means eleven point seven feet — 11' 8 3/8". Somebody
 * standing in a kitchen who writes `11.7` on a pad means eleven foot seven, and
 * the difference is an inch and three eighths that nothing downstream would
 * ever question, because a measured wall is treated as exact from then on.
 *
 * This is not a fixed parser. Guessing which of the two a person meant would be
 * inventing a measurement, which is the one thing this product must never do.
 * So it shows the reading back instead, in the units it understood, while there
 * is still a chance to disagree with it.
 */
function reading(text: string): { good: true; as: string; warn?: string } | { good: false; why: string } | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  try {
    const as = formatFeetInches(parseLength(trimmed, { defaultUnit: 'ft' }));
    // A bare decimal is the one that bites, because it is also how somebody
    // writes feet and inches in a hurry.
    const bare = /^\d+\.\d+$/.test(trimmed);
    const [feet, rest] = bare ? trimmed.split('.') : [];
    return bare && rest !== undefined && Number(rest) < 12
      ? { good: true, as, warn: `For ${feet} foot ${Number(rest)} type ${feet}'${Number(rest)}"` }
      : { good: true, as };
  } catch (error) {
    return { good: false, why: error instanceof Error ? error.message : String(error) };
  }
}

function Measure({ label, onSubmit }: { label: string; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  const read = reading(text);
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() === '') return;
        onSubmit(text.trim());
        setText('');
      }}
    >
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        // No number keypad: 12' 3 1/2" needs the full one, and a contractor
        // types exactly that.
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={label}
        aria-label={label}
        className="min-h-12 flex-1 rounded-md border border-slate-300 px-3 py-2 tabular-nums
                   focus:border-sky-500 focus:outline-none"
      />
      <button
        type="submit"
        className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
      >
        Set
      </button>
      {read && (
        <p
          aria-live="polite"
          className={`basis-full text-sm ${read.good ? 'text-slate-700' : 'text-red-700'}`}
        >
          {read.good ? (
            <>
              <span className="tabular-nums">Reads as {read.as}</span>
              {read.warn && <span className="text-amber-700"> — {read.warn}</span>}
            </>
          ) : (
            read.why
          )}
        </p>
      )}
    </form>
  );
}

function Opener({ onOpen }: { onOpen: (json: unknown, fileName: string) => void }) {
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
    </div>
  );
}

export function App() {
  const [state, dispatch] = useReducer(reduce, EMPTY);
  const [saveTrouble, setSaveTrouble] = useState<string | null>(null);
  // Plan or room. The same model, the same selection, the same tape box under
  // both — switching view never changes what is being measured.
  const [look, setLook] = useState<'plan' | 'room'>('plan');
  const loaded = state.loaded;

  // Let the scanner in — and pick up whatever was being corrected last time.
  // A capture handed over at start-up wins: somebody who has just finished
  // walking a room wants that room, not the one they were looking at yesterday.
  useEffect(() => {
    const waiting = installBridge(dispatch);
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

  const derived = useMemo(() => {
    if (!loaded) return null;
    const blocking = obstructions(loaded.room, loaded.footprints, DEFAULT_REACH);
    return {
      state: readiness(loaded.room),
      obstructions: blocking,
      punchList: punchList(loaded.room, loaded.footprints, DEFAULT_REACH, 8),
      area: area(loaded.room),
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
        {loaded && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'close' })}
            className="text-sm text-slate-500 underline underline-offset-4"
          >
            Open another
          </button>
        )}
      </header>

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

      {!loaded ? (
        <Opener
          onOpen={(json, fileName) =>
            dispatch({ type: 'open', json, fileName, at: new Date().toISOString() })
          }
        />
      ) : (
        derived && (
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
                <h2 className="text-base font-semibold text-slate-900">{loaded.room.name}</h2>
                <p className="text-sm tabular-nums text-slate-600">
                  {formatSquareFeet(derived.area.value)}
                </p>
              </div>

              <div
                role="tablist"
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
                    selected={state.selected}
                    obstructions={derived.obstructions}
                    footprints={loaded.footprints}
                    onSelect={(wallId) => dispatch({ type: 'select', wallId })}
                  />
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-slate-500">
                    {LEGEND.map((item) => (
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
                    {formatFeetInches(runLength(selectedWall))}
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
                  label={`e.g. ${formatFeetInches(runLength(selectedWall))}`}
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
