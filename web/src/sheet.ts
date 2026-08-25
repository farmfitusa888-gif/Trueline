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
  return new XMLSerializer().serializeToString(clone);
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

/** A file name somebody can find again, with nothing in it a filesystem hates. */
export function fileNameFor(room: string, extension: string): string {
  const clean = room.replace(/[^\w -]/g, '').trim() || 'room';
  return `${clean} plan.${extension}`;
}

/**
 * Hands the picture to whatever the phone uses to send things, or saves it.
 *
 * Web Share with a file is what puts a drawing into Messages on an iPhone, which
 * is how it actually reaches a client. Where that is not available — a desktop
 * browser, an older web view — it falls back to a download, and says which of
 * the two happened rather than leaving somebody looking for a share sheet that
 * never opened.
 */
export async function sendPicture(blob: Blob, name: string, title: string): Promise<string> {
  const file = new File([blob], name, { type: blob.type });
  const share = navigator.share as ((data: ShareData) => Promise<void>) | undefined;
  const canShareFiles = navigator.canShare?.({ files: [file] }) ?? false;
  if (share && canShareFiles) {
    try {
      await share.call(navigator, { files: [file], title });
      return 'Sent.';
    } catch (error) {
      // Changing your mind is not a failure. Anything else falls through to a
      // download rather than doing nothing twice.
      if (error instanceof DOMException && error.name === 'AbortError') return '';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
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
