/**
 * A DXF file is a flat list of (group code, value) pairs, two lines each. That
 * is the whole format at this level, and it is enough to add what a writer left
 * out without depending on that writer.
 *
 * Everything here is text in, text out. No library, no floating point beyond
 * what the file already contains, and nothing that needs a DXF dependency in a
 * package whose job is exact geometry.
 */

export interface Tag {
  readonly code: number;
  readonly value: string;
}

export class DxfTextError extends Error {}

export function parseTags(dxf: string): Tag[] {
  const lines = dxf.split(/\r\n|\r|\n/);
  const tags: Tag[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const raw = lines[i]!.trim();
    if (raw === '') continue;
    const code = Number(raw);
    if (!Number.isInteger(code)) {
      throw new DxfTextError(`Line ${i + 1} of the DXF is "${raw}", which is not a group code.`);
    }
    tags.push({ code, value: lines[i + 1]! });
  }
  return tags;
}

export function writeTags(tags: readonly Tag[]): string {
  const out: string[] = [];
  for (const t of tags) {
    out.push(String(t.code));
    out.push(t.value);
  }
  return out.join('\n') + '\n';
}

/** Index of the tag opening the named section, or -1. */
export function findSection(tags: readonly Tag[], name: string): number {
  for (let i = 0; i + 1 < tags.length; i += 1) {
    if (tags[i]!.code === 0 && tags[i]!.value === 'SECTION' &&
        tags[i + 1]!.code === 2 && tags[i + 1]!.value === name) {
      return i;
    }
  }
  return -1;
}

/** Index of the ENDSEC closing the section that starts at `start`. */
export function findEndOfSection(tags: readonly Tag[], start: number): number {
  for (let i = start; i < tags.length; i += 1) {
    if (tags[i]!.code === 0 && tags[i]!.value === 'ENDSEC') return i;
  }
  throw new DxfTextError('A section in this DXF is never closed by ENDSEC.');
}

/**
 * Splits a section's body into one array of tags per entity, where an entity
 * starts at each group code 0.
 */
export function splitEntities(tags: readonly Tag[], start: number, end: number): Tag[][] {
  const out: Tag[][] = [];
  let current: Tag[] | null = null;
  for (let i = start; i < end; i += 1) {
    const tag = tags[i]!;
    if (tag.code === 0) {
      if (current) out.push(current);
      current = [tag];
    } else if (current) {
      current.push(tag);
    }
  }
  if (current) out.push(current);
  return out;
}

export function first(entity: readonly Tag[], code: number): string | undefined {
  return entity.find((t) => t.code === code)?.value;
}

export function firstNumber(entity: readonly Tag[], code: number): number | undefined {
  const v = first(entity, code);
  return v === undefined ? undefined : Number(v);
}

/** The largest handle in the file, so new objects can be given unused ones. */
export function highestHandle(tags: readonly Tag[]): number {
  let top = 0;
  for (const t of tags) {
    if (t.code === 5 || t.code === 105) {
      const n = parseInt(t.value, 16);
      if (Number.isFinite(n) && n > top) top = n;
    }
  }
  return top;
}
