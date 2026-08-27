/**
 * What stands where a paid feature would be.
 *
 * The rule, and the reason this is a component rather than a string scattered
 * through nine screens: **say what the thing does, then say it is paid.** In
 * that order. A contractor who has just measured his own kitchen with this for
 * nothing has earned a straight description of what he would be buying, and
 * "Upgrade to unlock" tells him only that he cannot have it.
 *
 * The sentence is not written here either. It comes from the same table the
 * gate reads, so this cannot advertise something the app does not unlock.
 */
import { useEffect, useState } from 'react';
import { type Feature, FREE_ROOMS, TITLE, describeLock } from '../../core/src/entitlement.ts';
import { onEntitlement, unlocked, waiting } from './entitlementStore.ts';

/** Re-renders whatever uses it when the app hands the answer across. */
export function useUnlocked(): { readonly open: boolean; readonly pending: boolean } {
  const [, bump] = useState(0);
  useEffect(() => onEntitlement(() => bump((n) => n + 1)), []);
  return { open: unlocked(), pending: waiting() };
}

export function Locked({ feature }: { readonly feature: Feature }) {
  return (
    <section
      data-sheet="no"
      className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4"
    >
      <h2 className="font-semibold text-slate-900">{TITLE[feature]}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{describeLock(feature)}</p>
      <p className="mt-3 text-sm font-medium text-slate-700">
        This one is part of the subscription. Measuring, the drawing and the 3D view are not,
        and never will be, and neither is{' '}
        {FREE_ROOMS === 1 ? 'the first room you keep' : `the first ${FREE_ROOMS} rooms you keep`}.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Open it from the projects list to see what it costs.
      </p>
    </section>
  );
}

/**
 * Shows the children, the lock, or nothing while the answer is still coming.
 *
 * The waiting state is the one worth having: without it, a screen draws itself
 * locked and then unlocks a frame later, which shows a paywall to somebody who
 * has already paid.
 */
/**
 * How long to wait for the app to say, before saying something anyway.
 *
 * The waiting state is right and it stays. What was wrong was that it had no
 * end: `pending` returns true until the app calls `setSubscribed`, and when
 * that call was silently dropped -- which it was, on every phone, see
 * `bridge.ts` -- five screens drew themselves as nothing at all, for good. A
 * screen that can render permanently blank with no explanation is a defect
 * whatever caused it, so the wait is bounded now.
 *
 * Three seconds because the answer normally arrives in the same frame as the
 * room. Anything that has not come in three seconds is not coming, and the
 * description of a feature plus "this is part of the subscription" is a far
 * better answer than an empty rectangle. If it does turn up late, this
 * re-renders and unlocks.
 */
const WAIT_MS = 3000;

export function Gate({
  feature,
  children,
}: {
  readonly feature: Feature;
  readonly children: React.ReactNode;
}) {
  const { open, pending } = useUnlocked();
  const [waitedLongEnough, setWaited] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setWaited(true), WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  if (pending && !waitedLongEnough) return null;
  return open ? <>{children}</> : <Locked feature={feature} />;
}

/**
 * Said when a NEW room could not be written down, and never said about an old one.
 *
 * ## The failure this wording exists to prevent
 *
 * A limit on rooms reads, to anybody who has ever met one, as "your rooms are
 * going away". They are not. Everything already on this device stays on it,
 * opens, reads, corrects and exports, subscription or no subscription — and the
 * moment somebody is not sure of that, he stops trusting the app with a
 * building he is standing in. This project has already lost a contractor 53
 * photographs once; nothing here is allowed to look like the start of that.
 *
 * So the sentence leads with what happened to the new room, and says in the
 * same breath what did not happen to the old ones. `because` comes from
 * `mayKeepRoom`, so this screen cannot say a different number from the one the
 * gate counted.
 */
export function RoomLimit({ because }: { readonly because: string }) {
  return (
    <section
      role="alert"
      data-sheet="no"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <h2 className="font-semibold text-amber-900">This new room was not kept</h2>
      <p className="mt-1 text-sm leading-relaxed text-amber-900">{because}</p>
      <p className="mt-2 text-sm text-amber-900">
        Nothing has been deleted. Every room already on this phone is still there, still
        opens, and still exports. What is on the screen right now is still on the screen —
        it is only the writing-down that has stopped, so send it out from Files before you
        move on if you want to keep it.
      </p>
    </section>
  );
}
