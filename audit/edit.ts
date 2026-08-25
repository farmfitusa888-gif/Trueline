import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { makeWall, makeCased, verifyWall } from '../core/src/edit.ts';
import { formatMetric, formatFeetInches, of } from '../core/src/length.ts';
import { closure, runLength, isDiagonal, area, formatSquareFeet } from '../core/src/room.ts';
import { toleranceOf, band } from '../core/src/measurement.ts';
const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const scan=JSON.parse(readFileSync(`${SD}/garage/JSON/room.json`,'utf8'));
const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
const show=(t:string,room:any)=>{console.log(t, 'closure',closure(room), room.walls.map((w:any)=>`${w.id}:${formatMetric(runLength(w),'mm')}${w.open?'(open)':''}${(w.openings??[]).map((o:any)=>` [${o.id}@${formatMetric(o.offsetFromStart.value,'mm')} w${formatMetric(o.width.value,'mm')}]`).join('')}`).join('  '));};
show('imported  ', r.room);
const a=makeWall(r.room,'opening-1');
show('makeWall  ', a);
console.log('  sum of the three merged segments was', formatMetric(572485408n+4814289095n+552509233n,'mm'), ' merged wall tolerance', formatMetric(toleranceOf(a.walls.find(w=>w.id==='wall-3')!.length),'mm'));
const b=makeCased(r.room,'opening-1');
show('makeCased ', b);

// verify a wall with a tape and watch the room re-solve
console.log('\n-- verifyWall: tape says the north wall is 19 ft 6 in (scan said', formatFeetInches(5939283736n)+')');
const v=verifyWall(r.room,'wall-1', of(19,'ft')+of(6,'in'), 'Sam','2026-08-25T12:00:00Z','tape');
console.log('adjustments', v.adjustments.map(x=>`${x.wallId} ${formatMetric(x.by,'mm')}${x.beyondTolerance?' BEYOND-TOLERANCE':''}`).join('  '));
show('after     ', v.room);
for(const w of v.room.walls) console.log('   ',w.id,'prov',w.length.provenance.kind,'tol',formatMetric(toleranceOf(w.length),'mm'),'band',formatMetric(band(w.length).low,'mm'),'..',formatMetric(band(w.length).high,'mm'));
console.log('area before',formatSquareFeet(area(r.room).value),'+/-',formatSquareFeet((area(r.room).provenance as any).tolerance));
console.log('area after ',formatSquareFeet(area(v.room).value),'+/-',formatSquareFeet((area(v.room).provenance as any).tolerance));
