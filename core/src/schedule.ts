import { RoomError } from './room.ts';

/**
 * When the work happens, and how it gets into a calendar.
 *
 * ## Why there is no calendar server here
 *
 * Every platform this competes with runs a scheduling service, and charges for
 * it. There is nothing a scheduling service does for a two-man crew that the
 * calendar already on the phone does not, and the calendar already on the phone
 * is synced to every device the contractor owns, shared with whoever he has
 * already shared it with, and backed up by somebody else.
 *
 * So a visit goes into **his** calendar, through EventKit on the phone, and out
 * as an **.ics file** for anybody else -- a homeowner, a subcontractor, an
 * adjuster. `.ics` is the calendar format every calendar reads: Apple, Google,
 * Outlook, and the one on the tablet in the site office. Sending one costs
 * nothing, needs no account on either end, and cannot be switched off by a
 * company going out of business.
 *
 * This module is the model and the file. The phone half is `Calendar.swift`.
 */

export class ScheduleError extends RoomError {}

export type VisitKind =
  /** Standing in the room with a tape, before there is a price. */
  | 'measure'
  /** Sitting at the table with the proposal. */
  | 'present'
  /** The work itself. */
  | 'work'
  /** Somebody else's day -- an inspector, a delivery, a sub. */
  | 'other';

export interface Visit {
  readonly id: string;
  readonly kind: VisitKind;
  /** What it is, in the words that will appear in the calendar. */
  readonly what: string;
  /** Where. The job's address, usually. */
  readonly where: string;
  /** ISO 8601 with an offset. A time with no offset is not a time. */
  readonly starts: string;
  readonly ends: string;
  /** Anything the person arriving needs to know. */
  readonly note: string;
}

export const VISIT_TITLE: Readonly<Record<VisitKind, string>> = {
  measure: 'Measure',
  present: 'Present the proposal',
  work: 'Work',
  other: 'Other',
};

export function visitOf(
  id: string,
  kind: VisitKind,
  what: string,
  where: string,
  starts: string,
  ends: string,
  note = ''
): Visit {
  if (!what.trim()) throw new ScheduleError('A visit needs to say what it is.');
  const from = Date.parse(starts);
  const to = Date.parse(ends);
  if (Number.isNaN(from)) throw new ScheduleError(`"${starts}" is not a time this can put in a calendar.`);
  if (Number.isNaN(to)) throw new ScheduleError(`"${ends}" is not a time this can put in a calendar.`);
  if (to <= from) {
    throw new ScheduleError(
      'A visit has to end after it starts. A calendar will take one that does not and ' +
        'then draw it in the wrong place, or not at all.'
    );
  }
  return { id, kind, what: what.trim(), where: where.trim(), starts, ends, note: note.trim() };
}

/** Visits in the order they happen. */
export function inOrder(visits: readonly Visit[]): readonly Visit[] {
  return [...visits].sort((a, b) => Date.parse(a.starts) - Date.parse(b.starts));
}

/** The next one still ahead, or nothing. */
export function next(visits: readonly Visit[], now: string): Visit | undefined {
  const at = Date.parse(now);
  return inOrder(visits).find((visit) => Date.parse(visit.ends) > at);
}

/* ------------------------------------------------------------------- iCal */

/**
 * A time as iCalendar writes it: UTC, no punctuation, trailing Z.
 *
 * Deliberately UTC rather than a local time with a VTIMEZONE. A floating local
 * time is the classic way an appointment lands an hour out after a clock
 * change, and writing a correct VTIMEZONE block means shipping a copy of the
 * world's timezone database. The instant is the instant; every calendar shows
 * it in whatever zone the person reading it is in, which is what they want.
 */
function stamp(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number, w = 2) => `${n}`.padStart(w, '0');
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

/**
 * Escapes a value the way iCalendar requires.
 *
 * Commas, semicolons and backslashes are separators in this format, and a room
 * called "Kitchen, upstairs" writes a broken file without this. Newlines become
 * a literal backslash-n, which is what the format wants rather than a real one.
 */
function escape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Folds a line to 75 octets, as the format requires.
 *
 * Long lines are not a style question here: a description longer than 75 bytes
 * is rejected or truncated by strict readers, and Outlook is a strict reader.
 * Continuations start with a single space. Counted in **bytes** rather than
 * characters, because a folded multi-byte character is a corrupt file.
 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let width = 0;
  let last = 0;
  for (let i = 0; i < line.length; i += 1) {
    const size = new TextEncoder().encode(line[i]!).length;
    // 74 on continuation lines, because the leading space counts.
    if (width + size > (out.length === 0 ? 75 : 74)) {
      out.push(line.slice(start, last));
      start = last;
      width = 0;
    }
    width += size;
    last = i + 1;
  }
  out.push(line.slice(start));
  return out.map((part, index) => (index === 0 ? part : ` ${part}`)).join('\r\n');
}

/**
 * The visits as a calendar file anybody can open.
 *
 * `at` is when the file was written, which the format requires on every event
 * and which is passed in rather than read from the clock so the same visits
 * produce the same bytes twice -- a file that differs every time it is
 * generated cannot be tested and cannot be diffed.
 */
export function icsOf(
  visits: readonly Visit[],
  at: string,
  company = 'ScanToBid'
): string {
  if (visits.length === 0) {
    throw new ScheduleError('There is nothing in the calendar to send.');
  }
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${escape(company)}//ScanToBid//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const visit of inOrder(visits)) {
    lines.push(
      'BEGIN:VEVENT',
      // Stable, so re-sending an updated file updates the appointment somebody
      // already has rather than giving them a second one.
      `UID:${escape(visit.id)}@trueline`,
      `DTSTAMP:${stamp(at)}`,
      `DTSTART:${stamp(visit.starts)}`,
      `DTEND:${stamp(visit.ends)}`,
      `SUMMARY:${escape(visit.what)}`
    );
    if (visit.where) lines.push(`LOCATION:${escape(visit.where)}`);
    if (visit.note) lines.push(`DESCRIPTION:${escape(visit.note)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // CRLF, which the format requires and which is not a preference: readers that
  // accept bare newlines exist, and readers that do not also exist.
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** What to call the file. */
export function icsName(jobName: string): string {
  const safe = jobName.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-') || 'job';
  return `${safe}.ics`;
}
