import { useState } from 'react';
import { parseLength } from '../../core/src/length.ts';
import type { Room, Wall } from '../../core/src/room.ts';
import { runLength } from '../../core/src/room.ts';
import {
  type Damage as Mark,
  type DamageKind,
  type Reading,
  type WaterCategory,
  WATER_CATEGORY,
  damageQuantity,
  drying,
  suggestedCut,
} from '../../core/src/damage.ts';
import { DamagePhotos } from './DamagePhotos.tsx';
import { forget } from './photoStore.ts';
import { Measure, Wants } from './Measure.tsx';
import { useUnits } from './units.tsx';

/**
 * Marking what is wrong with this wall.
 *
 * The reason this belongs in a measuring app and nowhere else: the wall is
 * already measured. A water line two feet up is not a note — it is eighteen
 * square feet of board and nine feet of base, worked out while somebody is
 * still standing in front of it, from a length nobody has to remember.
 *
 * The shapes are three because damage is three things. A **patch** for the
 * region water actually makes. A **whole wall** for one that has gone. A **pin**
 * for a hole or a stain, which produces no area at all and says so — a marker is
 * not a measurement, and giving it square feet would be inventing one.
 */

const KINDS: readonly { value: DamageKind; label: string }[] = [
  { value: 'water', label: 'Water' },
  { value: 'fire', label: 'Fire' },
  { value: 'smoke', label: 'Smoke' },
  { value: 'mould', label: 'Mould' },
  { value: 'impact', label: 'Impact' },
  { value: 'wind', label: 'Wind' },
  { value: 'other', label: 'Other' },
];

