import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { area, corners, runLength, isDiagonal, type Room } from '../core/src/room.ts';
import { toleranceOf } from '../core/src/measurement.ts';
import { formatSquareFeet, HALF_NM2_PER_SQ_FOOT } from '../core/src/room.ts';

const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const FILES:[string,string][]=[['kitchen',`${SD}/kitchen/JSON/room.json`],['garage',`${SD}/garage/JSON/room.json`],['tl-garage',`${SD}/tl-garage/Room 2026-08-24 1819/room.json`]];
const sq=(v:bigint)=>Number(v)/Number(HALF_NM2_PER_SQ_FOOT);
for(const [name,path] of FILES){
  const scan=JSON.parse(readFileSync(path,'utf8'));
  const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
  const base=area(r.room);
  const claimed=(base.provenance as any).tolerance as bigint;
  // exact partial derivatives: perturb each wall length by its own tolerance, one at a time
  let worstSum=0n;
  const terms:string[]=[];
  for(const w of r.room.walls){
    if(isDiagonal(w.heading)) continue;
    const t=toleranceOf(w.length);
    const bump=(sign:bigint):bigint=>{
      const walls=r.room.walls.map(x=>x.id===w.id?{...x,length:{...x.length,value:x.length.value+sign*t}}:x);
      const pts=corners({...r.room,walls} as Room);
      let two=0n; for(let i=0;i<pts.length;i++){const a=pts[i]!,b=pts[(i+1)%pts.length]!;two+=a.x*b.y-b.x*a.y;}
      return two<0n?-two:two;
    };
    const d=[bump(1n)-base.value, bump(-1n)-base.value].map(v=>v<0n?-v:v);
    const m=d[0]!>d[1]!?d[0]!:d[1]!;
    worstSum+=m;
    terms.push(`${w.id}:${sq(m).toFixed(2)}`);
  }
  console.log(name, 'area', formatSquareFeet(base.value));
  console.log('   claimed band  +/-', sq(claimed).toFixed(2), 'sq ft   (2*sum(len*tol))');
  console.log('   true worst-case sum of one-wall excursions +/-', sq(worstSum).toFixed(2), 'sq ft', worstSum>claimed?'  *** CLAIMED BAND IS TOO SMALL ***':'(bound holds)');
  console.log('   per-wall:', terms.join(' '));
}
