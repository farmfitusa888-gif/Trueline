import { useState } from 'react';
import { formatFeetInches, parseLength } from '../../core/src/length.ts';

/**
 * The field somebody types a tape reading into.
 *
 * One component, used everywhere a real number replaces a scanned one: a wall's
 * length, a door's width, how far a window's sill is off the floor. It reads
 * back what it understood before anything is committed, which is the whole
 * reason it is shared — the reading-back is not decoration, it is the guard
 * against `11.7` quietly meaning eleven point seven feet.
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
export function reading(text: string): { good: true; as: string; warn?: string } | { good: false; why: string } | null {
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

/**
 * What a form says when its button was pressed with the box empty.
 *
 * Pressing a button and having *nothing whatever* happen is the worst answer an
 * app can give: on a phone, in daylight, it is indistinguishable from a broken
 * app, and the person's next move is to press it harder. Every form in here
 * used to do exactly that — `if (text.trim() === '') return;` and no more.
 *
 * The complete click-through found them before a contractor did. It presses
 * every control in the app and asks whether anything on the screen moved, and
 * these were the ones where nothing did.
 *
 * The message is per box on purpose. "Type something first" is not help;
 * "Type the ceiling height before pressing Set — something like 8'" is.
 */
export function Wants({ say }: { readonly say: string | null }) {
  if (!say) return null;
  return (
    <p role="status" className="basis-full text-sm text-amber-800">
      {say}
    </p>
  );
}

/**
 * `name` is what this box measures; `label` is the hint inside it.
 *
 * They were one thing, and every box on the screen ended up named after its own
 * placeholder — "e.g. 20'". With a wall, a ceiling and a door's width open at
 * once, a screen reader announced three fields called "e.g." something and
 * three buttons called "Set", and nothing said which was which. The hint is for
 * eyes; the name is for everybody.
 */
export function Measure({
  name,
  label,
  onSubmit,
}: {
  readonly name: string;
  readonly label: string;
  readonly onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [wants, setWants] = useState<string | null>(null);
  const read = reading(text);
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() === '') {
          setWants(`Type ${name} before pressing Set — ${label.replace(/^e\.g\. /, 'something like ')}.`);
          return;
        }
        setWants(null);
        onSubmit(text.trim());
        setText('');
      }}
    >
      <input
        value={text}
        onChange={(event) => { setText(event.target.value); setWants(null); }}
        // No number keypad: 12' 3 1/2" needs the full one, and a contractor
        // types exactly that.
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={label}
        aria-label={name}
        className="min-h-12 flex-1 rounded-md border border-slate-300 px-3 py-2 tabular-nums
                   focus:border-sky-500 focus:outline-none"
      />
      <button
        type="submit"
        aria-label={`Set ${name}`}
        className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
      >
        Set
      </button>
      <Wants say={wants} />
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

