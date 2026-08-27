import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { handBackDamagePhoto, insideApp } from './bridge.ts';
import {
  asDataUrl,
  fetchPhoto,
  forget,
  heldPhotos,
  keep,
  nameFor,
  photosOnClaim,
  readied,
  watchClaimPhotos,
} from './photoStore.ts';
import { type Deletion, plannedDeletion } from '../../core/src/photo.ts';

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
 *
 * ## Taking several off at once, and the 53 photographs
 *
 * A walk takes fifty photographs. Taking them off one at a time, on a phone, is
 * not something anybody can use, so several can be picked and deleted in one
 * go. That control is the most destructive thing in this product, and it is
 * built as if that is true, because it is:
 *
 * > A room with 53 photographs was deleted by accident. A rename had not shown
 * > up on the room screen, so the thing on screen was not the thing that went,
 * > and there was no way to tell one file from another before it was too late.
 *
 * Everything that came out of that is here. How many are picked is said in
 * words and never left to be counted off the highlighting. What goes with them
 * — the claim document, the last picture on a mark, the only copy on this
 * device — is named before anything happens, by `plannedDeletion` in the model
 * rather than by this screen, so it is tested rather than believed. And they
 * can be put back: the bytes are held until the screen is left, and the
 * confirmation says exactly that rather than implying a net that is not there.
 */

/** Where the app serves a scan's photographs from. Matches `WallPhotos.tsx`. */
const SERVED = 'photos/';

