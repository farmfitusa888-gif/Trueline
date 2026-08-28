import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  type VoiceAnswer,
  canRecord,
  canTranscribe,
  onVoiceable,
  startRecording,
  stopRecording,
} from './bridge.ts';
import { type VoiceNote, spokenLength } from '../../core/src/voice.ts';

/**
 * Talking at a wall, and keeping both the recording and the words.
 *
 * ## Why both, and why the text is the one that can be changed
 *
 * A contractor standing in a half-gutted bathroom has a tape in one hand and a
 * phone in the other. Typing is the thing he is least able to do and talking is
 * free — so the note gets spoken, and then two things have to be true about it
 * at once.
 *
 * **The recording is the record.** It is his voice, on the day, in the room.
 * Nothing derived from it can contradict it, and six weeks later in an argument
 * about what was agreed it is the only artefact that settles anything. It is
 * written once into the scan's own folder and never rewritten.
 *
 * **The transcript is what makes it usable.** A folder of audio clips is a
 * folder nobody opens; text goes on a sheet and into a search. It is written on
 * the phone by `SFSpeechRecognizer` — free, no key, no account, no bill, and it
 * works with no signal, which matters because the person using this is standing
 * in a basement.
 *
 * And it is **editable**, because a remodeler's vocabulary is exactly where a
 * recogniser slips. *Jamb*, *soffit*, *kerf*, *R-13*, *sill plate* — a sheet
 * that says "gym" where somebody said "jamb" is worse than a sheet with nothing
 * on it. Correcting the words changes what is printed and leaves the recording
 * untouched, which is the only arrangement in which editing is safe. Until
 * somebody has read it, it says so.
 *
 * ## And when the phone cannot do it
 *
 * The same rule `Draft.tsx` keeps, for the same reason. **No Record button, and
 * not a word about recording**, on a browser or on a phone that cannot. Not
 * greyed, not explained: absent. Somebody who cannot have it never learns it
 * exists, which is the only version that does not read as a missing feature.
 *
 * Two different absences, though, and they are not the same:
 *
 *   - **No microphone to reach** — a browser, or an app build without this. No
 *     Record button at all.
 *   - **A microphone but no transcription** — an older iOS, no on-device model
 *     for the language. The button is there and it says so *before* somebody
 *     talks for a minute, because being told afterwards reads as a failure
 *     rather than as what the phone is.
 *
 * A refused microphone is a third thing again, and it is the one that must never
 * become a dead button: the screen says which switch to turn back on, and
 * everything else on it goes on working.
 *
 * ## Notes that are already here
 *
 * Listed whether or not this device can record, which is deliberate and is the
 * same rule `WallPhotos.tsx` keeps. A room corrected on a phone and opened on a
 * laptop still has its transcripts, and hiding them because the laptop has no
 * microphone would be hiding somebody's own words from them.
 */

/** Where the app serves a scan's recordings from. See `WebBundle.swift`. */
export const VOICE_BASE = 'voice/';

/** What this device can do, kept current as the app answers. */
export function useVoice(): { readonly record: boolean; readonly transcribe: boolean } {
  const [can, setCan] = useState(() => ({ record: canRecord(), transcribe: canTranscribe() }));
  useEffect(
    () => onVoiceable(() => setCan({ record: canRecord(), transcribe: canTranscribe() })),
    []
  );
  return can;
}

/** Where the recorder is up to. Each one is a different sentence on the screen. */
type Stage =
  | { at: 'idle' }
  | { at: 'starting' }
  | { at: 'recording'; since: number }
  | { at: 'writing' }
  | { at: 'refused'; why: string };

function Elapsed({ since }: { readonly since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, []);
  // The clock on screen while somebody talks. What gets SAVED is the length of
  // the finished file, read off the file by the app — never this, which is a
  // page's idea of how long a message took to arrive.
  return <span className="font-mono tabular-nums">{spokenLength(now - since)}</span>;
}

