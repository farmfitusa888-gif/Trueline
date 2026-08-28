/**
 * Getting the drawing off the phone: on paper, and as a picture.
 *
 * Both come from the same `<svg>` element that is on the screen. Not from a
 * second renderer driven by the same model — from that element, cloned. It is
 * the same rule the rest of the app runs on: a number recomputed somewhere else
 * is a number that will eventually disagree, and a client holding a printed
 * drawing that says something different from the phone is the worst version of
 * that. Whatever is on screen is what prints and what saves.
 *
 * The plan's own SVG paints with attributes rather than stylesheet classes, so
 * pulling it out of the page loses nothing: it carries its own colours, its own
 * type sizes and its own font stack. That is why it is written that way.
 */

import { onPaper } from '../../core/src/design.ts';
import {
  type Handover,
  addHandover,
  describeHandover,
  handoverFingerprint,
  handoverTime,
  readHandovers,
  recordHandover,
  sayHandovers,
  sendingsOf,
  versionGap,
  writeHandovers,
} from '../../core/src/sent.ts';

export class SheetError extends Error {}

/** Everything that only exists to be touched. It has no business in a picture. */
function stripInteractive(node: SVGElement): void {
  for (const el of Array.from(node.querySelectorAll<SVGElement>('*'))) {
    el.removeAttribute('class');
    // The fat invisible line that lets a finger hit a wall. Transparent on
    // screen, and transparent in a PNG too — but it is 34 units wide and the
    // renderer still has to consider it, so it goes.
    if (el.tagName === 'line' && el.getAttribute('stroke') === 'transparent') el.remove();
  }
}

/**
 * The plan as a standalone SVG document.
 *
 * `xmlns` matters: without it the browser will not load the result as an image,
 * and the failure is a blank canvas rather than an error.
 */
export function planSvg(source: SVGSVGElement): string {
  const clone = source.cloneNode(true) as SVGSVGElement;
  stripInteractive(clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  const box = source.getAttribute('viewBox');
  if (!box) throw new SheetError('The plan has no viewBox, so it has no size to save at.');
  const [, , w, h] = box.split(/\s+/).map(Number);
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  // Resolved before it leaves, at the one place a plan is serialised. The
  // drawing paints with `rgb(var(--c-ink))`, and those properties are declared
  // on the app's own `:root`. Anywhere else -- a claim file, a client file, an
  // <img> holding the PNG, a thumbnail in the scan list -- the var() resolves
  // to nothing, which does not fall back: it invalidates the declaration, so
  // `fill` becomes black and the whole drawing prints as a black rectangle.
  // Measured: 10,000 pixels out of 10,000, on a page that DOES declare the
  // tokens, because an SVG loaded as an image is its own document.
  return onPaper(new XMLSerializer().serializeToString(clone));
}

/**
 * The same drawing as a PNG, at a size worth sending.
 *
 * Drawn through a data URL rather than a blob URL: a blob URL taints nothing but
 * needs revoking, and an image built from one has been known to fail silently in
 * a web view. The data URL is bigger and it works everywhere this runs.
 *
 * `unescape(encodeURIComponent(...))` is the standard way to get UTF-8 through
 * `btoa`, which only speaks Latin-1 — and the drawing has a curly apostrophe and
 * a degree sign in it.
 */
export async function planPng(svg: string, width = 2000): Promise<Blob> {
  const encoded = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new SheetError('The drawing could not be turned into a picture.'));
    image.src = encoded;
  });

  const ratio = image.naturalHeight / image.naturalWidth || 1;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(width * ratio);
  const context = canvas.getContext('2d');
  if (!context) throw new SheetError('This browser would not give the app a canvas to draw on.');
  // White, not transparent. A transparent PNG in a dark-mode message thread is a
  // drawing in black ink on black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new SheetError('The picture came back empty.'))),
      'image/png'
    );
  });
}

/**
 * A small picture of the plan, for the list of scans.
 *
 * The list said "Room 2026-08-24 1819" three times and left somebody to
 * remember which was the kitchen. A drawing is what a person recognises, and
 * the drawing already exists — this is the same `<svg>` the page is showing,
 * the same one that prints, at the size of a thumbnail. There is no second
 * renderer, so the picture on the list cannot show a room the app does not have.
 *
 * Comes back as a data URL because it is handed to the native app across a
 * message channel, which takes text.
 */
export async function planThumbnail(source: SVGSVGElement, width = 320): Promise<string> {
  const blob = await planPng(planSvg(source), width);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new SheetError('The thumbnail could not be read back.'));
    reader.readAsDataURL(blob);
  });
}

/** A file name somebody can find again, with nothing in it a filesystem hates. */
export function fileNameFor(room: string, extension: string, kind = 'plan'): string {
  const clean = room.replace(/[^\w -]/g, '').trim() || 'room';
  return `${clean} ${kind}.${extension}`;
}

export async function sendPicture(blob: Blob, name: string, title: string): Promise<string> {
  return await sendFile(blob, name, title);
}

/* ---------------------------------------------- what has left this phone */

