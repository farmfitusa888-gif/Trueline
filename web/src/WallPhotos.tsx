import { type CSSProperties, useMemo, useState } from 'react';
import { useUnits } from './units.tsx';
import type { Room } from '../../core/src/room.ts';
import { type Photo, photosOfWall } from '../../core/src/photo.ts';

/**
 * What this wall looked like when it was scanned.
 *
 * `photosOfWall` has been able to answer this since the day `photo.ts` was
 * written and nothing has ever called it, because the model knows where a photo
 * was taken *from* and never knew where the picture *is*. It does now — the
 * capture's own file name rides along on the photo — so the walk a person did
 * with the phone finally reaches the screen.
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
 */

/** Where the app serves a capture's photographs from. See `WebBundle.swift`. */
export const PHOTO_BASE = 'photos/';

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

export function WallPhotos({
  room,
  wallId,
  photos,
}: {
  readonly room: Room;
  readonly wallId: string;
  readonly photos: readonly Photo[];
}) {
  const { len } = useUnits();
  const [big, setBig] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  const shown = useMemo(() => {
    try {
      // Best first: the one that shows most of this wall.
      return photosOfWall(photos, room, wallId).slice(0, 12);
    } catch {
      return [];
    }
  }, [photos, room, wallId]);

  if (photos.length === 0) return null;

  const withFiles = shown.filter((s) => s.photo.fileName !== undefined);

  return (
    <div className="mt-4 border-t border-sky-200 pt-3" data-sheet="no">
      <h3 className="text-sm font-semibold text-slate-900">
        {shown.length === 0
          ? 'No photograph shows this wall'
          : `${shown.length} photograph${shown.length === 1 ? '' : 's'} of this wall`}
      </h3>

      {shown.length === 0 ? (
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
          <p className="mt-1 text-sm text-slate-600">
            Best first — the one that shows most of the wall. Tap to open.
          </p>
          <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {withFiles.map(({ photo, inFrame }) => {
              const src = `${PHOTO_BASE}${photo.fileName!}`;
              if (broken.has(photo.id)) return null;
              return (
                <li key={photo.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setBig(big === photo.id ? null : photo.id)}
                    className="block"
                    aria-label={`Photograph showing ${len(inFrame.visibleLength)} of ${wallId}`}
                  >
                    <span
                      className={`flex ${SLOT.h} ${SLOT.w} items-center justify-center
                                  overflow-hidden rounded-md border border-slate-200 bg-slate-100`}
                    >
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        // A picture that will not load is removed rather than left
                        // as a broken frame: this page runs in a browser too, where
                        // there is no folder behind it at all.
                        onError={() => setBroken((was) => new Set(was).add(photo.id))}
                        className={`shrink-0 object-cover ${turned(photo.upright).className}`}
                        style={turned(photo.upright).style}
                      />
                    </span>
                    <span className="mt-1 block text-center text-xs font-mono tabular-nums text-slate-500">
                      {len(inFrame.visibleLength)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {big && (
            <button
              type="button"
              onClick={() => setBig(null)}
              className="mt-2 block w-full"
              aria-label="Close the photograph"
            >
              {(() => {
                const shot = withFiles.find((s) => s.photo.id === big)!.photo;
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
                          ? { transform: `rotate(${shot.upright}deg)`, maxWidth: '133%', maxHeight: '133%' }
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
    </div>
  );
}
