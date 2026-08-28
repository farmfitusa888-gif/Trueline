import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useUnits } from './units.tsx';
import { insideApp } from './bridge.ts';
import type { Room } from '../../core/src/room.ts';
import {
  type Photo,
  type ScanDeletion,
  onlyPhotographOf,
  photosOfWall,
  plannedScanDeletion,
} from '../../core/src/photo.ts';
import { nameOf } from '../../core/src/wallLabel.ts';

/**
 * What this wall looked like when it was scanned, and taking frames off it.
 *
 * `photosOfWall` has been able to answer the first half since the day `photo.ts`
 * was written and nothing has ever called it, because the model knows where a
 * photo was taken *from* and never knew where the picture *is*. It does now —
 * the capture's own file name rides along on the photo — so the walk a person
 * did with the phone finally reaches the screen.
 *
 * Why it earns its place, in the order a contractor would say it:
 *
 *   - A dimension somebody disputes has the frame it was read from attached.
 *   - A wall the app marked low confidence because a fridge was in front of it
 *     can show the fridge, instead of asking to be believed.
 *   - Six weeks later, "the outlet behind the washer" is findable.
 *
 * The pictures are served by the app that took them, out of the scan's own
 * folder, under the same scheme the page itself is loaded from. In a browser
 * with no app around it there is no folder and no picture, and the strip says
 * that plainly rather than showing a row of broken frames.
 *
 * ## Taking several off, and the 53 photographs
 *
 * > "BUILD IT!" — batch photo delete. Deleting photographs one at a time on a
 * > phone, after a scan that took fifty of them, is unusable.
 *
 * A batch delete already existed for the photographs somebody takes of a damage
 * mark. The frames the walk itself takes — the fifty — had no delete anywhere
 * in the app, and those are the ones that were being described. This is it.
 *
 * It is the most destructive control on this screen, and it is built as if that
 * is true, because it is:
 *
 * > A room with 53 photographs was deleted by accident. A rename had not shown
 * > up on the room screen, so the thing on screen was not the thing that went,
 * > and there was no way to tell one file from another before it was too late.
 *
 * Everything that came out of that is here:
 *
 *   - The count is said in words — "Delete 14 photographs." — and is never left
 *     to be worked out from which thumbnails happen to be ringed.
 *   - **Every frame shows its own file name while picking.** Not being able to
 *     tell one file from another is the reported cause of the 53, and a strip
 *     of fifty near-identical hallway frames is that same strip again.
 *   - What a frame is doing is named before it goes, by `plannedScanDeletion`
 *     in the model rather than by this screen, so it is tested rather than
 *     believed. A scan photograph carries a camera pose, so "this is the only
 *     picture of Wall 5" is a fact about the room and it is stated as one.
 *   - They can be put back until the screen is left, and the wording reaches
 *     exactly that far and no further.
 *
 * ## Which side owns the truth
 *
 * The record does, and the file does not. The pictures are served read-only out
 * of the scan's own folder by the app that wrote them — `WebBundle.swift` — and
 * there is no message on the bridge that deletes a file there. So what goes is
 * the corrected room's list of frames; the JPEG stays where the scan put it.
 * That is why a record is never dropped while the strip still points at a file
 * — the strip is built from the records, so a deleted record takes its own tile
 * with it — and why nothing here claims a picture was wiped off the phone. Both
 * halves are in `plannedScanDeletion`'s own words, and both are tested.
 *
 * ## Why the delete disappears rather than sitting there dead
 *
 * `onPhotos` is optional, and everything to do with deleting is absent when it
 * is not supplied — not greyed, not refused when pressed: absent. Taking a
 * frame out of the scan changes the room's own state, so it needs an action
 * this component cannot dispatch for itself. A half-wired build must therefore
 * show no delete at all rather than a button that quietly does nothing, which
 * is the one failure a person cannot tell apart from a working delete of the
 * wrong thing. And if a handler is supplied that does not actually take the
 * frames off, the strip says so in words instead of showing an undo bar for a
 * delete that never happened.
 */

/** Where the app serves a capture's photographs from. See `WebBundle.swift`. */
export const PHOTO_BASE = 'photos/';