/**
 * A box that is exactly as tall as the words in it.
 *
 * ## The complaint this closes
 *
 *     "THE TRANSCRIBING IS IN A TEXT BOX AND YOU HAVE TO SCROLL AND CANT SEE
 *      EVERYTHING."
 *
 * The transcript was a `rows={2}` textarea. A minute of talking is around a
 * hundred and eighty words, which is nine or ten lines at phone width, so what
 * somebody saw was *"…and now we're gonna replace it with another drywall piece
 * and"* and a scrollbar. That is the one artefact he will open six weeks later
 * to remember what he said, and it was being served three lines at a time
 * inside a box the page scrolls past.
 *
 * It cannot simply become a `<p>`: the phone's recogniser gets *jamb*, *soffit*,
 * *kerf* and *R-13* wrong, and correcting them is the only reason the text is
 * worth printing. So it stays a textarea and the textarea stops having a size
 * of its own — it is set, every time the words change, to exactly the height of
 * the words. Nothing is ever hidden and nothing scrolls inside it. What scrolls
 * is the page, which is where somebody's thumb already is.
 *
 * There is deliberately **no maximum**. A ten-minute recording is a tall box,
 * and a tall box you scroll the page through is how every other piece of text
 * on this screen is read; a maximum would put the scrollbar back and reintroduce
 * exactly the bug, only for the recordings where losing the end matters most.
 *
 * ## The three things that break a growing textarea
 *
 * 1. **Borders.** `scrollHeight` is content plus padding and no border, and
 *    `box-sizing: border-box` means the height set has to include them. Two
 *    pixels short clips the descenders on the last line.
 * 2. **The page jumping on every keystroke.** Zeroing the height for a frame is
 *    what lets the box SHRINK when text is deleted, and it also shortens the
 *    document for that frame. A browser scrolled near the bottom clamps its
 *    scroll position to the shorter document and does not put it back, so the
 *    page — and the caret with it — walks up the screen as somebody types. The
 *    scroll position is read before and written back after.
 * 3. **Being measured while the panel is hidden.** The wall panel is `hidden`
 *    whenever another section is on, and a hidden element has a `scrollHeight`
 *    of zero. Fitting then would collapse the box to nothing and leave it that
 *    way, because the words have not changed and no effect would run again. So
 *    a zero measurement is refused, and the width is watched instead: it goes
 *    from nothing to the panel's width the moment the section comes back, and
 *    it also changes when the phone is turned on its side.
 */
