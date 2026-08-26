import { useEffect, useRef, useState } from 'react';
import { formatFeetInches, parseLength } from '../../core/src/length.ts';
import { type Company, letterhead } from '../../core/src/company.ts';
import { ASSEMBLIES } from '../../core/src/thickness.ts';
import { useUnits } from './units.tsx';
import { TRADES, describeTrade, tradeOf } from '../../core/src/trade.ts';

/**
 * Whose business this is.
 *
 * A homeowner handed a drawing with somebody else's brand on it is being handed
 * a tool their contractor is borrowing. With his name, his number and his
 * licence on it, it is his drawing, made by his business, and Trueline is a
 * line at the bottom. That is most of why a contractor pays for a thing like
 * this, and it costs one screen.
 *
 * Everything on it is typed once and used forever, which is why the logo is
 * kept as a `data:` URL rather than a file somewhere: a letterhead that has to
 * be fetched is a letterhead that is blank on a job site with no signal.
 */

const LOGO_LIMIT = 400_000;

function Field({
  label,
  value,
  onChange,
  hint,
  type = 'text',
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly hint?: string;
  readonly type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoCapitalize={type === 'email' ? 'off' : 'words'}
        autoCorrect="off"
        spellCheck={false}
        className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                   focus:border-sky-500 focus:outline-none"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Settings({ onClose }: { readonly onClose?: () => void }) {
  const { company, save } = useUnits();
  const [draft, setDraft] = useState<Company>(company);
  const [trouble, setTrouble] = useState<string | null>(null);
  /**
   * Whether the last press of Save landed, when there is nowhere to go after it.
   *
   * Inside the app this screen is a TAB, not a panel over a room -- so Save has
   * nothing to close and nothing moves when it is pressed. A form that swallows
   * a press is a form somebody types into twice, so it says so instead.
   */
  const [saved, setSaved] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  // Nothing is committed until Save, so the screen can be left without a
  // half-typed licence number becoming the one on the drawings.
  useEffect(() => setDraft(company), [company]);

  const set = <K extends keyof Company>(key: K, value: Company[K]) => {
    setSaved(false);
    setDraft((was) => ({ ...was, [key]: value }));
  };

  let ceilingReads: string | null = null;
  if (draft.useDefaultCeiling) {
    try {
      ceilingReads = `Reads as ${formatFeetInches(parseLength(draft.defaultCeiling, { defaultUnit: 'ft' }))}`;
    } catch (error) {
      ceilingReads = error instanceof Error ? error.message : String(error);
    }
  }

  async function takeLogo(chosen: File | undefined) {
    if (!chosen) return;
    if (chosen.size > LOGO_LIMIT) {
      setTrouble(
        `That picture is ${Math.round(chosen.size / 1000)} kB. A logo travels inside every ` +
          `drawing and every file you send, so it has to stay under ${LOGO_LIMIT / 1000} kB — ` +
          `crop it, or export it smaller.`
      );
      return;
    }
    try {
      const asData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('That picture could not be read.'));
        reader.readAsDataURL(chosen);
      });
      set('logo', asData);
      setTrouble(null);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  }

  const head = letterhead(draft);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Your business</h2>
        {/* Only when there is something to go back to. On the Business tab
            this screen IS the destination, and a Done that closed it would
            leave somebody looking at nothing. */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 px-2 text-sm text-slate-500 underline underline-offset-4"
          >
            Done
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        This goes on every drawing and everything you send a client. Typed once.
      </p>

      <div className="mt-4 space-y-3">
        <Field label="Business name" value={draft.name} onChange={(v) => set('name', v)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone" value={draft.phone} onChange={(v) => set('phone', v)} type="tel" />
          <Field label="Email" value={draft.email} onChange={(v) => set('email', v)} type="email" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Licence number"
            value={draft.licence}
            onChange={(v) => set('licence', v)}
            hint="Some states require this on anything given to a homeowner."
          />
          <Field
            label="Insurance"
            value={draft.insurance}
            onChange={(v) => set('insurance', v)}
            hint="Carrier and policy number, if you show it."
          />
        </div>
      </div>

      {/* --------------------------------------------------------- the logo */}
      <div className="mt-4">
        <span className="text-sm font-medium text-slate-700">Logo</span>
        <div className="mt-1 flex items-center gap-3">
          {draft.logo ? (
            <img
              src={draft.logo}
              alt=""
              className="h-14 w-auto max-w-[10rem] rounded border border-slate-200 object-contain"
            />
          ) : (
            <span className="flex h-14 w-24 items-center justify-center rounded border border-dashed
                             border-slate-300 text-xs text-slate-400">
              none
            </span>
          )}
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            className="sr-only"
            onChange={(event) => void takeLogo(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => file.current?.click()}
            className="min-h-11 rounded-md border border-slate-300 px-4 font-medium text-slate-700 active:bg-slate-100"
          >
            {draft.logo ? 'Change' : 'Add one'}
          </button>
          {draft.logo && (
            <button
              type="button"
              onClick={() => setDraft(({ logo: _gone, ...rest }) => rest)}
              className="min-h-11 px-2 text-sm text-slate-500 underline underline-offset-4"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ trade */}
      <div className="mt-5">
        <span className="text-sm font-medium text-slate-700">What do you do?</span>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {TRADES.map((trade) => {
            const picked = draft.trade === trade.id;
            return (
              <button
                key={trade.id}
                type="button"
                onClick={() => set('trade', trade.id)}
                aria-pressed={picked}
                className={`min-h-16 rounded-md px-4 py-2 text-left ${
                  picked
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 text-slate-700 active:bg-slate-100'
                }`}
              >
                <span className="block font-semibold">{trade.name}</span>
                <span className={`block text-xs ${picked ? 'text-slate-300' : 'text-slate-500'}`}>
                  {trade.does}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {describeTrade(tradeOf(draft.trade))}{' '}
          Like the units above, this is a way of reading: it changes the order and the words,
          never a number. A rate you set stays set if you change your mind.
        </p>
      </div>

      {/* ------------------------------------------------------------ units */}
      <div className="mt-5">
        <span className="text-sm font-medium text-slate-700">Show measurements in</span>
        <div className="mt-1 flex gap-2">
          {(['imperial', 'metric'] as const).map((which) => (
            <button
              key={which}
              type="button"
              onClick={() => set('units', which)}
              className={`min-h-12 flex-1 rounded-md px-4 font-semibold ${
                draft.units === which
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 text-slate-700 active:bg-slate-100'
              }`}
            >
              {which === 'imperial' ? `Feet and inches` : 'Metric'}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          A way of reading, not a way of recording. Nothing stored changes, and switching back
          gives you exactly the number you had.
        </p>
      </div>

      {/* ------------------------------------------------- what a room starts at */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">What a new room starts at</h3>

        <label className="mt-2 flex items-start gap-3">
          <input
            type="checkbox"
            checked={draft.useDefaultCeiling}
            onChange={(event) => set('useDefaultCeiling', event.target.checked)}
            className="mt-1 h-5 w-5 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">
            Use my own ceiling height instead of the scanner&rsquo;s
            <span className="mt-1 block text-xs text-slate-500">
              Off by default, and that is deliberate: a scanner measuring a ceiling off a wall it
              could actually see beats anybody&rsquo;s habit. Turn it on if your houses are all
              the same and you are tired of typing it. Either way it arrives marked as something
              you said, never as something anyone measured.
            </span>
          </span>
        </label>

        {draft.useDefaultCeiling && (
          <div className="mt-2 pl-8">
            <input
              value={draft.defaultCeiling}
              onChange={(event) => set('defaultCeiling', event.target.value)}
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Default ceiling height"
              className="min-h-12 w-40 rounded-md border border-slate-300 px-3 py-2 tabular-nums
                         focus:border-sky-500 focus:outline-none"
            />
            {ceilingReads && (
              <p aria-live="polite" className="mt-1 text-sm text-slate-600">
                {ceilingReads}
              </p>
            )}
          </div>
        )}

        <div className="mt-4">
          <span className="text-sm text-slate-700">Walls, unless a job says otherwise</span>
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDraft(({ defaultAssembly: _gone, ...rest }) => rest)}
              className={`min-h-12 rounded-md px-4 font-semibold ${
                draft.defaultAssembly === undefined
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 text-slate-700 active:bg-slate-100'
              }`}
            >
              Ask me
            </button>
            {ASSEMBLIES.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.label}
                onClick={() => set('defaultAssembly', a.id)}
                className={`min-h-12 rounded-md px-4 font-semibold tabular-nums ${
                  draft.defaultAssembly === a.id
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 text-slate-700 active:bg-slate-100'
                }`}
              >
                {a.short}
              </button>
            ))}
          </div>
        </div>
      </div>

      {trouble && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {trouble}
        </p>
      )}

      {head.length > 0 && (
        <div className="mt-5 rounded-lg bg-slate-100 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">On every drawing</p>
          <div className="mt-1 flex items-center gap-3">
            {draft.logo && <img src={draft.logo} alt="" className="h-9 w-auto max-w-24 object-contain" />}
            <div>
              {head.map((line, i) => (
                <p key={line} className={i === 0 ? 'font-semibold text-slate-900' : 'text-sm text-slate-600'}>
                  {line}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          save(draft);
          setSaved(true);
          onClose?.();
        }}
        className="mt-5 min-h-12 w-full rounded-md bg-slate-900 px-6 font-semibold text-white active:bg-slate-700"
      >
        Save
      </button>
      {saved && !onClose && (
        <p role="status" className="mt-2 text-center text-sm font-medium text-emerald-800">
          Saved. This goes on every drawing and everything you send a client.
        </p>
      )}
    </section>
  );
}