/**
 * How many of a wall's frames the strip shows when nobody is picking.
 *
 * Twelve is plenty to look through. It is not plenty to delete through: a
 * delete somebody has to run five times to clear one wall is the same unusable
 * thing that was reported in the first place. So picking lifts the cap and
 * shows every frame of the wall, and the strip says how many that is.
 */
const BEST_FEW = 12;

/**
 * Turning the picture the right way up.
 *
 * ARKit writes every frame in the device's landscape frame however the phone
 * was held, with no orientation tag on the file, so a walk done in portrait
 * gives a folder of photographs lying on their side. `capture.ts` works out
 * which way from the camera's own X axis in the pose. All this does is apply it.
 *
 * A quarter turn swaps a picture's width and height, so the image is sized to
 * the slot the other way round first and then turned into it. Scaling it down
 * to fit instead would leave a thumbnail floating in a box with white either
 * side of it, which is what the first attempt did.
 */
const SLOT = { w: 'w-32', h: 'h-24', swappedW: 'w-24', swappedH: 'h-32' };

function turned(upright: Photo['upright']): { className: string; style: CSSProperties } {
  const quarter = upright === 90 || upright === 270;
  if (!quarter) return { className: `${SLOT.h} ${SLOT.w}`, style: {} };
  return {
    className: `${SLOT.swappedH} ${SLOT.swappedW} origin-center`,
    style: { transform: `rotate(${upright}deg)` },
  };
}

/** How many photographs, written the way somebody says it out loud. */
function photographs(n: number): string {
  return n === 1 ? '1 photograph' : `${n} photographs`;
}

