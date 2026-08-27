import { useEffect, useState } from 'react';
import { askForDraft, canDraft, onDraftable } from './bridge.ts';

/**
 * A sentence written on the phone, into the box somebody was already typing in.
 *
 * ## The two rules every use of this obeys
 *
 * **It never produces a number.** The notes handed over are figures this app
 * has already worked out in `core/` — square feet, feet of base, a damage kind,
 * a meter reading. The model orders them into English. `Draftsman.Job` on the
 * Swift side tells it, in as many words, never to invent, change, round or add
 * a figure, and there is no path by which this screen could tell it anything
 * else: the instruction is not sent from here.
 *
 * **A person reads it before it goes anywhere.** The draft lands in the same
 * box that was always there and is marked as a draft until somebody types in
 * it. Nothing a model wrote reaches a proposal, a claim or a client without
 * having been read as the exact text that will go out.
 *
 * ## And when the phone cannot do it
 *
 * There is no button. Not greyed, not explained — absent, along with every
 * word about it. On a browser, on an older iPhone, on a phone with Apple
 * Intelligence switched off, these screens are exactly what they have always
 * been. Somebody who cannot have it never learns it exists, which is the only
 * version that does not read as a missing feature.
 */

/** Whether this phone can write a sentence, kept current as the app answers. */
export function useDraftable(): boolean {
  const [can, setCan] = useState(canDraft);
  useEffect(() => onDraftable(() => setCan(canDraft())), []);
  return can;
}

export function DraftButton({
  job,
  notes,
  onWritten,
  label = 'Write a first draft',
  busyLabel = 'Writing…',
}: {
  readonly job: 'scope' | 'loss' | 'mark' | 'columns';
  /**
   * The figures, as lines. Built by the caller from the room, never typed by
   * anybody and never an instruction — see the note at the top of this file.
   *
   * A function rather than a string so the notes are gathered at the moment
   * somebody asks, not on every render of a screen with a takeoff on it.
   */
  readonly notes: () => string;
  readonly onWritten: (text: string) => void;
  readonly label?: string;
  readonly busyLabel?: string;
}) {
  const can = useDraftable();
  const [busy, setBusy] = useState(false);
  const [nothing, setNothing] = useState(false);
  if (!can) return null;

  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setNothing(false);
          void askForDraft(job, notes())
            .then((written) => {
              if (written) onWritten(written);
              else setNothing(true);
            })
            .finally(() => setBusy(false));
        }}
        className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                   text-slate-700 active:bg-slate-100 disabled:opacity-60"
      >
        {busy ? busyLabel : label}
      </button>
      {nothing && (
        <span className="text-xs text-slate-500">
          Nothing came back that time. Try again, or write it yourself — the box is yours either
          way.
        </span>
      )}
    </span>
  );
}

/**
 * The line that sits under a box holding something nobody has read yet.
 *
 * Shown until somebody types in the box. It is not a disclaimer for its own
 * sake: what goes out under a contractor's name is his sentence, and this is
 * the difference between a draft and a sentence.
 */
export function DraftedNote({ showing }: { readonly showing: boolean }) {
  if (!showing) return null;
  return (
    <p className="mt-1 text-xs leading-relaxed text-amber-700">
      Drafted on this phone from the figures above. Read it and change anything that is not how
      you would put it — it goes out under your name, not the app's.
    </p>
  );
}
