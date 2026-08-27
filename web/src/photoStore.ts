/**
 * Where a photograph of the damage lives on this device.
 *
 * The room model carries a photograph's **name** and never its bytes. That rule
 * is already in `photo.ts` for the pictures the scanner takes, and it is the
 * same rule here for the ones somebody takes of a hole in a wall: the model is
 * measurements, and a JPEG is not a measurement. A corrected garage is 5.5 kB
 * and it is handed to the app on every keystroke — putting photographs inside it
 * would make that a megabyte a time, and `localStorage` would refuse the first
 * one outright.
 *
 * So the bytes go in IndexedDB, keyed by the name, and the damage keeps the
 * name. Three consequences, all of them wanted:
 *
 *   - The picture survives a reload and a closed tab, which is the same promise
 *     the corrections already make.
 *   - It is addressable. The app writes the same name into the scan's own
 *     folder and into iCloud, so the same damage finds the same photograph on a
 *     second phone.
 *   - Nothing on a document has to wait for a network, because there is none.
 *
 * IndexedDB can be absent or refuse to open — a private window, a device out of
 * space, a web view with storage turned off. Every function here answers that
 * the same way: it fails quietly and the screen says the picture is not on this
 * device, rather than showing a broken frame and implying the photograph is
 * gone. It is not gone; it is in the scan's folder, where the app put it.
 */

const DB = 'trueline.photos';
const STORE = 'photos';
const VERSION = 1;

export class PhotoStoreError extends Error {}

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const transaction = db.transaction(STORE, mode);
          const request = work(transaction.objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

/**
 * A name for a photograph of a damage, unique inside one scan.
 *
 * The damage's own id is in it so a folder full of pictures can be read by a
 * person, and so a photograph orphaned by a deleted mark is identifiable rather
 * than being a hash nobody can trace. The counter, rather than a clock, because
 * two photographs taken in the same second must not collide — and a clock is
 * exactly what produced two identical names the first time this was tried
 * elsewhere in this codebase.
 */
export function nameFor(damageId: string, existing: readonly string[]): string {
  const prefix = `damage-${damageId.replace(/[^a-zA-Z0-9-]/g, '-')}`;
  let n = 1;
  const taken = new Set(existing);
  while (taken.has(`${prefix}-${n}.jpg`)) n += 1;
  return `${prefix}-${n}.jpg`;
}

/** Keeps the bytes. Answers whether they are actually kept. */
export async function keep(name: string, blob: Blob): Promise<boolean> {
  const result = await run('readwrite', (store) => store.put(blob, name) as IDBRequest<IDBValidKey>);
  return result !== null;
}

/** The bytes back, or nothing when this device does not have them. */
export async function fetchPhoto(name: string): Promise<Blob | null> {
  const found = await run<Blob>('readonly', (store) => store.get(name) as IDBRequest<Blob>);
  return found instanceof Blob ? found : null;
}

/** Drops one. Called when a mark is taken off, so orphans do not accumulate. */
export async function forget(name: string): Promise<void> {
  await run('readwrite', (store) => store.delete(name) as unknown as IDBRequest<undefined>);
}

/**
 * A picture, turned the right way up if the camera did not, and made small
 * enough to keep several of.
 *
 * **Full size is what goes on the claim document**, which is what was asked
 * for — an adjuster arguing about a stain needs the stain, not a thumbnail. But
 * a modern phone camera writes 4 MB a frame, and the app hands every photograph
 * to iCloud; so the long edge is capped at something that still reads as
 * evidence on a printed page at 300 dpi and does not fill a free 5 GB account
 * with six pictures of a garage.
 *
 * 2400 px on the long edge is 8 inches at 300 dpi. A photograph of a water line
 * printed eight inches wide is bigger than it will ever be printed.
 */
export const LONG_EDGE = 2400;

export async function readied(file: File | Blob, longEdge = LONG_EDGE): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new PhotoStoreError('That file could not be read as a picture.'));
      image.src = url;
    });
    const scale = Math.min(1, longEdge / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1 && file.type === 'image/jpeg') return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new PhotoStoreError('This device would not give a canvas to draw on.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.86)
    );
    if (!blob) throw new PhotoStoreError('The picture could not be encoded.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Bytes as a data URL, for handing to the app and for putting on a document. */
export function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new PhotoStoreError('The picture could not be read back.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Which of these photographs this device is actually holding the bytes for.
 *
 * Asked before a delete, and only there. A name on a mark is not proof of a
 * picture: a claim opened on a second phone names every photograph and holds
 * none of them, because the bytes are in the scan's folder on the phone that
 * took them. Deleting the name in that state loses the only thing that pointed
 * at the file, and the person deleting it should be told which case they are in
 * before it happens rather than after.
 *
 * A store that will not open answers "none", which is the safe way round: the
 * screen then says nothing about copies it cannot see instead of promising one.
 */
export async function heldPhotos(names: readonly string[]): Promise<ReadonlySet<string>> {
  const keys = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  if (keys === null) return new Set();
  const here = new Set(keys.map((key) => String(key)));
  return new Set(names.filter((name) => here.has(name)));
}

/* ------------------------------------ what is on the claim document, right now */

/**
 * The photographs a claim document is showing at this moment.
 *
 * ## Why a register and not a flag
 *
 * The mark and the claim document are two different screens that carry the same
 * photographs, and the screen a person deletes from is not the screen the
 * photograph is evidence on. Before a batch delete goes ahead, the confirmation
 * has to be able to say "3 of these are on the claim" — and the honest source
 * for that is the component that actually prints them, not a boolean passed
 * down a tree that could drift from what the document really has on it.
 *
 * So `ReportPhotos` — the claim document's own photograph list — says what it is
 * showing, for as long as it is showing it, and anything about to delete one can
 * ask.
 *
 * ## What it can and cannot get wrong
 *
 * It can only ever **understate**. A claim report nobody has opened has
 * registered nothing, so the count comes back lower than the truth and the
 * confirmation falls back to the sentence that is true either way — that a
 * document already sent keeps what went with it. It cannot overstate: a name is
 * in here only because a live claim document has it on the page. Understating a
 * use makes the warning quieter; inventing one would make every warning worth
 * less, which is worse.
 */
const shownOnClaim = new Map<string, number>();
const watchers = new Set<() => void>();
let claimNames: ReadonlySet<string> = new Set();

function republish(): void {
  claimNames = new Set(shownOnClaim.keys());
  for (const watcher of watchers) watcher();
}

/** Says these are on the claim document. The returned function takes it back. */
export function showingOnClaim(names: readonly string[]): () => void {
  for (const name of names) shownOnClaim.set(name, (shownOnClaim.get(name) ?? 0) + 1);
  republish();
  return () => {
    for (const name of names) {
      const left = (shownOnClaim.get(name) ?? 0) - 1;
      if (left > 0) shownOnClaim.set(name, left);
      else shownOnClaim.delete(name);
    }
    republish();
  };
}

/**
 * The current set, as one object that only changes when the set does — so it
 * can be read straight by `useSyncExternalStore` without re-rendering forever.
 */
export function photosOnClaim(): ReadonlySet<string> {
  return claimNames;
}

/** Tells you when that set changes. */
export function watchClaimPhotos(tell: () => void): () => void {
  watchers.add(tell);
  return () => {
    watchers.delete(tell);
  };
}