function useGrowsToFit(text: string) {
  const box = useRef<HTMLTextAreaElement | null>(null);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const doc = document.documentElement;
    const was = doc.scrollTop;
    el.style.height = 'auto';
    // Border, in the units the height is being set in. Read while the height
    // is `auto`, because `clientHeight` is the height that was just cleared.
    const edges = el.offsetHeight - el.clientHeight;
    const wanted = el.scrollHeight;
    // Hidden: nothing to measure, and measuring anyway would leave the box
    // flat forever. Left as it was until the width says it is on screen.
    if (wanted === 0) return;
    el.style.height = `${wanted + edges}px`;
    if (doc.scrollTop !== was) doc.scrollTop = was;
  }, []);

  useLayoutEffect(fit, [fit, text]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // Width only. Observing height would be observing the thing this sets,
    // and the two would chase each other for as long as the panel is open.
    let wide = -1;
    const watch = new ResizeObserver((entries) => {
      const now = entries[0]?.contentRect.width ?? -1;
      if (now === wide) return;
      wide = now;
      fit();
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [fit]);

  return box;
}

/**
 * One recording: play it, read it, fix it.
 */
function Said({
  note,
  onNote,
  onForget,
}: {
  readonly note: VoiceNote;
  readonly onNote: (note: VoiceNote) => void;
  readonly onForget: (id: string) => void;
}) {
  const [text, setText] = useState(note.transcript?.text ?? '');
  const [missing, setMissing] = useState(false);
  const machine = note.transcript?.by === 'phone';
  const box = useGrowsToFit(text);

  // A note that gained a transcript after it was drawn — the words arrive a
  // second or two after the recording does. Without this the box would still be
  // empty when they land, and somebody would type into it over the top.
  useEffect(() => {
    setText(note.transcript?.text ?? '');
  }, [note.transcript?.text]);

  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-slate-700">
          {note.recordedAt.slice(0, 10)} ·{' '}
          <span className="font-mono tabular-nums">{spokenLength(note.milliseconds)}</span>
        </span>
        <button
          type="button"
          onClick={() => onForget(note.id)}
          aria-label={`Take off the recording from ${note.recordedAt.slice(0, 10)}`}
          className="min-h-11 shrink-0 text-xs text-slate-500 underline underline-offset-4"
        >
          Take it off
        </button>
      </div>

      {missing ? (
        <p className="mt-1 text-sm text-slate-600">
          The recording is on the phone that took it. The words below are here either way.
        </p>
      ) : (
        // The app serves it out of the scan's own folder, under the same scheme
        // this page is loaded from. In a browser there is no folder and no file,
        // and the player removes itself rather than sitting there refusing to
        // play — the same rule the wall photographs keep.
        <audio
          controls
          preload="none"
          src={`${VOICE_BASE}${note.fileName}`}
          onError={() => setMissing(true)}
          aria-label={`Play what was said, ${spokenLength(note.milliseconds)} long`}
          className="mt-1 w-full"
        />
      )}

      <label className="mt-2 block">
        <span className="text-xs font-medium text-slate-700">What was said</span>
        <textarea
          ref={box}
          value={text}
          /* One line to start from. The height is set from the words on the
             very first paint, so this is only ever what an empty box is. */
          rows={1}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            const said = text.trim();
            if (said === (note.transcript?.text ?? '')) return;
            if (said === '') {
              // Emptying the box is taking the transcript off, not saving an
              // empty quotation. The recording is untouched and still plays.
              const { transcript: _gone, ...bare } = note;
              onNote(bare);
              return;
            }
            // Typing in it makes it theirs. The recording still proves what was
            // actually said, which is why this is safe to allow at all.
            onNote({
              ...note,
              transcript: { text: said, by: 'person', at: new Date().toISOString() },
            });
          }}
          placeholder={
            note.transcript === undefined
              ? 'No transcript — type what you said, or leave it and play it back'
              : ''
          }
          aria-label="What was said, as text"
          /* `overflow-hidden` is the promise: there is no scrollbar in here to
             find, because the height is always the height of the words.
             `resize-none` for the same reason — a drag handle that can only
             make the box wrong.

             `scroll-mb-32` is the on-screen keyboard. Tapping in here makes the
             browser scroll this box into view, and "into view" to a browser
             means the bottom edge of the window, which is behind the keyboard.
             Eight rem of scroll margin under it is what puts the line being
             corrected above the keys instead of under them. */
          className="mt-1 w-full resize-none overflow-hidden scroll-mb-32 rounded-md
                     border border-slate-300 px-3 py-2 text-sm leading-relaxed
                     focus:border-sky-500 focus:outline-none"
        />
      </label>

      {machine && (
        <p className="mt-1 text-xs leading-relaxed text-amber-700">
          Written by this phone, not by a person. Read it — jamb, soffit, kerf and R-13 are
          exactly the words it gets wrong, and the recording above is what actually happened.
        </p>
      )}
      {note.transcript === undefined && note.noTranscript !== undefined && (
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          No transcript — {note.noTranscript} The recording is kept either way.
        </p>
      )}
    </li>
  );
}