export function WallPhotos({
  room,
  wallId,
  photos,
  onPhotos,
}: {
  readonly room: Room;
  readonly wallId: string;
  readonly photos: readonly Photo[];
  /**
   * The scan's photographs as they should now be, as one whole list.
   *
   * Whole list rather than "these ones went", because putting them back is then
   * the same call read the other way round — one path in and out means one
   * thing to get right. Left out entirely on a build that cannot dispatch it,
   * and then nothing on this strip offers to delete anything.
   */
  readonly onPhotos?: (next: readonly Photo[]) => void;
}) {
  const { len } = useUnits();
  const [big, setBig] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState<ScanDeletion | null>(null);
  const [told, setTold] = useState<string | null>(null);
  const [gone, setGone] = useState<{
    readonly ids: readonly string[];
    readonly before: readonly Photo[];
  } | null>(null);
  const backed = insideApp();

  // Moving to another wall is leaving this screen as far as a person is
  // concerned. Carrying a half-made selection across that move — or an undo bar
  // for frames that are not in front of them any more — is how somebody puts
  // back the wrong lot, or deletes against a strip they stopped reading.
  useEffect(() => {
    setPicking(false);
    setPicked(new Set());
    setAsking(null);
    setGone(null);
    setTold(null);
    setBig(null);
  }, [wallId]);

  const ofWall = useMemo(() => {
    try {
      // Best first: the one that shows most of this wall.
      return photosOfWall(photos, room, wallId);
    } catch {
      return [];
    }
  }, [photos, room, wallId]);

  /**
   * Which frames in the whole scan are the only photograph of some wall.
   *
   * Across the room and not across this strip: a frame of the north wall can
   * also be the only thing that ever caught the return by the hallway, and this
   * screen has no business deciding for itself that a picture looks spare.
   */
  const sole = useMemo(() => {
    try {
      return onlyPhotographOf(photos, room);
    } catch {
      return new Map<string, readonly string[]>();
    }
  }, [photos, room]);

  if (photos.length === 0) return null;

  const shown = picking ? ofWall : ofWall.slice(0, BEST_FEW);
  const withFiles = shown.filter((s) => s.photo.fileName !== undefined);
  // A picture that will not load is dropped from the strip when somebody is
  // only looking — this page runs in a plain browser too, where there is no
  // folder behind it. It is NOT dropped while picking: a frame nobody can see
  // is exactly the one that has to stay nameable, or the 53 happen again with a
  // blank tile in place of a wrong thumbnail.
  const strip = picking ? withFiles : withFiles.filter((s) => !broken.has(s.photo.id));

  const inOrder = strip.filter((s) => picked.has(s.photo.id)).map((s) => s.photo);
  const count = photographs(inOrder.length);
  const deleting = onPhotos !== undefined;

  // A handler that was supplied and did not take the frames off. Read from the
  // list this component was handed rather than from anything it kept for
  // itself, so a reducer that ignores the action cannot pass for a working
  // delete with an undo bar under it.
  const stillHere = gone ? gone.ids.filter((id) => photos.some((p) => p.id === id)) : [];

  function ask(chosen: readonly Photo[]) {
    try {
      setAsking(
        plannedScanDeletion({
          inScan: photos,
          picked: chosen.map((photo) => photo.id),
          room,
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

  function remove(plan: ScanDeletion) {
    if (!onPhotos) return;
    setGone({ ids: plan.going.map((photo) => photo.id), before: photos });
    setAsking(null);
    setPicking(false);
    setPicked(new Set());
    onPhotos(plan.staying);
  }

  function putBack() {
    if (!gone || !onPhotos) return;
    // The scan as it was, plus anything that has arrived since. Undoing a
    // delete must not quietly take away a frame that turned up while the bar
    // was still on screen.
    const had = new Set(gone.before.map((photo) => photo.id));
    const back = [...gone.before, ...photos.filter((photo) => !had.has(photo.id))];
    setGone(null);
    onPhotos(back);
  }

  return (
    <section
      className="mt-4 border-t border-sky-200 pt-3"
      data-sheet="no"
      aria-label="Photographs of this wall"
    >
      <h3 className="text-sm font-semibold text-slate-900">
        {ofWall.length === 0
          ? 'No photograph shows this wall'
          : `${photographs(ofWall.length)} of this wall`}
      </h3>

      {ofWall.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">
          Nothing from the walk points at it. That is the wall that gets argued about later —
          worth going back for, and worth a tape either way.
        </p>
      ) : withFiles.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">
          The walk photographed it, but the pictures are on the phone that took them. Open this
          scan in the app to see them.
        </p>
      ) : (
        <>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <p className="text-sm text-slate-600">
              {picking
                ? 'Every one of them, so a wall can be cleared in one go.'
                : ofWall.length > BEST_FEW
                  ? `The best ${BEST_FEW} — the one that shows most of the wall first. Tap to open.`
                  : 'Best first — the one that shows most of the wall. Tap to open.'}
            </p>
            {deleting && !picking && (
              <button
                type="button"
                onClick={() => {
                  setPicking(true);
                  setPicked(new Set());
                  setAsking(null);
                  setTold(null);
                  setBig(null);
                }}
                className="min-h-11 shrink-0 text-sm text-slate-600 underline underline-offset-4"
              >
                Pick several
              </button>
            )}
          </div>

          {picking && (
            <div className="mt-2 rounded-md border border-slate-300 bg-slate-50 p-2">
              {/* The count, in words, from the set that is actually going.
                  Never a number somebody has to work out by looking at which
                  ones are ringed — that is exactly how 53 photographs went. */}
              <p className="text-sm font-medium text-slate-900">
                {inOrder.length} of {strip.length} picked
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPicked(new Set(strip.map((s) => s.photo.id)))}
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

          {/* Beside the button that was pressed, never in a panel above it. A
              warning a thumb cannot see is the same thing as a control that
              does not work — which is what A31 was written for. */}
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
                  onClick={() => remove(asking)}
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

          {told && <p className="mt-2 text-sm text-red-700">{told}</p>}

          {gone && stillHere.length > 0 && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              Nothing was taken off. This build was asked to delete{' '}
              {photographs(gone.ids.length)} and the scan still has {stillHere.length} of them, so
              the delete is not wired up in this app. Nothing has changed and nothing is lost.
            </p>
          )}

          {gone && stillHere.length === 0 && (
            <div role="status" className="mt-2 rounded-md border border-slate-300 bg-white p-3">
              <p className="text-sm text-slate-900">
                {photographs(gone.ids.length)} deleted. They can go back until you leave this
                screen.
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
                  onClick={() => setGone(null)}
                  className="min-h-11 text-sm text-slate-600 underline underline-offset-4"
                >
                  Leave them off
                </button>
              </div>
            </div>
          )}

          <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {strip.map(({ photo, inFrame }, i) => {
              const isPicked = picked.has(photo.id);
              const last = sole.get(photo.id) ?? [];
              const missing = broken.has(photo.id);
              return (
                <li key={photo.id} className="w-32 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      picking
                        ? setPicked((was) => {
                            const next = new Set(was);
                            if (next.has(photo.id)) next.delete(photo.id);
                            else next.add(photo.id);
                            return next;
                          })
                        : setBig(big === photo.id ? null : photo.id)
                    }
                    className="block w-full"
                    {...(picking
                      ? {
                          'aria-pressed': isPicked,
                          'aria-label': `Photograph ${i + 1} of ${strip.length}`,
                        }
                      : {
                          'aria-label': `Photograph showing ${len(inFrame.visibleLength)} of ${nameOf(wallId)}`,
                        })}
                  >
                    <span
                      className={`flex ${SLOT.h} ${SLOT.w} items-center justify-center
                                  overflow-hidden rounded-md border bg-slate-100 ${
                                    isPicked
                                      ? 'border-slate-900 ring-2 ring-slate-900'
                                      : 'border-slate-200'
                                  }`}
                    >
                      {missing ? (
                        <span className="px-2 text-center text-xs text-slate-500">
                          Not on this device
                        </span>
                      ) : (
                        <img
                          src={`${PHOTO_BASE}${photo.fileName!}`}
                          alt=""
                          loading="lazy"
                          onError={() => setBroken((was) => new Set(was).add(photo.id))}
                          className={`shrink-0 object-cover ${turned(photo.upright).className}`}
                          style={turned(photo.upright).style}
                        />
                      )}
                    </span>
                    {picking ? (
                      // In words as well as in the ring around it. Somebody who
                      // cannot tell two borders apart still has to be able to
                      // see what is about to go.
                      <span
                        className={`mt-1 block text-center text-xs font-medium ${
                          isPicked ? 'text-slate-900' : 'text-slate-400'
                        }`}
                      >
                        {isPicked ? 'Picked' : 'Not picked'}
                      </span>
                    ) : (
                      <span className="mt-1 block text-center text-xs font-mono tabular-nums text-slate-500">
                        {len(inFrame.visibleLength)}
                      </span>
                    )}
                  </button>

                  {picking && (
                    <>
                      {/* The file name, on screen, before anything goes. "There
                          was no way to tell one file from another" is the
                          reported cause of the 53 photographs, and fifty
                          near-identical hallway frames is that strip again. */}
                      <span className="mt-1 block break-all text-center text-[10px] font-mono text-slate-500">
                        {photo.fileName}
                      </span>
                      {last.length > 0 && (
                        <span className="mt-1 block text-center text-[10px] font-semibold text-red-800">
                          {last.length === 1
                            ? `Only photograph of ${nameOf(last[0]!)}`
                            : `Only photograph of ${last.length} walls`}
                        </span>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {big && !picking && (
            <button
              type="button"
              onClick={() => setBig(null)}
              className="mt-2 block w-full"
              aria-label="Close the photograph"
            >
              {(() => {
                const found = strip.find((s) => s.photo.id === big);
                if (!found) return null;
                const shot = found.photo;
                const quarter = shot.upright === 90 || shot.upright === 270;
                return (
                  <span
                    className="flex items-center justify-center overflow-hidden rounded-lg border
                               border-slate-200 bg-slate-100"
                    // A picture turned a quarter is as tall as it was wide, and
                    // the box has to change shape with it or the top and bottom
                    // of somebody's wall are cropped off.
                    style={{ aspectRatio: quarter ? '3 / 4' : '4 / 3' }}
                  >
                    <img
                      src={`${PHOTO_BASE}${shot.fileName!}`}
                      alt=""
                      className="max-h-full max-w-full"
                      style={
                        quarter
                          ? {
                              transform: `rotate(${shot.upright}deg)`,
                              maxWidth: '133%',
                              maxHeight: '133%',
                            }
                          : {}
                      }
                    />
                  </span>
                );
              })()}
            </button>
          )}
        </>
      )}
    </section>
  );
}
