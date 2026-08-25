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