export function VoiceNotes({
  notes,
  wallId,
  markId,
  onNote,
  onForget,
}: {
  /** The recordings already about this wall or this mark, oldest first. */
  readonly notes: readonly VoiceNote[];
  /**
   * The surface a new recording is about: a wall id, or the ceiling's own key.
   *
   * Named `wallId` because that is what `VoiceNote` calls the field, and that
   * field is on every saved file on every phone. Most surfaces are walls; the
   * ceiling is the one that is not, and it is where the water stain is. See
   * `surfaceKey` in `work.ts` for the key, which is the same one that surface's
   * scope and its phone readings are filed under — one ceiling, one name.
   *
   * A note filed against the ceiling is refused by `validateVoiceNote` until
   * that function knows about surfaces as well as walls. Until it does, the
   * recording is lost with a message on screen rather than saved silently
   * against the wrong thing, which is the right way round of the two.
   */
  readonly wallId: string;
  /** Set when these belong to a mark, so a new one is filed with it. */
  readonly markId?: string;
  readonly onNote: (note: VoiceNote) => void;
  readonly onForget: (id: string) => void;
}) {
  const can = useVoice();
  const [stage, setStage] = useState<Stage>({ at: 'idle' });
  /**
   * The note this recording turned into, so the words can be put on it when
   * they arrive a second later.
   *
   * A ref rather than state: the answer handler is the closure that was passed
   * to `startRecording`, and it has to see what the previous answer produced
   * rather than what the component held when recording began.
   */
  const madeNow = useRef<VoiceNote | null>(null);

  // Leaving the wall panel while the microphone is live. Without this the
  // recorder would go on running with nothing on screen able to stop it.
  useEffect(() => () => stopRecording(), []);

  function hear(answer: VoiceAnswer) {
    if (answer.refused !== undefined) {
      madeNow.current = null;
      setStage({ at: 'refused', why: answer.refused });
      return;
    }
    if (answer.started === true) {
      setStage({ at: 'recording', since: Date.now() });
      return;
    }
    if (answer.kept !== undefined) {
      // The file is on disk. It goes into the room before anything is
      // transcribed, so a recogniser that never answers costs a transcript and
      // never the recording.
      const note: VoiceNote = {
        id: answer.kept.fileName,
        wallId,
        ...(markId !== undefined ? { markId } : {}),
        fileName: answer.kept.fileName,
        recordedAt: new Date().toISOString(),
        recordedBy: 'me',
        milliseconds: answer.kept.milliseconds,
      };
      madeNow.current = note;
      onNote(note);
      setStage({ at: 'writing' });
    }
    const made = madeNow.current;
    const ends = answer.transcript !== undefined || answer.noTranscript !== undefined;
    if (!ends) return;

    // Whatever the words turned out to be, the conversation is over and the
    // button goes back to being a button. Set BEFORE the note is put, and
    // unconditionally: without this, an answer arriving with no recording
    // behind it -- the 90-second give-up, or a note this instance never saw
    // kept -- would leave "Writing it down..." on screen for as long as the
    // panel stays open, which is a spinner that never ends.
    madeNow.current = null;
    setStage({ at: 'idle' });
    if (!made) return;

    if (answer.transcript !== undefined) {
      onNote({
        ...made,
        transcript: { text: answer.transcript, by: 'phone', at: new Date().toISOString() },
      });
      return;
    }
    if (answer.noTranscript !== undefined) {
      onNote({ ...made, noTranscript: answer.noTranscript });
    }
  }

  // Absent, not greyed: a browser and an older phone see the screen they have
  // always seen. What is NOT hidden is a recording somebody already made — a
  // room corrected on a phone and opened on a laptop keeps its own words.
  if (!can.record && notes.length === 0) return null;

  return (
    <div className="mt-4 border-t border-sky-200 pt-3" data-sheet="no" data-voice={wallId}>
      <h3 className="text-sm font-semibold text-slate-900">
        {notes.length === 0
          ? 'Say what is wrong with it'
          : `${notes.length} recording${notes.length === 1 ? '' : 's'}`}
      </h3>

      {notes.length > 0 && (
        <ul className="mt-1 divide-y divide-sky-200">
          {notes.map((note) => (
            <Said key={note.id} note={note} onNote={onNote} onForget={onForget} />
          ))}
        </ul>
      )}

      {can.record && (
        <div className="mt-2 print:hidden">
          {stage.at === 'recording' ? (
            <button
              type="button"
              onClick={() => stopRecording()}
              className="min-h-12 w-full rounded-md bg-red-700 px-5 font-semibold text-white
                         active:bg-red-800"
            >
              Stop — <Elapsed since={stage.since} />
            </button>
          ) : (
            <button
              type="button"
              disabled={stage.at === 'starting' || stage.at === 'writing'}
              onClick={() => {
                setStage({ at: 'starting' });
                if (!startRecording(hear)) {
                  // No app to ask after all, or one already recording. Said
                  // rather than left as a button that did nothing.
                  setStage({
                    at: 'refused',
                    why: 'Nothing was recorded. Either the app is already recording, or this ' +
                      'build cannot reach the microphone.',
                  });
                }
              }}
              className="min-h-12 w-full rounded-md border border-slate-300 px-5 font-semibold
                         text-slate-700 active:bg-slate-100 disabled:opacity-60"
            >
              {stage.at === 'starting'
                ? 'Starting…'
                : stage.at === 'writing'
                  ? 'Writing it down…'
                  : notes.length === 0
                    ? 'Record a note'
                    : 'Record another'}
            </button>
          )}

          {stage.at === 'refused' && (
            <p role="status" className="mt-2 text-sm text-red-700">
              {stage.why}
            </p>
          )}

          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {can.transcribe
              ? 'Kept in this scan’s folder and written down on this phone — nothing is sent ' +
                'anywhere. The recording travels with the scan when you send it.'
              : 'This phone keeps the recording but cannot write it down, so there will be no ' +
                'transcript. You can type one yourself under each recording.'}
          </p>
        </div>
      )}
    </div>
  );
}
