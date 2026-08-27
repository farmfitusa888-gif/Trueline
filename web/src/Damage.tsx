import { useState } from 'react';
import { parseLength } from '../../core/src/length.ts';
import type { Room, Wall } from '../../core/src/room.ts';
import { runLength } from '../../core/src/room.ts';
import {
  type Damage as Mark,
  type MarkKind,
  type Reading,
  type WaterCategory,
  CONDITION_KINDS,
  LOSS_KINDS,
  WATER_CATEGORY,
  damageQuantity,
  drying,
  isLoss,
  suggestedCut,
} from '../../core/src/damage.ts';
import type { VoiceNote } from '../../core/src/voice.ts';
import { notesOnMark } from '../../core/src/voice.ts';
import { DamagePhotos } from './DamagePhotos.tsx';
import { VoiceNotes } from './Voice.tsx';
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
 * The shapes are three because what is wrong with a wall is three things. A
 * **patch** for the region water actually makes. A **whole wall** for one that
 * has gone. A **pin** for a hole or a stain, which produces no area at all and
 * says so — a marker is not a measurement, and giving it square feet would be
 * inventing one.
 *
 * ## One screen, two jobs
 *
 * This used to be behind the insurance switch, and that was wrong. Marking is
 * not an insurance feature: a remodeler finds a soft sill plate, a wall out of
 * plumb, a chase he cannot get at, and wants exactly these three boxes on
 * exactly this wall. What differs is not the act but what happens afterwards —
 * a claim prices it as tear-out, an ordinary job puts it on the sheet somebody
 * carries and on nothing else.
 *
 * So `onClaim` changes three things and nothing else:
 *
 *   - **which words are offered.** A cause-of-loss list is what an adjuster
 *     reads and is the wrong list for a remodel; see `ConditionKind`.
 *   - **whether a cut height is asked for.** Where to cut is a tear-out
 *     decision, and nobody is tearing out a wall because it is out of plumb.
 *   - **whether an area is shown.** A square-foot figure on an ordinary job
 *     reads as work somebody has agreed to, and noticing rot is not buying its
 *     removal. The geometry is still recorded, exactly; it is simply not put in
 *     front of somebody as a quantity.
 *
 * Everything else — the shape, the note, the photograph, the recording — is the
 * same code, because it is the same thing.
 */

const LABEL: Record<MarkKind, string> = {
  water: 'Water',
  fire: 'Fire',
  smoke: 'Smoke',
  mould: 'Mould',
  impact: 'Impact',
  wind: 'Wind',
  other: 'Other',
  rot: 'Rot',
  cracked: 'Cracked',
  'out of plumb': 'Out of plumb',
  'out of level': 'Out of level',
  'previous repair': 'Previous repair',
  'no access': 'No access',
  'asbestos suspect': 'Asbestos suspect',
  note: 'Just a note',
};

export function DamageOnWall({
  room,
  wall,
  damages,
  voice,
  onClaim,
  scanName,
  onMark,
  onUnmark,
  onCutTo,
  onReading,
  onPhotos,
  onNote,
  onForget,
}: {
  readonly room: Room;
  readonly wall: Wall;
  readonly damages: readonly Mark[];
  /** What was said out loud, so a mark can carry its own recordings. */
  readonly voice: readonly VoiceNote[];
  /** Whether this job is a claim. It changes the words, not the record. */
  readonly onClaim: boolean;
  /** Which scan this is, so a photograph is filed with the room it belongs to. */
  readonly scanName: string;
  readonly onMark: (damage: Mark) => void;
  readonly onUnmark: (id: string) => void;
  readonly onCutTo: (id: string, text: string | null) => void;
  readonly onReading: (id: string, reading: Reading) => void;
  readonly onPhotos: (id: string, photos: readonly string[]) => void;
  readonly onNote: (note: VoiceNote) => void;
  readonly onForget: (noteId: string) => void;
}) {
  const { len, area } = useUnits();
  const [adding, setAdding] = useState<'patch' | 'whole' | 'pin' | null>(null);
  // Water on a claim, because it is most of them. On an ordinary job the
  // default commits to nothing — somebody marking a wall has not yet said what
  // is wrong with it, and starting them on "rot" would put a word in their
  // mouth that ends up on a sheet.
  const [kind, setKind] = useState<MarkKind>(onClaim ? 'water' : 'note');
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
        {(onClaim ? LOSS_KINDS : CONDITION_KINDS).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`min-h-11 rounded-md px-3 text-sm font-semibold ${
              kind === k
                ? 'bg-slate-900 text-white'
                : 'border border-slate-300 text-slate-700 active:bg-slate-100'
            }`}
          >
            {LABEL[k]}
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
          placeholder={
            onClaim
              ? 'water line along the bottom of the wall'
              : 'sill plate is soft under the window'
          }
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
    <div className="mt-4 border-t border-sky-200 pt-3" data-sheet="no" data-marks={wall.id}>
      <h3 className="text-sm font-semibold text-slate-900">
        {mine.length === 0
          ? 'Nothing marked on this wall'
          : `${mine.length} mark${mine.length === 1 ? '' : 's'} on this wall`}
      </h3>
      {mine.length === 0 && !onClaim && (
        <p className="mt-1 text-sm text-slate-600">
          Rot, a crack, a wall out of plumb, something you cannot get at. It goes on the sheet
          you carry and on nothing you price — the wall is already measured, so all it needs is
          where along it and how high.
        </p>
      )}

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
                    {/* An area is what a claim is arguing about. On an ordinary
                        job a square-foot figure beside a note reads as work
                        somebody has agreed to, and nobody has agreed to
                        anything by noticing rot. The geometry is recorded
                        either way and the workings say where it is.
                        `isLoss` as well as the job, because a claim turned on
                        over a room somebody already walked still carries the
                        condition notes they made — and `losses()` keeps those
                        off every insurance screen. An area shown here for a
                        mark that will never reach the claim would be a figure
                        promising work nobody is going to be paid for. */}
                    {onClaim && isLoss(damage.kind) && q.faceArea > 0n
                      ? area(2n * q.faceArea)
                      : '—'}
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

                    {patch && onClaim && isLoss(damage.kind) && (
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

                    {/* A drying curve is a water-claim instrument. Absent on
                        an ordinary job rather than greyed out — the same rule
                        the draft button keeps. */}
                    {onClaim && isLoss(damage.kind) && (
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
                    )}

                    <DamagePhotos
                      damageId={damage.id}
                      scanName={scanName}
                      photos={damage.photos}
                      onChange={(next) => onPhotos(damage.id, next)}
                    />

                    {/* And what he said about it, which is the half a
                        photograph cannot carry: why it matters, what is behind
                        it, and what he wants done. */}
                    <VoiceNotes
                      notes={notesOnMark(voice, damage.id)}
                      wallId={wall.id}
                      markId={damage.id}
                      onNote={onNote}
                      onForget={onForget}
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
                {onClaim ? '+ damaged area' : '+ part of this wall'}
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