/**
 * Where the record of documents leaving this phone is kept.
 *
 * `localStorage`, alongside the corrected rooms, rather than inside the job
 * file. Every send in the app goes through `sendFile`, and `sendFile` is handed
 * a blob and a name and has no idea which job is open — so the record is
 * device-wide and keyed by the file name, which `fileNameFor` already builds
 * out of the room or claim number and the kind of document.
 *
 * The consequence is worth stating rather than discovering: this record does
 * not travel with the job file to a second phone. `core/src/sent.ts` is written
 * so it can be moved into the job's `extras` without changing a word of it, and
 * `sayHandovers` never says "not sent" for exactly this reason — a phone that
 * has no record is not a phone from which nothing went out.
 */
export const HANDOVER_LOG = 'trueline.handovers.v1';

/**
 * Writes down that a file left, after it has left.
 *
 * Deliberately after, and deliberately swallowing its own failures. The file is
 * already gone by the time this runs; turning a completed hand-over into an
 * error message on screen would tell the contractor the opposite of what
 * happened. If the log cannot be read — corrupt, or written by a newer version
 * — it is left exactly as it is rather than overwritten, because an unreadable
 * record is still evidence and a fresh empty one is not.
 */
async function note(blob: Blob, name: string, title: string, how: Handover['how']): Promise<void> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const one = recordHandover({
      document: name,
      says: title,
      mediaType: blob.type,
      bytes: bytes.byteLength,
      fingerprint: await handoverFingerprint(bytes),
      at: handoverTime(new Date()),
      how,
    });
    const kept = addHandover(readHandovers(localStorage.getItem(HANDOVER_LOG)), one);
    localStorage.setItem(HANDOVER_LOG, writeHandovers(kept));
  } catch {
    // Nothing is retried and nothing is reported here. See above.
  }
}

/** Every hand-over this phone has a record of. Throws if the record is unreadable. */
export function handovers(): readonly Handover[] {
  return readHandovers(localStorage.getItem(HANDOVER_LOG));
}

/**
 * What a screen can say about one document, in one call.
 *
 * `fingerprintNow` is the SHA-256 of the file as it would be built today — the
 * same value `note` records, so the two are comparable. Pass null where the
 * screen has not built it; the count is still true and no claim is made about
 * which version is in somebody's hands.
 */
export function whatWentOut(
  document: string,
  fingerprintNow: string | null
): {
  readonly sendings: readonly Handover[];
  readonly summary: string;
  readonly gap: string | null;
  readonly detail: readonly (readonly string[])[];
} {
  const all = handovers();
  const sendings = sendingsOf(all, document);
  return {
    sendings,
    summary: sayHandovers(all, document, fingerprintNow),
    gap: fingerprintNow === null ? null : versionGap(all, document, fingerprintNow),
    detail: sendings.map(describeHandover),
  };
}

/**
 * Hands any file to whatever the phone uses to send things, or saves it.
 *
 * Web Share with a file is what puts something into Messages on an iPhone,
 * which is how a drawing actually reaches a client. Where that is not available
 * — a desktop browser, an older web view — it falls back to a download, and
 * says which of the two happened rather than leaving somebody looking for a
 * share sheet that never opened.
 *
 * Both paths write the sending down, through `note`. This is the only place in
 * the app a document leaves, so it is the only place that has to record one.
 *
 * It used to answer the share with the single word "Sent." It does not any
 * more, and the reason is the whole of `core/src/sent.ts`: the share sheet
 * resolves the same way whether the person sent a message, saved the file, or
 * picked Messages and then deleted the draft. "Sent" is a claim about somebody
 * else's phone. "Handed over" is a claim about this one, and it is the only one
 * of the two the app can stand behind if it is ever read out in a dispute.
 */
export async function sendFile(blob: Blob, name: string, title: string): Promise<string> {
  const file = new File([blob], name, { type: blob.type });
  const share = navigator.share as ((data: ShareData) => Promise<void>) | undefined;
  const canShareFiles = navigator.canShare?.({ files: [file] }) ?? false;
  if (share && canShareFiles) {
    try {
      await share.call(navigator, { files: [file], title });
      await note(blob, name, title, 'handed');
      return 'Handed over — this app cannot confirm it was delivered.';
    } catch (error) {
      // Changing your mind is not a failure. Anything else falls through to a
      // download rather than doing nothing twice.
      //
      // Nothing is recorded here, and that matters: the cancel is the one
      // honest signal the share sheet gives back, and a record written on a
      // share the contractor backed out of would be the app's first outright
      // false statement about a document.
      if (error instanceof DOMException && error.name === 'AbortError') return '';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  await note(blob, name, title, 'saved');
  return `Saved as ${name}.`;
}

/**
 * Prints one thing, chosen before the dialog opens.
 *
 * The page has two things worth printing and they are nothing alike: the field
 * list, which is a checklist to carry and write on, and the drawing, which is a
 * sheet to hand somebody. A class on the body decides which, and it comes off
 * again afterwards — `afterprint` fires whether the dialog was used or
 * cancelled, and a page left in print mode is a page with half its controls
 * missing and no way to say why.
 */
export function printOnly(what: 'plan' | 'field'): void {
  const body = document.body;
  const mark = `printing-${what}`;
  const clear = () => {
    body.classList.remove('printing-plan', 'printing-field');
    window.removeEventListener('afterprint', clear);
  };
  window.addEventListener('afterprint', clear);
  body.classList.add(mark);
  try {
    window.print();
  } finally {
    // Safari on iOS does not always fire `afterprint`. A timer is not a
    // guarantee either, so both are used: whichever arrives first wins, and
    // `clear` is safe to run twice.
    setTimeout(clear, 1500);
  }
}
