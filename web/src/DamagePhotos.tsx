import { useEffect, useRef, useState } from 'react';
import { handBackDamagePhoto, insideApp } from './bridge.ts';
import { asDataUrl, fetchPhoto, forget, keep, nameFor, readied } from './photoStore.ts';

/**
 * Photographing the damage.
 *
 * The one thing in this app that cannot be recreated later. A dimension somebody
 * disputes can be re-measured — that is the whole premise of the product. A
 * water line that has been cut out and boarded over cannot be re-photographed by
 * anybody, ever, and six weeks later that photograph is the entire argument.
 *
 * So it is taken where the damage is marked, in the same breath, and it is
 * pushed straight to the app to be written into the scan's folder and backed up
 * rather than sitting in a web view's cache. Where there is no app to push it
 * to, the screen says the picture is on this device only. It never implies a
 * backup it did not make.
 *
 * `capture="environment"` is what makes the button open the rear camera on a
 * phone instead of a file browser — inside the app's web view as well as in
 * Safari. On a desktop it falls back to picking a file, which is what somebody
 * doing the paperwork from the truck actually wants.
 */

/** Where the app serves a scan's photographs from. Matches `WallPhotos.tsx`. */
const SERVED = 'photos/';

function Shot({
  name,
  onDrop,
}: {
  readonly name: string;
  readonly onDrop: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [big, setBig] = useState(false);

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    // This device's own copy first: it is the one that is certainly the right
    // bytes. The app's folder is the fallback, which is what a second phone
    // that pulled the claim out of iCloud will be reading from.
    fetchPhoto(name).then((blob) => {
      if (!alive) return;
      if (blob) {
        made = URL.createObjectURL(blob);
        setSrc(made);
      } else {
        setSrc(SERVED + name);
      }
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [name]);

  return (
    <li className="shrink-0">
      <button
        type="button"
        onClick={() => setBig(true)}
        disabled={missing || src === null}
        className="block overflow-hidden rounded-md border border-slate-300 bg-slate-100
                   disabled:opacity-60"
      >
        {missing || src === null ? (
          <span className="flex h-24 w-32 items-center justify-center px-2 text-center text-xs text-slate-500">
            {missing ? 'Not on this device' : 'Loading'}
          </span>
        ) : (
          <img
            src={src}
            alt={`Damage photograph ${name}`}
            onError={() => setMissing(true)}
            className="h-24 w-32 shrink-0 object-cover"
          />
        )}
      </button>
      <button
        type="button"
        onClick={onDrop}
        className="mt-1 min-h-11 w-full text-xs text-slate-500 underline underline-offset-4"
      >
        Take it off
      </button>

      {big && src && (
        <div
          role="dialog"
          aria-label="Damage photograph, full size"
          onClick={() => setBig(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3"
        >
          <img src={src} alt={`Damage photograph ${name}`} className="max-h-full max-w-full" />
        </div>
      )}
    </li>
  );
}

export function DamagePhotos({
  damageId,
  scanName,
  photos,
  onChange,
}: {
  readonly damageId: string;
  /** The scan this damage belongs to, so the app files the picture with it. */
  readonly scanName: string;
  readonly photos: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [told, setTold] = useState<string | null>(null);
  const backed = insideApp();

  async function take(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setTold(null);
    const added: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const name = nameFor(damageId, [...photos, ...added]);
        const blob = await readied(file);
        const stored = await keep(name, blob);
        // Handed to the app whether or not this device's own store took it —
        // the app's folder is the copy that matters, and a device that refused
        // IndexedDB is exactly the device whose cache cannot be relied on.
        const sent = handBackDamagePhoto(scanName, name, await asDataUrl(blob));
        if (!stored && !sent) {
          setTold(
            'This device would not keep that picture and there is no app here to hand it to, ' +
              'so it has not been attached. Nothing else has changed.'
          );
          continue;
        }
        added.push(name);
      }
      if (added.length > 0) onChange([...photos, ...added]);
    } catch (error) {
      setTold(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="mt-3">
      <span className="text-sm font-medium text-slate-700">Photographs</span>

      {photos.length > 0 && (
        <ul className="mt-2 flex gap-3 overflow-x-auto pb-1">
          {photos.map((name) => (
            <Shot
              key={name}
              name={name}
              onDrop={() => {
                void forget(name);
                onChange(photos.filter((x) => x !== name));
              }}
            />
          ))}
        </ul>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={(event) => void take(event.target.files)}
        className="sr-only"
        aria-label="Photograph the damage"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="mt-2 min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                   text-slate-700 active:bg-slate-100 disabled:opacity-60"
      >
        {busy ? 'Keeping it…' : photos.length === 0 ? 'Photograph it' : 'Another'}
      </button>

      <p className="mt-1 text-xs text-slate-500">
        {photos.length === 0
          ? 'The one thing here that cannot be taken again later. Once the wall is cut out and ' +
            'boarded, this photograph is the argument.'
          : backed
            ? 'Kept with the scan and backed up. Full size on the claim document.'
            : 'On this browser only — there is no app here to back it up. Full size on the ' +
              'claim document.'}
      </p>

      {told && <p className="mt-1 text-sm text-red-700">{told}</p>}
    </div>
  );
}
