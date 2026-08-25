import { formatMetric } from '../../core/src/length.ts';
import { useUnits } from './units.tsx';
import { confidenceLabel, toleranceOf } from '../../core/src/measurement.ts';
import { type Room, isDiagonal, runLength } from '../../core/src/room.ts';
import type { ImportReport } from '../../core/src/import-roomplan.ts';
import { type Readiness, trustLabel } from '../../core/src/issue.ts';
import { type PunchListItem, type WallObstruction, describe } from '../../core/src/obstruction.ts';
import { checkCapture } from '../../core/src/health.ts';
import type { Photo } from '../../core/src/photo.ts';
import type { PhotoImport } from '../../core/src/capture.ts';

/**
 * What the import decided, and what to do about each one.
 *
 * The importer already names every decision it made. Until this screen existed
 * those names went nowhere: a note saying *"this 15 foot edge has no wall across
 * it — if that is really a wall, change it here"* had no "here". So every row
 * below that has a remedy carries it, and every row that does not says plainly
 * that there is nothing to do yet, rather than offering a button that pretends.
 */

export interface CorrectionsProps {
  readonly room: Room;
  readonly report: ImportReport;
  readonly readiness: Readiness;
  readonly obstructions: readonly WallObstruction[];
  readonly punchList: readonly PunchListItem[];
  readonly photos: readonly Photo[];
  readonly rejectedPhotos: PhotoImport['rejected'];
  readonly refusedPins: readonly { readonly id: string; readonly reason: string }[];
  /**
   * How high each photograph was taken above the floor.
   *
   * Feeds the one alarm that catches the worst silent failure there is: the
   * photographs and the walls ending up in different coordinate systems.
   */
  readonly cameraHeights: readonly bigint[];
  readonly selected: string | null;
  readonly onSelect: (wallId: string) => void;
  readonly onMake: (wallId: string, as: 'wall' | 'open' | 'cased') => void;
}