export function DamageOnWall({
  room,
  wall,
  damages,
  scanName,
  onMark,
  onUnmark,
  onCutTo,
  onReading,
  onPhotos,
}: {
  readonly room: Room;
  readonly wall: Wall;
  readonly damages: readonly Mark[];
  /** Which scan this is, so a photograph is filed with the room it belongs to. */
  readonly scanName: string;
  readonly onMark: (damage: Mark) => void;
  readonly onUnmark: (id: string) => void;
  readonly onCutTo: (id: string, text: string | null) => void;
  readonly onReading: (id: string, reading: Reading) => void;
  readonly onPhotos: (id: string, photos: readonly string[]) => void;
}) {
  const { len, area } = useUnits();
  const [adding, setAdding] = useState<'patch' | 'whole' | 'pin' | null>(null);
  const [kind, setKind] = useState<DamageKind>('water');
  const [category, setCategory] = useState<WaterCategory>(1);
  const [note, setNote] = useState('');
  const [wants, setWants] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [high, setHigh] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [typed, setTyped] = useState<string | null>(null);

  const mine = damages.filter((d) => {
    const shape = d.shape;
    return (
      (shape.kind === 'patch' && shape.wallId === wall.id) ||
      (shape.kind === 'surface' && shape.wallId === wall.id) ||
      (shape.kind === 'pin' && shape.wallId === wall.id)
    );
  });

  const feet = (text: string) => parseLength(text, { defaultUnit: 'ft' });

  function keep(shape: Mark['shape']) {
    if (note.trim() === '') {
      setWants('Say what the damage is first — "water staining from the supply line above".');
      return;
    }
    setWants(null);
    onMark({
      id: `${wall.id}-${kind}-${Date.now()}`,
      kind,
      shape,
      note: note.trim(),
      recordedAt: new Date().toISOString(),
      recordedBy: 'me',
      ...(kind === 'water' ? { category } : {}),
      photos: [],
      readings: [],
    });
    setAdding(null);
    setWants(null);
    setNote('');
    setFrom('');
    setTo('');
    setHigh('');
  }

  const common = (
    <>
      <Wants say={wants} />
      <div className="mt-2 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            className={`min-h-11 rounded-md px-3 text-sm font-semibold ${
              kind === k.value
                ? 'bg-slate-900 text-white'
                : 'border border-slate-300 text-slate-700 active:bg-slate-100'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {kind === 'water' && (
        <div className="mt-2">
          <span className="text-sm text-slate-700">How dirty was it?</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {([1, 2, 3] as const).map((c) => (
              <button
                key={c}
                type="button"
                title={WATER_CATEGORY[c].long}
                onClick={() => setCategory(c)}
                className={`min-h-11 rounded-md px-3 text-sm font-medium ${
                  category === c
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 text-slate-700 active:bg-slate-100'
                }`}
              >
                {WATER_CATEGORY[c].plain}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">{WATER_CATEGORY[category].long}</p>
        </div>
      )}

      <label className="mt-3 block">
        <span className="text-sm font-medium text-slate-700">What is it?</span>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="water line along the bottom of the wall"
          className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                     focus:border-sky-500 focus:outline-none"
        />
        <span className="mt-1 block text-xs text-slate-500">
          A mark nobody described is a mark nobody can act on three days later.
        </span>
      </label>
    </>
  );

  return (
    <div className="mt-4 border-t border-sky-200 pt-3" data-sheet="no">
      <h3 className="text-sm font-semibold text-slate-900">
        {mine.length === 0
          ? 'Nothing marked on this wall'
          : `${mine.length} mark${mine.length === 1 ? '' : 's'} on this wall`}
      </h3>

      {mine.length > 0 && (
        <ul className="mt-2 divide-y divide-sky-200">
          {mine.map((damage) => {
            const q = damageQuantity(room, damage);
            const curve = drying(damage);
            const showing = open === damage.id;
            const patch = damage.shape.kind === 'patch' ? damage.shape : null;
            const seenTo = patch
              ? patch.toHeight > patch.fromHeight
                ? patch.toHeight
                : patch.fromHeight
              : 0n;
            const suggestion = patch ? suggestedCut(seenTo) : undefined;

            return (
              <li key={damage.id} className="py-2">
                <button
                  type="button"
                  onClick={() => setOpen(showing ? null : damage.id)}
                  className="flex min-h-11 w-full items-baseline justify-between gap-3 text-left"
                >
                  <span className="text-slate-800">
                    {damage.kind}
                    {damage.category ? ` — ${WATER_CATEGORY[damage.category].plain}` : ''}
                    <span className="block text-xs text-slate-500">{damage.note}</span>
                  </span>
                  <span className="shrink-0 text-right font-mono tabular-nums text-slate-900">
                    {q.faceArea > 0n ? area(2n * q.faceArea) : '—'}
                    <span className="ml-2 text-xs text-slate-500 underline underline-offset-4">
                      {showing ? 'Done' : 'Open'}
                    </span>
                  </span>
                </button>

                {showing && (
                  <div className="mt-1 rounded-md bg-white/70 p-3">
                    <p className="text-sm text-slate-600">{q.workings}</p>
                    {q.baseboardRun > 0n && (
                      <p className="mt-1 text-sm text-slate-600">
                        {len(q.baseboardRun)} of baseboard in the affected run.
                      </p>
                    )}

                    {patch && (
                      <div className="mt-3">
                        <span className="text-sm font-medium text-slate-700">Cut to</span>
                        <p className="mt-1 text-xs text-slate-500">
                          What you decided, kept apart from what you saw. The damage was seen to{' '}
                          {len(seenTo)}.
                        </p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {suggestion !== undefined && (
                            <button
                              type="button"
                              onClick={() => onCutTo(damage.id, len(suggestion))}
                              className="min-h-11 rounded-md border border-slate-300 px-3 text-sm
                                         font-medium text-slate-700 active:bg-slate-100"
                            >
                              {len(suggestion)}
                            </button>
                          )}
                          {damage.cutTo !== undefined && (
                            <button
                              type="button"
                              onClick={() => onCutTo(damage.id, null)}
                              className="min-h-11 px-2 text-sm text-slate-500 underline underline-offset-4"
                            >
                              Follow the damage instead
                            </button>
                          )}
                        </div>
                        <div className="mt-2">
                          <Measure
                            name="the cut height"
                            label={`or type a cut height`}
                            onSubmit={(text) => onCutTo(damage.id, text)}
                          />
                        </div>
                      </div>
                    )}

                    <div className="mt-3">
                      <span className="text-sm font-medium text-slate-700">Moisture readings</span>
                      {curve.readings.length > 0 && (
                        <ul className="mt-1 space-y-1">
                          {curve.readings.map((r) => (
                            <li
                              key={`${r.at}-${r.value}`}
                              className="flex items-baseline justify-between gap-3 text-sm text-slate-700"
                            >
                              <span>{r.at.slice(0, 10)}</span>
                              <span className="font-mono tabular-nums">
                                {r.value} {r.scale}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-xs text-slate-500">
                        {curve.readings.length === 0
                          ? 'A drying curve is the strongest thing in a water claim — it proves ' +
                            'the work was needed and proves when it was done.'
                          : !curve.comparable
                            ? 'These are on different scales, so they are listed rather than ' +
                              'compared. Two meters are not one meter.'
                            : curve.trend === 'drying'
                              ? `Drying: ${curve.first!.value} down to ${curve.latest!.value} ${curve.latest!.scale}.`
                              : curve.trend === 'wetter'
                                ? `Getting wetter: ${curve.first!.value} up to ${curve.latest!.value} ${curve.latest!.scale}.`
                                : curve.trend === 'flat'
                                  ? 'Not moving yet.'
                                  : 'One reading so far.'}
                      </p>
                      <ReadingBox onAdd={(reading) => onReading(damage.id, reading)} />
                    </div>

                    <DamagePhotos
                      damageId={damage.id}
                      scanName={scanName}
                      photos={damage.photos}
                      onChange={(next) => onPhotos(damage.id, next)}
                    />

                    <button
                      type="button"
                      onClick={() => {
                        // The photographs go with it. A picture whose mark has
                        // been deleted is bytes nothing can reach, sitting in a
                        // store with a finite quota — and the next photograph
                        // somebody tries to take is the one that gets refused.
                        for (const name of damage.photos) void forget(name);
                        onUnmark(damage.id);
                      }}
                      className="mt-3 min-h-11 text-sm text-slate-500 underline underline-offset-4"
                    >
                      Take this mark off
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {adding === null ? (
        <div className="mt-3 flex flex-wrap gap-2 print:hidden">
          {!wall.open && (
            <>
              <button
                type="button"
                onClick={() => setAdding('patch')}
                className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                           text-slate-700 active:bg-slate-100"
              >
                + damaged area
              </button>
              <button
                type="button"
                onClick={() => setAdding('whole')}
                className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                           text-slate-700 active:bg-slate-100"
              >
                + the whole wall
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setAdding('pin')}
            className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                       text-slate-700 active:bg-slate-100"
          >
            + a spot
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-md bg-white/70 p-3 print:hidden">
          {common}

          {adding === 'patch' && (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-slate-700">
                Where along {wall.id}, and how high? It runs {len(runLength(wall))}.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  placeholder="from"
                  aria-label="From along the wall"
                  className="min-h-12 rounded-md border border-slate-300 px-2 py-2 font-mono tabular-nums
                             focus:border-sky-500 focus:outline-none"
                />
                <input
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  placeholder="to"
                  aria-label="To along the wall"
                  className="min-h-12 rounded-md border border-slate-300 px-2 py-2 font-mono tabular-nums
                             focus:border-sky-500 focus:outline-none"
                />
                <input
                  value={high}
                  onChange={(event) => setHigh(event.target.value)}
                  placeholder="up to"
                  aria-label="How high the damage reaches"
                  className="min-h-12 rounded-md border border-slate-300 px-2 py-2 font-mono tabular-nums
                             focus:border-sky-500 focus:outline-none"
                />
              </div>
              <p className="text-xs text-slate-500">
                From the corner the plan numbers this wall from. Height is off the floor — water
                starts at nothing, a roof leak does not.
              </p>
              {typed && <p className="text-sm text-red-700">{typed}</p>}
              <button
                type="button"
                onClick={() => {
                  // Parsed here, so a typo is answered next to the box it was
                  // typed in. Only a shape that actually parsed reaches the
                  // model, which then checks it against the room.
                  try {
                    const shape = {
                      kind: 'patch' as const,
                      wallId: wall.id,
                      fromAlong: feet(from),
                      toAlong: feet(to),
                      fromHeight: 0n,
                      toHeight: feet(high),
                    };
                    setTyped(null);
                    keep(shape);
                  } catch (error) {
                    setTyped(error instanceof Error ? error.message : String(error));
                  }
                }}
                className="min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                           active:bg-slate-700"
              >
                Mark it
              </button>
            </div>
          )}

          {adding === 'whole' && (
            <button
              type="button"
              onClick={() => keep({ kind: 'surface', surface: 'wall', wallId: wall.id })}
              className="mt-3 min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                         active:bg-slate-700"
            >
              Mark the whole of {wall.id}
            </button>
          )}

          {adding === 'pin' && (
            <button
              type="button"
              onClick={() => keep({ kind: 'pin', at: { x: 0n, y: 0n }, wallId: wall.id })}
              className="mt-3 min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                         active:bg-slate-700"
            >
              Mark a spot on {wall.id}
            </button>
          )}

          <button
            type="button"
            onClick={() => setAdding(null)}
            className="mt-2 min-h-11 text-sm text-slate-500 underline underline-offset-4"
          >
            Never mind
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A moisture reading, and the scale it was taken on.
 *
 * The scale is asked for rather than assumed because meters differ and this app
 * has never seen one. Two readings on two scales are listed and never compared —
 * a curve drawn across a scale change would be a fabricated trend on a document
 * somebody is paid against.
 */
function ReadingBox({ onAdd }: { readonly onAdd: (reading: Reading) => void }) {
  const [value, setValue] = useState('');
  const [scale, setScale] = useState('%MC');
  const [wants, setWants] = useState<string | null>(null);

  return (
    <form
      className="mt-2 flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const number = Number(value.trim());
        if (value.trim() === '') {
          setWants('Type the meter reading first — 18, or whatever it says.');
          return;
        }
        if (!Number.isFinite(number)) {
          setWants(`"${value.trim()}" is not a number the meter could have shown.`);
          return;
        }
        setWants(null);
        onAdd({ at: new Date().toISOString(), value: number, scale, by: 'me' });
        setValue('');
      }}
    >
      <input
        value={value}
        onChange={(event) => { setValue(event.target.value); setWants(null); }}
        inputMode="decimal"
        placeholder="reading"
        aria-label="Moisture reading"
        className="min-h-11 w-24 rounded-md border border-slate-300 px-2 py-1 font-mono tabular-nums
                   focus:border-sky-500 focus:outline-none"
      />
      <select
        value={scale}
        onChange={(event) => setScale(event.target.value)}
        aria-label="Meter scale"
        className="min-h-11 rounded-md border border-slate-300 px-2 py-1 text-sm"
      >
        <option value="%MC">%MC</option>
        <option value="points">points</option>
        <option value="wme">wme</option>
      </select>
      <button
        type="submit"
        className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                   text-slate-700 active:bg-slate-100"
      >
        Log it
      </button>
      <Wants say={wants} />
    </form>
  );
}
