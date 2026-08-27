import { useEffect, useState } from 'react';

import { fetchPhoto, showingOnClaim } from './photoStore.ts';

/**
 * The photographs, on the document, at the size somebody argues from.
 *
 * Full width rather than a strip of thumbnails, because that is the point of
 * them. An adjuster reading a claim is looking at a stain to decide whether it
 * is one, and a 128-pixel square decides nothing. This is the one place in the
 * app where a picture is deliberately big.
 *
 * They print. A claim leaves the building on paper as often as it leaves it in
 * an email, and a document whose evidence disappeared at the printer is a
 * document that lost the argument on the way out of the door.
 */

/** Where the app serves a scan's photographs from. Matches `WallPhotos.tsx`. */
const SERVED = 'photos/';

function Big({ name }: { readonly name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
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

  if (missing) {
    return (
      <li className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-500">
        A photograph named {name} belongs here and is not on this device. It is in the scan's own
        folder on the phone that took it — nothing is lost, but this copy of the document cannot
        show it.
      </li>
    );
  }

  return (
    <li>
      {src && (
        <img
          src={src}
          alt={`Photograph of the damage, ${name}`}
          onError={() => setMissing(true)}
          className="w-full rounded-md border border-slate-200"
        />
      )}
    </li>
  );
}

export function ReportPhotos({ photos }: { readonly photos: readonly string[] }) {
  // Says, out loud, which photographs are on the claim document while it is on
  // the page. The screen a person deletes a photograph from is not this one, and
  // before a batch delete goes through it has to be able to say "3 of these are
  // on the claim." The honest answer to that comes from the list that actually
  // prints them, which is this one. See `showingOnClaim`.
  useEffect(() => showingOnClaim(photos), [photos]);

  if (photos.length === 0) return null;
  return (
    <ul className="mt-3 space-y-3">
      {photos.map((name) => (
        <Big key={name} name={name} />
      ))}
    </ul>
  );
}