function Card({ tone, title, children }: { tone: 'do' | 'note' | 'stop'; title: string; children: React.ReactNode }) {
  const border =
    tone === 'stop' ? 'border-l-red-600' : tone === 'do' ? 'border-l-amber-600' : 'border-l-slate-300';
  return (
    <section className={`rounded-lg border border-slate-200 border-l-4 ${border} bg-white p-4 shadow-sm`}>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

function Button({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 rounded-md border border-slate-300 bg-slate-50 px-4 py-2 font-medium
                 text-slate-900 active:bg-slate-200"
    >
      {children}
    </button>
  );
}

export function Corrections({
  room,
  report,
  readiness,
  obstructions,
  punchList,
  photos,
  rejectedPhotos,
  refusedPins,
  cameraHeights,
  selected,
  onSelect,
  onMake,
}: CorrectionsProps) {
  const { len } = useUnits();
  const blocked = new Map(obstructions.map((o) => [o.wallId, o]));
  // The same checks the command-line tool ran, on screen, because the app put
  // the file here and should be the one to say whether it is any good.
  const findings = checkCapture({
    room, report, photos, rejectedPhotos, refusedPins, cameraHeights,
  });
  const openSpans = room.walls.filter((w) => w.open);
  const inTheWay = obstructions.filter((o) => o.blockedLength > 0n);

  return (
    <div className="space-y-4">
      <Card tone={readiness.blocking.length > 0 ? 'stop' : 'note'} title={trustLabel(readiness.trust)}>
        {readiness.blocking.length === 0 ? (
          <p>This room may go out as a dimensioned drawing.</p>
        ) : (
          <ul className="list-disc space-y-2 pl-5">
            {readiness.blocking.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {readiness.warnings.length > 0 && (
          <ul className="list-disc space-y-2 pl-5 text-slate-500">
            {readiness.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </Card>

      {findings.length > 0 && (
        <Card
          tone={findings.some((f) => f.severity === 'stop') ? 'stop' : 'do'}
          title={`What this capture looks like — ${findings.length} thing${findings.length === 1 ? '' : 's'} to know`}
        >
          <ul className="space-y-3">
            {findings.map((finding) => (
              <li key={finding.what}>
                <span
                  className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                    finding.severity === 'stop'
                      ? 'bg-red-100 text-red-800'
                      : finding.severity === 'check'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {finding.severity}
                </span>
                <span className="font-medium text-slate-900">{finding.what}</span>
                <span className="block text-slate-600">{finding.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {punchList.length > 0 && (
        <Card tone="do" title="Measure these first">
          <p className="text-slate-500">
            Ranked by how much floor area each one's uncertainty puts in doubt, and by how much of
            it the scanner could actually see.
          </p>
          <ol className="space-y-2">
            {punchList.slice(0, 4).map((item, i) => {
              const wall = room.walls.find((w) => w.id === item.wallId);
              if (!wall) return null;
              const o = blocked.get(item.wallId);
              return (
                <li key={item.wallId}>
                  <button
                    type="button"
                    onClick={() => onSelect(item.wallId)}
                    className={`w-full rounded-md border px-3 py-3 text-left ${
                      selected === item.wallId ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <span className="font-medium text-slate-900">
                      {i + 1}. {len(runLength(wall))}
                      {wall.open ? ' opening' : ''}
                      {isDiagonal(wall.heading) ? ' (angled)' : ''}
                    </span>
                    <span className="block text-slate-500">
                      {o && o.blockedLength > 0n ? describe(o) : 'Clear — nothing was against it.'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {openSpans.length > 0 && (
        <Card tone="do" title={`${openSpans.length} edge${openSpans.length === 1 ? '' : 's'} with no wall across`}>
          <p className="text-slate-500">
            The scan found nothing built here. It bounds the floor and the ceiling and takes no
            drywall, paint or baseboard. If that is wrong, fix it now — everything priced off this
            room depends on it.
          </p>
          {openSpans.map((wall) => (
            <div key={wall.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <button
                type="button"
                onClick={() => onSelect(wall.id)}
                className="font-medium text-slate-900 underline decoration-dotted underline-offset-4"
              >
                {len(runLength(wall))} — show me
              </button>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => onMake(wall.id, 'wall')}>It is a wall</Button>
                <Button onClick={() => onMake(wall.id, 'cased')}>It is a cased opening</Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {inTheWay.length > 0 && (
        <Card tone="note" title={`${inTheWay.length} wall${inTheWay.length === 1 ? '' : 's'} the scanner could not see properly`}>
          <p className="text-slate-500">
            Furniture against a wall does not come back wrong in a way anybody notices — it comes
            back plausible. These are the dimensions worth a tape whatever the numbers look like.
          </p>
          <ul className="space-y-2">
            {inTheWay.map((o) => {
              const wall = room.walls.find((w) => w.id === o.wallId)!;
              return (
                <li key={o.wallId}>
                  <button type="button" onClick={() => onSelect(o.wallId)} className="text-left">
                    <span className="font-medium text-slate-900">{len(runLength(wall))}</span>{' '}
                    <span className="text-slate-600">
                      — {Number(o.blockedPerMille) / 10}% behind {o.by.length === 1 ? 'something' : `${o.by.length} things`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {report.dropped.length > 0 && (
        <Card tone="note" title={`${report.dropped.length} wall${report.dropped.length === 1 ? '' : 's'} left out`}>
          {report.dropped.map((wall) => (
            <p key={wall.identifier}>
              <span className="font-medium text-slate-900">{len(wall.length)}</span> — {wall.reason}
            </p>
          ))}
          <p className="text-slate-500">
            There is nothing to do about this here. A wall that is not on this room's outline cannot
            be one of its walls. It becomes useful when rooms are stitched into a floor, which is
            not built yet.
          </p>
        </Card>
      )}

      {report.snapped.length > 0 && (
        <Card tone="note" title={`${report.snapped.length} edge${report.snapped.length === 1 ? '' : 's'} straightened`}>
          <p>
            The largest moved{' '}
            <span className="font-medium text-slate-900">
              {formatMetric(report.snapped.reduce((most, s) => (s.by > most ? s.by : most), 0n), 'mm')}
            </span>
            . RoomPlan squares up its walls and not its floor outline, so this is the two disagreeing
            rather than the room being crooked.
          </p>
          <p className="text-slate-500">
            Whatever that left over was shared out across the scanned walls when the room re-closed.
            Nothing to do — but it is why a scanned dimension is not a measurement.
          </p>
        </Card>
      )}

      {report.recoveredSills.length > 0 && (
        <Card tone="note" title={`${report.recoveredSills.length} window sill worked out, not read`}>
          <p>
            RoomPlan never states a sill height. These were recovered from the window's centre and
            its height, so they carry the same band as everything else the scanner produced.
          </p>
        </Card>
      )}

      <Card tone="note" title="Every dimension, and where it came from">
        <ul className="divide-y divide-slate-100">
          {room.walls.map((wall) => (
            <li key={wall.id}>
              <button
                type="button"
                onClick={() => onSelect(wall.id)}
                // Named after the wall, not after its length. Every rectangular
                // room has two walls the same length, so this list read as two
                // rows saying "20', scanned" and two saying "21', scanned" --
                // identical on screen and identical to a screen reader, with no
                // way to tell which row was which wall. The complete
                // click-through found it as a duplicate accessible name.
                aria-label={`${wall.open ? 'Open span' : 'Wall'} ${wall.id}, ${len(runLength(wall))}`}
                className={`flex w-full items-baseline justify-between gap-3 py-2 text-left ${
                  selected === wall.id ? 'font-semibold text-sky-700' : ''
                }`}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-slate-500">{wall.id}</span>
                  <span className="tabular-nums">{len(runLength(wall))}</span>
                </span>
                <span className="text-xs text-slate-500">
                  <span className="uppercase tracking-wide">
                    {wall.open ? 'no wall here' : confidenceLabel(wall.length)}
                  </span>
                  {toleranceOf(wall.length) > 0n
                    ? ` · could be out by ${formatMetric(toleranceOf(wall.length), 'mm')}`
                    : ' · exact'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
