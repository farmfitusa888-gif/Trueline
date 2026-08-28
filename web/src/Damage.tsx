import { useRef, useState } from 'react';
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
 *
 * ## How a patch is asked for, and why it changed
 *
 * > "'FROM' 'TO' 'UPTO' MAKES NO SENSE MAKE IT EASY AND UNDERSTANDABLE."
 *
 * It asked for three numbers in boxes labelled `from`, `to` and `up to`, under
 * a line about "the corner the plan numbers this wall from". Every one of those
 * is the model's vocabulary rather than the trade's. `from` and `to` are
 * coordinates along a wall; nobody standing at a wall says a coordinate. And
 * the corner sentence named no corner anybody could find.
 *
 * **The middle box was the one that actually cost something.** With a tape
 * hooked in a corner, the start of a patch is read straight off the tape — but
 * "to" is the far end *as a coordinate*, so a four-foot patch starting three
 * feet in has to be typed as `7`. That is a sum, done in the head, usually at
 * the top of a ladder, and it is a sum nothing afterwards can catch: `7` is a
 * perfectly valid coordinate and the mark simply comes out the wrong size.
 *
 * So it asks for what a person measures and says out loud — where it starts,
 * **how wide it is**, how high it goes — and does the addition here. Three
 * boxes stayed three boxes because position is genuinely needed: the elevation
 * draws the patch where it is and the plan puts a marker on it, so a width with
 * no position would stack every mark in the corner. What changed is that all
 * three are now tape readings of the thing itself rather than two coordinates
 * and a height.
 *
 * **Nothing about the record moved.** A patch is still `fromAlong`, `toAlong`
 * and a height off the floor, in exact nanometres, and `validateDamage` checks
 * exactly what it always did. This is the words and the shape of the asking.
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
  /**
   * The description box, so a refusal can put the cursor in the thing it is
   * asking for.
   *
   * Sam pressed "Mark a spot on wall-5" and nothing happened. The button was
   * working perfectly: `keep` refuses a mark with no description, and said so —
   * at the TOP of the panel, several screens above the button he was pressing.
   * From where his thumb was, a working refusal and a dead button look exactly
   * the same. So the message now also appears beside the button that was
   * refused, and the cursor goes into the empty box.
   */
  const noteBox = useRef<HTMLInputElement | null>(null);
  const [startsAt, setStartsAt] = useState('');
  const [wide, setWide] = useState('');
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

  /**
   * How tall this wall stands, for the prompt above the boxes.
   *
   * A pony wall carries its own height and everything else takes the room's,
   * which is the same pair `validateDamage` checks a patch against. It is in
   * the prompt because "how high up the wall it goes" is a question with a
   * ceiling on it, and being told the ceiling afterwards — by a refusal — is
   * being told it too late.
   */
  const standsAt = (wall.height ?? room.ceilingHeight).value;

  /**
   * The wall this one shares its starting corner with.
   *
   * "From the corner the plan numbers this wall from" is true and is unusable:
   * it names no corner a person standing in the room can find. A room's walls
   * are walked in order and each starts where the one before it ended — see
   * `corners` — so the corner a patch is measured from is the corner this wall
   * makes with the wall before it, and that is a corner somebody can put a
   * thumb on. Renaming a wall replaces its id, so once he has called one "the
   * window wall" the sentence says so too.
   */
  const cornerWith = (() => {
    const index = room.walls.findIndex((w) => w.id === wall.id);
    if (index < 0 || room.walls.length < 2) return null;
    const before = room.walls[(index - 1 + room.walls.length) % room.walls.length];
    return before && before.id !== wall.id ? before.id : null;
  })();

  function keep(shape: Mark['shape']) {
    if (note.trim() === '') {
      setWants('Say what the damage is first — "water staining from the supply line above".');
      // Into the box, and on screen. A refusal somebody cannot see is a button
      // that does not work, whatever the code is doing.
      noteBox.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      noteBox.current?.focus({ preventScroll: true });
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
    setStartsAt('');
    setWide('');
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
          ref={noteBox}
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
          where it starts, how wide it is and how high it goes.
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
                  // A disclosure has to say that it is one, and to what it is
                  // open. This row did neither: the only sign was the word
                  // "Open" in 12px grey beside an em-dash, and no
                  // `aria-expanded` at all — so a screen reader announced a
                  // button that gave no hint anything was behind it.
                  //
                  // Sam: "I CAN ADD A MARK BUT CANNOT ATTACH A PHOTOGRAPH TO
                  // IT." He could. "Photograph it" is inside this row, and
                  // nothing on the closed row said so. A control nobody can
                  // find is a control that does not exist, and the photograph
                  // is the one thing on a damage mark that cannot be taken
                  // again once the wall is boarded.
                  aria-expanded={showing}
                  className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
                >
                  <span className="text-slate-800">
                    {damage.kind}
                    {damage.category ? ` — ${WATER_CATEGORY[damage.category].plain}` : ''}
                    <span className="block text-xs text-slate-500">{damage.note}</span>
                    {/* On the closed row, because it is what a person needs to
                        know without opening anything: a mark with no
                        photograph on it is the one that loses an argument. */}
                    <span
                      className={`mt-0.5 block text-xs ${
                        damage.photos.length === 0 ? 'font-medium text-amber-800' : 'text-slate-500'
                      }`}
                    >
                      {damage.photos.length === 0
                        ? 'No photograph yet — open it to take one'
                        : `${damage.photos.length} photograph${damage.photos.length === 1 ? '' : 's'}`}
                    </span>
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
                    {/* "Close", not "Done" — Sam asked for a way to collapse
                        every menu back, and "Done" beside a damage mark reads
                        like finishing the mark rather than shutting a drawer. */}
                    <span className="ml-2 inline-flex items-center gap-1 rounded-md border
                                     border-slate-300 px-2 py-1 text-xs font-medium text-slate-700">
                      {showing ? 'Close' : 'Open'}
                      <svg
                        viewBox="0 0 16 16" aria-hidden="true"
                        className={`h-3 w-3 transition-transform ${showing ? 'rotate-180' : ''}`}
                      >
                        <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor"
                              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
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
                How big is it, and where on {wall.id}? {wall.id} runs {len(runLength(wall))} and
                stands {len(standsAt)} high.
              </p>
              {/* Three rows rather than three columns. At 430 px a row of three
                  boxes leaves room for a word above each and nothing more,
                  which is how they came to be labelled "from", "to" and
                  "up to" in the first place. */}
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">How far from the corner it starts</span>
                  <input
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                    inputMode="text"
                    placeholder={`e.g. 3'`}
                    aria-label={`How far from the corner it starts, along ${wall.id}`}
                    className="min-h-12 w-28 shrink-0 rounded-md border border-slate-300 px-2 py-2
                               text-right font-mono tabular-nums
                               focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">How wide it is</span>
                  <input
                    value={wide}
                    onChange={(event) => setWide(event.target.value)}
                    inputMode="text"
                    placeholder={`e.g. 4'`}
                    aria-label={`How wide it is, along ${wall.id}`}
                    className="min-h-12 w-28 shrink-0 rounded-md border border-slate-300 px-2 py-2
                               text-right font-mono tabular-nums
                               focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">How high up the wall it goes</span>
                  <input
                    value={high}
                    onChange={(event) => setHigh(event.target.value)}
                    inputMode="text"
                    placeholder={`e.g. 2'`}
                    aria-label={`How high up the wall it goes, on ${wall.id}`}
                    className="min-h-12 w-28 shrink-0 rounded-md border border-slate-300 px-2 py-2
                               text-right font-mono tabular-nums
                               focus:border-sky-500 focus:outline-none"
                  />
                </label>
              </div>
              <p className="text-xs text-slate-500">
                {cornerWith
                  ? `Hook your tape in the corner where ${wall.id} meets ${cornerWith}, and ` +
                    `measure along ${wall.id} from there.`
                  : `Measure along ${wall.id} from the corner the plan numbers it from.`}{' '}
                Height is off the floor — water starts at nothing, a roof leak does not.
              </p>
              {typed && <p className="text-sm text-red-700">{typed}</p>}
              <button
                type="button"
                onClick={() => {
                  // Parsed here, so a typo is answered next to the box it was
                  // typed in. Only a shape that actually parsed reaches the
                  // model, which then checks it against the room.
                  try {
                    // The two ends, worked out from the two things somebody
                    // standing at the wall actually has in his hand: where the
                    // patch starts and how big it is. The record is unchanged —
                    // a patch is still two positions along the wall and a
                    // height off the floor — and the addition happens here, in
                    // exact nanometres, rather than in his head at the top of a
                    // ladder.
                    const at = feet(startsAt);
                    const shape = {
                      kind: 'patch' as const,
                      wallId: wall.id,
                      fromAlong: at,
                      toAlong: at + feet(wide),
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
              <Wants say={wants} />
            </div>
          )}

          {adding === 'whole' && (
            <>
            <button
              type="button"
              onClick={() => keep({ kind: 'surface', surface: 'wall', wallId: wall.id })}
              className="mt-3 min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                         active:bg-slate-700"
            >
              Mark the whole of {wall.id}
            </button>
            <Wants say={wants} />
            </>
          )}

          {adding === 'pin' && (
            <>
            <button
              type="button"
              onClick={() => keep({ kind: 'pin', at: { x: 0n, y: 0n }, wallId: wall.id })}
              className="mt-3 min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                         active:bg-slate-700"
            >
              Mark a spot on {wall.id}
            </button>
            <Wants say={wants} />
            </>
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
