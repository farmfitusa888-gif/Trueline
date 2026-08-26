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
import { type Feature, TITLE, describeLock } from '../../core/src/entitlement.ts';
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
        and never will be.
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
