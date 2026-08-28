import { useState } from 'react';
import type { Room } from '../../core/src/room.ts';
import type { Footprint } from '../../core/src/obstruction.ts';
import type { Mark } from '../../core/src/damage.ts';
import type { VoiceNote } from '../../core/src/voice.ts';
import { fieldList } from '../../core/src/fieldlist.ts';

/**
 * The list, off the screen and into a pocket.
 *
 * "Measure these first" has been living on a page somebody would have to keep
 * open while holding a tape. Nobody does that. What is needed walking into a
 * room is four lines and somewhere to write, so this is the same list as text —
 * copy it, send it to whoever is going, or print it.
 *
 * The text itself comes from `core`, not from here. A list generated in a
 * component is a list that will disagree with the screen.
 */

export interface FieldSheetProps {
  readonly room: Room;
  readonly footprints: readonly Footprint[];
  /**
   * What is marked on the walls, so it goes back into the room with somebody.
   *
   * On a claim the marks are also on the claim document, which an adjuster reads
   * at a desk. On an ordinary job there is no such document, and until this the
   * only way to read a condition note was to tap the wall it is on — which is
   * not something anybody does while standing on a ladder.
   */
  readonly marks?: readonly Mark[];
  /** And what was said out loud about each of them. */
  readonly voice?: readonly VoiceNote[];
}

type Told = 'copied' | 'nope' | null;

export function FieldSheet({ room, footprints, marks = [], voice = [] }: FieldSheetProps) {
  const [open, setOpen] = useState(false);
  const [told, setTold] = useState<Told>(null);
  const list = fieldList(room, footprints, {
    at: new Date().toLocaleDateString(),
    marks,
    voice,
  });

  // A room with every wall measured and nothing marked on it has nothing to
  // carry. One with marks on it does, even when there is no wall left worth a
  // tape — which is exactly the state a finished remodel walk is in.
  if (list.lines.length === 0 && list.marks.length === 0) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(list.text);
      setTold('copied');
    } catch {
      // Clipboard access is refused outside a secure context and in some
      // browsers. Saying so beats a button that does nothing -- and the
      // sentence it says names the list below, so the list has to BE below.
      // Told to select it by hand while it is still folded away, somebody is
      // being pointed at nothing, on the one path where the button could not
      // do its job and the words are all there is.
      setOpen(true);
      setTold('nope');
    }
  }

  async function share() {
    // Web Share is what puts this into Messages on an iPhone, which is how it
    // actually reaches whoever is holding the tape.
    if (!navigator.share) {
      void copy();
      return;
    }
    try {
      await navigator.share({ title: list.title, text: list.text });
    } catch {
      // A cancelled share is not a failure, and neither is one the browser
      // refused. Either way there is nothing to report.
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 border-l-4 border-l-slate-900 bg-white p-4 shadow-sm print:border-0 print:shadow-none">
      <div className="flex items-baseline justify-between gap-3 print:hidden">
        <h3 className="text-sm font-semibold text-slate-900">Take this list with you</h3>
        <button
          type="button"
          onClick={() => {
            const next = !open;
            setOpen(next);
            // The refused-copy line below says the list is below. Folding the
            // list away makes that sentence false, so it goes away with it.
            // "Copied" is about the clipboard and stays either way.
            if (!next && told === 'nope') setTold(null);
          }}
          /* Sam asked for a way back off every menu that drops down. This one
             had one — the same control says Hide once it is open — and had
             none of the rest of it: no `aria-expanded`, so nothing announced
             that it opened anything, and a target no taller than the one
             line of small text written on it.
             The words stay Show and Hide rather than becoming Open and Close:
             `a22-voice.mjs` presses this button by the word Show, and that
             part is not this one's to edit. */
          aria-expanded={open}
          aria-controls="the-field-list"
          className="inline-flex min-h-12 items-center gap-1 text-sm text-slate-500
                     underline underline-offset-4"
        >
          {open ? 'Hide' : 'Show'}
          <svg
            viewBox="0 0 16 16" aria-hidden="true"
            className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor"
                  strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 print:hidden">
        {list.lines.length > 0 &&
          `${list.lines.length} wall${list.lines.length === 1 ? '' : 's'}, a tape, two minutes. ` +
            'Type the numbers back in when you get back and the room re-solves around them. '}
        {list.marks.length > 0 &&
          `Everything marked on these walls is on it too — ${list.marks.length} of them, with ` +
            'what was said about each, and no quantities: noticing something is not the same as ' +
            'being paid to fix it.'}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => void share()}
          className="min-h-11 rounded-md bg-slate-900 px-4 py-2 font-medium text-white active:bg-slate-700"
        >
          Send it
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-11 rounded-md border border-slate-300 bg-slate-50 px-4 py-2 font-medium text-slate-900 active:bg-slate-200"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-11 rounded-md border border-slate-300 bg-slate-50 px-4 py-2 font-medium text-slate-900 active:bg-slate-200"
        >
          Print
        </button>
      </div>

      {told && (
        <p role="status" className="mt-2 text-sm text-slate-600 print:hidden">
          {told === 'copied'
            ? 'Copied. Paste it into a message or a note.'
            : 'This browser would not let the page copy. The list is below — select it and copy by hand.'}
        </p>
      )}

      {/* Always in the document so printing works whether or not it is expanded
          on screen; hidden visually until asked for. */}
      <pre
        id="the-field-list"
        className={`mt-3 overflow-x-auto whitespace-pre rounded-md bg-slate-50 p-3 font-mono text-[13px]
                    leading-snug text-slate-800 print:block print:bg-white print:p-0 print:text-black
                    ${open ? '' : 'hidden'}`}
      >
        {list.text}
      </pre>
    </section>
  );
}
