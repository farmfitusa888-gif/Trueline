import { useMemo, useState } from 'react';
import type { Room } from '../../core/src/room.ts';
import { useUnits } from './units.tsx';
import { type Boundary, report, roomQuantities, splitByBoundary } from '../../core/src/zone.ts';
import { wallSchedule } from '../../core/src/takeoff.ts';
import { type WorkScope, describeScope } from '../../core/src/work.ts';
import { sheetOf } from './quoteOf.ts';
import { type Readiness, trustLabel } from '../../core/src/issue.ts';
import { order, tradeOf, wordFor } from '../../core/src/trade.ts';

/**
 * What this room takes.
 *
 * The four numbers a contractor actually prices off — floor, ceiling, the wall
 * face that takes drywall and paint, and the baseboard run. Every one of them
 * has been computable since `quantities()` was written and none of them has
 * ever reached a screen, because the plan stopped at "here is your room" and
 * left the arithmetic on a notepad at eleven at night.
 *
 * What comes *off* is the part worth reading twice. A door takes its width out
 * of the baseboard and its whole opening out of the paintable face. A window
 * takes nothing off the baseboard, because the baseboard runs underneath it. A
 * side of the room with nothing built across it — a garage door — takes no
 * drywall, no paint and no baseboard, and is reported separately rather than
 * quietly priced as wall.
 *
 * These inherit the room's honesty exactly. They are the sensor's numbers until
 * a tape has been on one wall running each way, and the card says so in the
 * same words the rest of the app uses rather than printing four figures as if
 * they were facts.
 */