function Shot({
  name,
  which,
  outOf,
  picking,
  picked,
  onPick,
  onDrop,
}: {
  readonly name: string;
  /** Its place in the strip, so a picker has something to say out loud. */
  readonly which: number;
  readonly outOf: number;
  readonly picking: boolean;
  readonly picked: boolean;
  readonly onPick: () => void;
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
        onClick={() => (picking ? onPick() : setBig(true))}
        disabled={!picking && (missing || src === null)}
        {...(picking
          ? { 'aria-pressed': picked, 'aria-label': `Photograph ${which} of ${outOf}` }
          : {})}
        className={`block overflow-hidden rounded-md border bg-slate-100 disabled:opacity-60 ${
          picked ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-300'
        }`}
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

      {picking ? (
        // In words as well as in the ring around it. Somebody who cannot tell
        // two borders apart still has to be able to see what is about to go.
        <span
          className={`mt-1 block text-center text-xs font-medium ${
            picked ? 'text-slate-900' : 'text-slate-400'
          }`}
        >
          {picked ? 'Picked' : 'Not picked'}
        </span>
      ) : (
        <button
          type="button"
          onClick={onDrop}
          className="mt-1 min-h-11 w-full text-xs text-slate-500 underline underline-offset-4"
        >
          Take it off
        </button>
      )}

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
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState<Deletion | null>(null);
  const [gone, setGone] = useState<{
    readonly names: readonly string[];
    readonly before: readonly string[];
  } | null>(null);
  const backed = insideApp();

  // What a claim document has on it at this moment, straight from the list that
  // prints it. See `showingOnClaim` — it can only ever understate, so this
  // confirmation is never able to invent a use that is not there.
  const onTheClaim = useSyncExternalStore(watchClaimPhotos, photosOnClaim);

  /**
   * Photographs deleted but not yet dropped, so "Put them back" is real.
   *
   * A ref rather than state, because the thing that must not be missed is
   * dropping them when this screen goes away. A picture whose mark no longer
   * names it is bytes nothing can reach, sitting in a store with a finite
   * quota, and the next photograph somebody tries to take is the one that gets
   * refused.
   */
  const owed = useRef<readonly string[]>([]);
  useEffect(() => {
    const drop = () => {
      for (const name of owed.current) void forget(name);
      owed.current = [];
    };
    // `pagehide` as well as unmount, because a reload and a swipe out of the web
    // view never unmount anything. Without it, deleting with the undo bar still
    // up and then reloading leaves bytes in the store that no mark names — the
    // quota fills, and the photograph that gets refused is a future one nobody
    // can take again.
    window.addEventListener('pagehide', drop);
    return () => {
      window.removeEventListener('pagehide', drop);
      drop();
    };
  }, []);

  // Which of these this device is holding, so the confirmation can say whether
  // "deleted" means gone. Asked again whenever the strip changes.
  useEffect(() => {
    let alive = true;
    void heldPhotos(photos).then((here) => {
      if (alive) setHeld(here);
    });
    return () => {
      alive = false;
    };
  }, [photos]);

  function flush() {
    for (const name of owed.current) void forget(name);
    owed.current = [];
  }

  /** Takes a set off, keeping the bytes until this screen is left or it is undone. */
  function remove(going: readonly string[], staying: readonly string[]) {
    const before = photos;
    // Only one lot can be put back at a time. The older lot has had its chance,
    // and holding two would mean a "Put them back" that puts back the wrong one.
    flush();
    owed.current = going;
    setGone({ names: going, before });
    setAsking(null);
    setPicking(false);
    setPicked(new Set());
    onChange(staying);
  }

  function putBack() {
    if (!gone) return;
    owed.current = [];
    // The strip as it was, plus anything attached since. Undoing a delete must
    // not quietly take away a photograph somebody added while the bar was up.
    const back = [...gone.before, ...photos.filter((name) => !gone.before.includes(name))];
    setGone(null);
    onChange(back);
  }

  function ask(names: readonly string[]) {
    try {
      setAsking(
        plannedDeletion({
          onMark: photos,
          picked: names,
          onClaim: photos.filter((name) => onTheClaim.has(name)),
          held: [...held],
          filedWithScan: backed,
        })
      );
      setTold(null);
    } catch (error) {
      // A refusal from the model is shown as it was written. It means what is on
      // the screen and what is about to be deleted have come apart, which is the
      // one state in which nothing may be taken off at all.
      setAsking(null);
      setTold(error instanceof Error ? error.message : String(error));
    }
  }

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

  // In the strip's order, never the order somebody tapped. What the button says
  // and what actually goes have to be one list, read the same way round.
  const inOrder = photos.filter((name) => picked.has(name));
  const count = inOrder.length === 1 ? '1 photograph' : `${inOrder.length} photographs`;

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-700">Photographs</span>
        {photos.length > 1 && !picking && (
          <button
            type="button"
            onClick={() => {
              setPicking(true);
              setPicked(new Set());
              setAsking(null);
            }}
            className="min-h-11 text-sm text-slate-600 underline underline-offset-4"
          >
            Pick several
          </button>
        )}
      </div>

      {picking && (
        <div className="mt-2 rounded-md border border-slate-300 bg-slate-50 p-2">
          {/* The count, in words, from the set that is actually going. Never a
              number somebody has to work out by looking at which ones are
              ringed — that is exactly how 53 photographs went. */}
          <p className="text-sm font-medium text-slate-900">
            {inOrder.length} of {photos.length} picked
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setPicked(new Set(photos))}
              className="min-h-11 text-sm text-slate-600 underline underline-offset-4"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="min-h-11 text-sm text-slate-600 underline underline-offset-4"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                setPicking(false);
                setPicked(new Set());
                setAsking(null);
              }}
              className="min-h-11 text-sm text-slate-600 underline underline-offset-4"
            >
              Done picking
            </button>
            {inOrder.length > 0 && (
              <button
                type="button"
                onClick={() => ask(inOrder)}
                className="min-h-11 rounded-md bg-red-700 px-3 text-sm font-semibold text-white
                           active:bg-red-800"
              >
                Delete {count}
              </button>
            )}
          </div>
        </div>
      )}

      {asking && (
        <div
          role="alertdialog"
          aria-label="Before these photographs go"
          className="mt-2 rounded-md border border-red-300 bg-red-50 p-3"
        >
          <p className="text-sm font-semibold text-red-900">{asking.headline}</p>
          <ul className="mt-1 space-y-1">
            {asking.inUse.map((line) => (
              <li key={line} className="text-sm text-red-900">
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-red-900">{asking.finality}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => remove(asking.going, asking.staying)}
              className="min-h-11 rounded-md bg-red-700 px-3 text-sm font-semibold text-white
                         active:bg-red-800"
            >
              Delete them
            </button>
            <button
              type="button"
              onClick={() => setAsking(null)}
              className="min-h-11 rounded-md border border-slate-400 px-3 text-sm font-medium
                         text-slate-700 active:bg-slate-100"
            >
              Keep them
            </button>
          </div>
        </div>
      )}

      {gone && (
        <div role="status" className="mt-2 rounded-md border border-slate-300 bg-white p-3">
          <p className="text-sm text-slate-900">
            {gone.names.length === 1 ? '1 photograph' : `${gone.names.length} photographs`} deleted.
            They can go back until you leave this screen.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={putBack}
              className="min-h-11 rounded-md border border-slate-400 px-3 text-sm font-semibold
                         text-slate-900 active:bg-slate-100"
            >
              Put them back
            </button>
            <button
              type="button"
              onClick={() => {
                flush();
                setGone(null);
              }}
              className="min-h-11 text-sm text-slate-600 underline underline-offset-4"
            >
              Leave them off
            </button>
          </div>
        </div>
      )}

      {photos.length > 0 && (
        <ul className="mt-2 flex gap-3 overflow-x-auto pb-1">
          {photos.map((name, i) => (
            <Shot
              key={name}
              name={name}
              which={i + 1}
              outOf={photos.length}
              picking={picking}
              picked={picked.has(name)}
              onPick={() =>
                setPicked((was) => {
                  const next = new Set(was);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  return next;
                })
              }
              onDrop={() =>
                remove(
                  [name],
                  photos.filter((x) => x !== name)
                )
              }
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
