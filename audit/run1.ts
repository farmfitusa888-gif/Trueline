import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { formatFeetInches, formatMetric, hypotenuse } from '../core/src/length.ts';
import { area, corners, closure, formatSquareFeet, runLength, isDiagonal, perimeter } from '../core/src/room.ts';

const SD = '/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
export const FILES: [string, string][] = [
  ['kitchen', `${SD}/kitchen/JSON/room.json`],
  ['garage', `${SD}/garage/JSON/room.json`],
  ['tl-garage', `${SD}/tl-garage/Room 2026-08-24 1819/room.json`],
];

export function load(p: string) { return JSON.parse(readFileSync(p, 'utf8')); }

for (const [name, path] of FILES) {
  console.log('\n================', name);
  const scan = load(path);
  const r = importRoomPlan(scan, { at: '2026-08-25T00:00:00Z' });
  console.log('room walls:', r.room.walls.length);
  for (const w of r.room.walls) {
    console.log(' ', w.id.padEnd(12), (isDiagonal(w.heading) ? `diag(${w.heading.run.x},${w.heading.run.y})` : w.heading).padEnd(28),
      formatFeetInches(w.length.value).padEnd(14), formatMetric(w.length.value,'mm').padEnd(16), w.open ? 'OPEN' : '', (w.openings??[]).map(o=>o.kind+':'+o.id).join(','));
  }
  console.log('ceiling', formatMetric(r.room.ceilingHeight.value,'mm'));
  console.log('closure', closure(r.room));
  console.log('area', formatSquareFeet(area(r.room).value), 'tol', area(r.room).provenance.kind === 'derived' ? (area(r.room).provenance as any).tolerance : '');
  console.log('perimeter', formatFeetInches(perimeter(r.room).value));
  console.log('corners', corners(r.room).map(c=>`(${c.x},${c.y})`).join(' '));
  console.log('report.snapped', r.report.snapped);
  console.log('report.diagonals', r.report.diagonals);
  console.log('report.dropped', r.report.dropped.map(d=>[d.identifier, formatMetric(d.length,'mm')]));
  console.log('closureBeforeSolving', r.report.closureBeforeSolving);
  console.log('openings', r.report.openings);
  console.log('footprints', r.footprints.map(f=>({id:f.id.slice(0,8),cat:f.category,min:[formatMetric(f.min.x,'mm'),formatMetric(f.min.y,'mm')],max:[formatMetric(f.max.x,'mm'),formatMetric(f.max.y,'mm')]})));
  console.log('frame', r.frame);
  for (const n of r.report.notes) console.log('  note:', n);
}
