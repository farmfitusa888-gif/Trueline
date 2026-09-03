import { useEffect, useMemo, useState } from 'react';
import { type TroubleReport, askAbout, insideApp, onReports } from './bridge.ts';

/**
 * When something goes wrong.
 *
 * ## Why this screen exists
 *
 * `docs/BUSINESS.md` §6 lists four ways this business fails and marks one of
 * them **certain**, because it was not a risk — it was the state of the app:
 * no analytics and no crash reporting anywhere in the codebase. A scan that
 * fails in a stranger's basement is invisible, and the only signal is whether
 * that stranger can be bothered to write an email.
 *
 * The fix is in two halves. `Diagnostics.swift` subscribes to Apple's own
 * MetricKit for native crashes and hangs; `main.tsx` catches everything these
 * screens throw, which MetricKit cannot see at all. Both write files. This is
 * where somebody can see there are files, and send them.
 *
 * ## Why it is at the bottom of the Business tab
 *
 * Because it is about the app rather than about a room. Rooms, Scan, Measure
 * and Floor are places somebody works; Business is where the things that are
 * not a room already live — the licence number, the price book, the terms. A
 * diagnostics icon in the navigation bar of every screen would be a product
 * apologising before it has done anything.
 *
 * ## Nothing leaves on its own
 *
 * There is no network call in this file and none in `Diagnostics.swift`. A
 * report leaves the phone when somebody taps **Send them**, which opens the
 * mail composer with the file attached and their finger on the send button.
 * That is the rule the rest of the app keeps about a customer's kitchen, and it
 * applies to the app's own laundry too.
 */

/** What each kind of report is, in words somebody who is not a programmer reads. */
const MEANS: Record<string, string> = {
  crash: 'The app quit on its own.',
  hang: 'The app stopped responding for long enough that iOS noticed.',
  launch: 'The app took an unusually long time to open.',
  cpu: 'Something ran hot for long enough that iOS complained.',
  disk: 'Something wrote far more to storage than it should have.',
  daily: "Apple’s daily measurements. Not a fault — this is the normal one.",
  screen: 'A screen inside the app failed. This is usually the one that matters.',
};

/** Which ones are a fault, for the colour. `daily` is not. */
function isFault(kind: string): boolean {
  return kind !== 'daily';
}

function when(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'unknown time';
  return at.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function Trouble() {
  const [reports, setReports] = useState<readonly TroubleReport[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // The app hands the list over once the page has loaded, which is after this
  // has already mounted and asked. Same pattern as the profile and the rooms.
  useEffect(() => onReports(setReports), []);

  const app = insideApp();
  const faults = useMemo(() => reports.filter((r) => isFault(r.kind)).length, [reports]);

  // A browser has no reports folder and no mail composer, and offering a button
  // that cannot work is worse than offering nothing. The whole section is for
  // somebody holding the phone.
  if (!app) return null;

  return (
    <section
      aria-labelledby="trouble-heading"
      className="rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 id="trouble-heading" className="text-base font-semibold text-slate-900">
        When something goes wrong
      </h2>

      <p className="mt-1 text-sm text-slate-600">
        {reports.length === 0
          ? 'Nothing on this phone yet.'
          : `${reports.length} report${reports.length === 1 ? '' : 's'} on this phone` +
            (faults > 0
              ? ` — ${faults} of them ${faults === 1 ? 'is' : 'are'} a fault.`
              : ', none of them a fault.')}
      </p>

      {/* Said out loud, because an empty list looks exactly like a phone on
          which nothing has broken, and normally it is neither. Apple delivers
          crash reports on a LATER launch, not at the moment of the crash. */}
      <p className="mt-2 text-xs text-slate-500">
        Crashes arrive from iOS on a later launch rather than at the moment they
        happen, so one from today usually appears tomorrow. Anything a screen
        inside the app throws is written straight away.
      </p>

      {reports.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
          {reports.map((report) => (
            <li key={report.name} className="py-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${
                    isFault(report.kind)
                      ? 'bg-red-50 text-red-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {report.kind}
                </span>
                <span className="font-mono text-xs tabular-nums text-slate-500">
                  {when(report.when)}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                {MEANS[report.kind] ?? 'Something iOS reported.'}
              </p>
              {report.summary && (
                <p className="mt-0.5 break-words font-mono text-xs text-slate-500">
                  {report.summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            // The app decides whether there is anything to send and says so
            // itself. Checking here as well would be a second rule about the
            // same folder, kept in a place that cannot see it.
            setSaid(
              askAbout('send')
                ? null
                : 'This build has no way to send them. Open ScanToBid on the phone.'
            );
          }}
          className="min-h-12 flex-1 rounded-md bg-slate-900 px-4 font-semibold text-white active:bg-slate-700"
        >
          Send them
        </button>
        {reports.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (!confirming) {
                setConfirming(true);
                return;
              }
              askAbout('clear');
              setReports([]);
              setConfirming(false);
              setSaid('Deleted.');
            }}
            className={`min-h-12 rounded-md border px-4 font-medium ${
              confirming
                ? 'border-red-300 bg-red-50 text-red-800 active:bg-red-100'
                : 'border-slate-300 text-slate-700 active:bg-slate-100'
            }`}
          >
            {/* Two taps, because this cannot be undone and the reports are the
                only record of a crash that exists on the device. */}
            {confirming ? 'Really delete them?' : 'Delete them'}
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        They go to{' '}
        <span className="font-mono">support@scantobid.app</span> as one attached
        file. Nothing is sent until you tap it, and nothing leaves this phone on
        its own — there is no server in this app.
      </p>

      {said && (
        <p role="status" className="mt-2 text-sm font-medium text-slate-700">
          {said}
        </p>
      )}
    </section>
  );
}