export function Takeoff({
  room,
  readiness,
  divide = null,
  scope = null,
  onSetThickness,
  onScope,
}: {
  readonly room: Room;
  readonly readiness: Readiness;
  /**
   * What is actually being done to each surface, once somebody has said.
   *
   * `null` is a room nobody has scoped, and it is priced the way this app has
   * always priced one: every surface as if it were being replaced. That is the
   * right answer for a room nobody has said anything about, and it is the wrong
   * answer for most jobs — so the sheet says which of the two it is rather than
   * letting a full-replacement figure pass for a considered one.
   */
  readonly scope?: WorkScope | null;
  /** Takes somebody to where what-is-being-done is decided. */
  readonly onScope?: () => void;
  /**
   * Takes somebody to where a wall's thickness is set.
   *
   * The sentence below used to name four walls that were not being counted and
   * stop there — a statement of a problem with no way to it. Framing is on the
   * rate list, so somebody who has typed a Studs rate and sees no Studs line
   * has been told the reason and given nothing to do about it.
   */
  readonly onSetThickness?: () => void;
  /** How the space is split, when it is. */
  readonly divide?: {
    readonly boundary: Boundary;
    readonly names: readonly [string, string];
  } | null;
}) {
  const { area, len, run, company } = useUnits();
  const [open, setOpen] = useState(false);
  const [told, setTold] = useState<string | null>(null);
  const sheet = useMemo(
    () => sheetOf(room, company, scope, new Date().toLocaleString()),
    [room, company, scope]
  );

  /**
   * The same takeoff, split the way the space is split.
   *
   * Beside the whole-room sheet rather than instead of it. The whole is what
   * gets ordered — one delivery of flooring, one order of board — and the
   * split is what gets priced and scheduled, and a screen that shows only one
   * of them makes somebody do the other by hand.
   */
  const perZone = useMemo(() => {
    if (!divide) return null;
    try {
      const zones = splitByBoundary(room, divide.boundary, divide.names);
      return { report: report(room, zones), trouble: null as string | null };
    } catch (error) {
      return { report: null, trouble: error instanceof Error ? error.message : String(error) };
    }
  }, [room, divide]);

  /**
   * Every wall, with what it measures and who stands behind the number.
   *
   * A schedule is a drawing deliverable in its own right -- it is what a
   * framer or a supplier reads instead of counting lines off a plan -- and
   * `wallSchedule` has produced one since `takeoff.ts` was written without
   * anything calling it. Shown under Show, and sent with the takeoff, because
   * a table nobody can copy is a table nobody uses.
   */
  const schedule = useMemo(() => wallSchedule(room), [room]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${sheet.text}\n\nEVERY WALL\n${schedule}`);
      setTold('Copied.');
    } catch {
      setTold('This browser would not let the app reach the clipboard.');
    }
  }

  async function send() {
    // Web Share is what puts this into Messages on an iPhone, which is how a
    // takeoff actually reaches whoever is pricing it.
    if (!navigator.share) {
      void copy();
      return;
    }
    try {
      await navigator.share({
        title: `${room.name} — takeoff`,
        text: `${sheet.text}\n\nEVERY WALL\n${schedule}`,
      });
    } catch (error) {
      // Cancelling is not failing. Anything else is, and falling back to the
      // clipboard beats a button that silently does nothing twice.
      if (!(error instanceof DOMException && error.name === 'AbortError')) void copy();
    }
  }

  function spreadsheet() {
    // A file, because the person who prices this is at a desk and the thing
    // they price in eats CSV. Built and revoked in the same breath: a blob URL
    // left behind is a copy of somebody's building held in memory.
    try {
      const blob = new Blob([sheet.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${room.name.replace(/[^\w -]/g, '')} takeoff.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setTold('Saved as a spreadsheet.');
    } catch (error) {
      setTold(error instanceof Error ? error.message : 'The file could not be made.');
    }
  }
  const q = useMemo(() => {
    try {
      return { it: roomQuantities(room), trouble: null as string | null };
    } catch (error) {
      return { it: null, trouble: error instanceof Error ? error.message : String(error) };
    }
  }, [room]);

  if (!q.it) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <h2 className="font-semibold">The quantities could not be worked out</h2>
        <p className="mt-1">{q.trouble}</p>
      </section>
    );
  }

  const trade = tradeOf(company.trade);

  /**
   * The sheet, built from what the takeoff actually produced.
   *
   * ## The bug this shape exists to end
   *
   * The four figures were hand-written here and the rest of the sheet was
   * `sheet.lines.filter((line) => line.group !== undefined)`. Doors, windows
   * and cased openings carry no group -- they are finishes, not framing -- so
   * that filter dropped them, and **the takeoff screen never told anybody there
   * was a door in the room.** The count was computed, it went into the text
   * somebody shares and into the CSV somebody prices off, and the screen the
   * contractor actually reads left it out.
   *
   * That is the worst kind of bug this app can have: not a wrong number, a
   * missing one, on the sheet somebody orders material from.
   *
   * So nothing is hand-listed any more. Every row comes from `sheet.lines`, and
   * a line the engine learns to produce tomorrow appears here without anybody
   * remembering to add it. `web/audit/a17-takeoff.mjs` fails if one ever stops
   * arriving.
   *
   * ## Why the values are still overridden
   *
   * `TakeoffLine.quantity` is written in feet, because the text and the CSV go
   * to a lumber yard and a spreadsheet. The screen follows whichever units this
   * contractor set, so the ones the app can convert are re-rendered through
   * `area` and `run`. A count of doors is a count in any unit and is left
   * exactly as the engine wrote it.
   */
  const shown = useMemo(() => {
    const inMyUnits: Record<string, string> = {
      Floor: area(q.it!.floorArea),
      Ceiling: area(q.it!.ceilingArea),
      'Wall face': area(2n * q.it!.wallFaceArea),
      Baseboard: run(q.it!.baseboardRun),
      'Open span': run(q.it!.openRun),
    };
    /**
     * A scoped line carries its own exact value and is converted from that.
     *
     * `inMyUnits` above re-renders the WHOLE room's four figures over the top
     * of the line names, which was harmless while every sheet was the whole
     * room. On a scoped sheet it would print four walls of area beside three
     * walls of money. So the line's own number wins wherever it has one.
     */
    const mine = (line: (typeof sheet.lines)[number]): string | undefined => {
      if (!line.exact) return inMyUnits[line.what];
      if (line.exact.kind === 'area') return area(line.exact.halfSquares);
      if (line.exact.kind === 'run') return run(line.exact.nanometres);
      // A count is a count in any country, and a number somebody typed is his
      // own — converting either would be inventing a measurement.
      return undefined;
    };
    return sheet.lines.map((line) => ({
      ...line,
      value: mine(line) ?? `${line.quantity} ${line.unit}`,
      /** True for the ones somebody orders material against by the sheet. */
      big: line.unit === 'sq ft' || line.what === 'Baseboard',
    }));
  }, [sheet.lines, q.it, area, run]);

  /**
   * In the order this trade cares about, under the engine's own headings.
   *
   * A painter opens this wanting wall face; a flooring contractor wants the
   * floor. `order` has been able to put their line first since the trade
   * vocabulary was built -- it just had four hand-written rows to work with
   * instead of the whole sheet.
   */
  /**
   * Whether the sheet is of two minds about itself.
   *
   * Six rows all reading SCANNED is the bug the dimension list had and the tag
   * list nearly had: a column where every cell is identical carries nothing,
   * and it costs the row that IS different its only way of standing out. The
   * sentence under the buttons already says what the whole sheet is.
   *
   * So the per-line word appears only when the lines disagree — which happens
   * the moment somebody tapes a wall, because opening sizes stay the
   * scanner's. That is exactly the moment it is worth reading.
   */
  const mixed = useMemo(
    () => new Set(shown.map((line) => line.provenance)).size > 1,
    [shown]
  );

  const blocks = useMemo(() => {
    const names: string[] = [];
    for (const line of shown) {
      const name = line.group ?? '';
      if (!names.includes(name)) names.push(name);
    }
    return names.map((name) => ({
      name,
      lines: order(trade, shown.filter((line) => (line.group ?? '') === name)),
    }));
  }, [shown, trade]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">What this room takes</h2>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          /* It already folded back — More becomes Less — and said nothing
             about it: no `aria-expanded`, so anybody listening was told about
             a button with nothing behind it. The two words stay as they are;
             renaming them to Open and Close would say the sheet above
             disappears, and it does not. */
          aria-expanded={open}
          aria-controls="every-wall"
          className="inline-flex min-h-12 items-center gap-1 px-2 text-sm text-slate-500
                     underline underline-offset-4"
        >
          {open ? 'Less' : 'More'}
          <svg
            viewBox="0 0 16 16" aria-hidden="true"
            className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor"
                  strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Which kind of sheet this is, said before any number on it is read.
          A full-replacement takeoff and a scoped one look identical and are
          completely different claims about a job. */}
      {!sheet.scoped ? (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">Everything in this room is priced as replaced</span> —
          the whole floor, the whole ceiling, every wall face and all the baseboard. Nothing has
          been left out.
          {onScope && (
            <>
              {' '}
              <button
                type="button"
                onClick={onScope}
                className="min-h-11 font-semibold underline underline-offset-4"
              >
                Say what is actually being done
              </button>
            </>
          )}
        </p>
      ) : (
        <p className="mt-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
          {/* The sentence comes from the model, not from this screen. The
              takeoff's own text prints the same thing, and two files writing
              the same sentence is two files that will eventually say different
              things about one job. */}
          {scope ? describeScope(room, scope) : ''}
          {onScope && (
            <>
              {' '}
              <button
                type="button"
                onClick={onScope}
                className="min-h-11 font-semibold underline underline-offset-4"
              >
                Change it
              </button>
            </>
          )}
        </p>
      )}

      {sheet.measuresNothing.length > 0 && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Picked, and there is none of it there: {sheet.measuresNothing.join('; ')}. Left off the
          sheet rather than put on it at nothing.
        </p>
      )}

      {sheet.stranded.length > 0 && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Picked on part of the room that is not there any more, so it is not counted:{' '}
          {sheet.stranded.join('; ')}. The room changed after you decided this.
        </p>
      )}

      {blocks.map((block) => (
        <div key={block.name || 'finishes'}>
          {/* A heading only where the engine gave one. The finishes have no
              group and want none: they are the sheet. */}
          {block.name && (
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {block.name}
            </h3>
          )}
          <dl className="mt-1 divide-y divide-slate-100">
            {block.lines.map((line) => (
              <div key={line.what} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="min-w-0">
                  <span className="text-slate-700">{wordFor(trade, line.what)}</span>
                  {/* Where the number came from, under it, always.
                      This is the one screen where a figure turns into an order,
                      and "built walls x their height, less every door and
                      window" is the sentence that lets somebody check it
                      against their own head. It was behind a Show link, which
                      is where an explanation goes to never be read. */}
                  <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                    {line.workings}
                    {open && <span className="block text-slate-400">prices {line.prices}</span>}
                  </span>
                </dt>
                <dd className="shrink-0 text-right">
                  <span
                    className={`block font-mono tabular-nums text-slate-900 ${
                      line.big ? 'text-lg font-semibold' : 'font-medium'
                    }`}
                  >
                    {line.value}
                  </span>
                  {/* The same two words, in the same two colours, this app uses
                      on a wall — and only where the sheet disagrees with
                      itself. A takeoff line is exactly as trustworthy as the
                      walls under it, and this is where that stops being an
                      abstraction and starts being money. */}
                  {mixed && (
                    <span
                      className={`block font-mono text-[10px] uppercase tracking-wider ${
                        line.provenance === 'measured' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {line.provenance}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}

      {/* The wall schedule, behind More with the workings. It is a monospaced
          table on purpose: it is read down a column.

          One of it. This block was written out twice, one immediately after
          the other, so pressing More printed the whole schedule and then
          printed it again — found while giving the button an `aria-controls`,
          which cannot point at two elements with one id. */}
      {open && (
        <div id="every-wall" className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Every wall
          </h3>
          <div className="mt-1 overflow-x-auto rounded-md bg-slate-100 p-3">
            <pre className="whitespace-pre font-mono text-xs leading-relaxed text-slate-800">{schedule}</pre>
          </div>
        </div>
      )}

      {/* The same numbers, split the way the space is. Below the whole rather
          than instead of it: the whole is what gets ordered, and the split is
          what gets priced and scheduled. */}

      {perZone?.report && (
        <div className="mt-5 rounded-md border border-violet-200 bg-violet-50 p-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-violet-900">
            And split into {perZone.report.zones.map((z) => z.zone.name).join(' and ')}
          </h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {perZone.report.zones.map(({ zone, quantities }) => (
              <dl key={zone.id} className="rounded-md bg-white p-3 text-sm">
                <p className="mb-1 font-semibold text-slate-900">{zone.name}</p>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-600">{wordFor(trade, 'Floor')}</dt>
                  <dd className="font-semibold font-mono tabular-nums">{area(quantities.floorArea)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-600">{wordFor(trade, 'Wall face')}</dt>
                  <dd className="font-semibold font-mono tabular-nums">
                    {area(quantities.wallFaceArea * 2n)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-600">{wordFor(trade, 'Baseboard')}</dt>
                  <dd className="font-semibold font-mono tabular-nums">{len(quantities.baseboardRun)}</dd>
                </div>
              </dl>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-violet-900">
            The two floors add up to the whole room to the square inch, checked every time. The{' '}
            {len(perZone.report.total.virtualRun)} between them is a line somebody drew: it bounds
            floor area and carries no drywall, no paint and no base, because nothing was ever
            built along it.
          </p>
        </div>
      )}

      {perZone?.trouble && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-900">
          The split could not be worked out, so only the whole room is shown: {perZone.trouble}
        </p>
      )}

      {sheet.withoutThickness.length > 0 && (
        <p className="mt-2 text-sm text-slate-600">
          No plates, studs or headers for {sheet.withoutThickness.join(', ')} — framing needs a
          wall thickness and {sheet.withoutThickness.length === 1 ? 'it has' : 'they have'} not
          been given one. A scan cannot see inside a wall, so this is the one number that has to
          be said rather than measured.
          {onSetThickness && (
            <>
              {' '}
              <button
                type="button"
                onClick={onSetThickness}
                className="min-h-11 font-semibold text-slate-900 underline underline-offset-4"
              >
                Set it now
              </button>
            </>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => void send()}
          className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
        >
          Send it
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-12 rounded-md border border-slate-300 px-4 font-medium text-slate-700 active:bg-slate-100"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={spreadsheet}
          className="min-h-12 rounded-md border border-slate-300 px-4 font-medium text-slate-700 active:bg-slate-100"
        >
          Spreadsheet
        </button>
      </div>
      {told && (
        <p aria-live="polite" className="mt-2 text-sm text-slate-600">
          {told}
        </p>
      )}

      <p className="mt-2 text-sm text-slate-600">
        {readiness.blocking.length > 0 ? (
          <>
            <span className="font-semibold text-slate-900">
              These are the scanner&rsquo;s numbers, not measurements.
            </span>{' '}
            They move when you put a tape on a wall. {trustLabel(readiness.trust)}.
          </>
        ) : (
          <>Built from the walls above — {trustLabel(readiness.trust).toLowerCase()}.</>
        )}
      </p>
    </section>
  );
}
