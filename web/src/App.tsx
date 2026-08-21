import { useMemo, useReducer, useState } from 'react';
import { formatFeetInches } from '../../core/src/length.ts';
import { area, formatSquareFeet, isDiagonal, runLength } from '../../core/src/room.ts';
import { readiness } from '../../core/src/issue.ts';
import { DEFAULT_REACH, obstructions, punchList } from '../../core/src/obstruction.ts';
import { EMPTY, reduce } from './state.ts';
import { LEGEND, Plan } from './Plan.tsx';
import { Corrections } from './Corrections.tsx';

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

function Measure({ label, onSubmit }: { label: string; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      className="flex gap-2"
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
  const loaded = state.loaded;

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
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Trueline</h1>
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

            <Corrections
              room={loaded.room}
              report={loaded.report}
              readiness={derived.state}
              obstructions={derived.obstructions}
              punchList={derived.punchList}
              selected={state.selected}
              onSelect={(wallId) => dispatch({ type: 'select', wallId })}
              onMake={(wallId, as) => dispatch({ type: 'make', wallId, as })}
            />

            <p className="px-1 text-xs text-slate-400">
              {loaded.fileName} · imported from RoomPlan v{loaded.report.sourceVersion ?? '?'} ·
              nothing here left this device
            </p>
          </div>
        )
      )}
    </main>
  );
}
