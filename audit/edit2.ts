import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { makeWall, makeCased } from '../core/src/edit.ts';
import { formatMetric } from '../core/src/length.ts';
import { runLength } from '../core/src/room.ts';
import { cutAt } from '../core/src/section.ts';
const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const scan=JSON.parse(readFileSync(`${SD}/garage/JSON/room.json`,'utf8'));
const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
const dump=(t:string,room:any)=>{
  console.log(t);
  let drywall=0;
  for(const w of room.walls){
    const h=(w.height??room.ceilingHeight).value;
    const aa=Number(runLength(w))*Number(h)/1e18;
    if(!w.open) drywall+=aa;
    console.log('  ',w.id.padEnd(10),'len',formatMetric(runLength(w),'mm').padEnd(16),'height',formatMetric(h,'mm').padEnd(14), w.height?'(own)':'(room ceiling)', w.open?'OPEN':'', 'face m2', aa.toFixed(3),
      (w.openings??[]).map((o:any)=>` op ${o.id} h=${formatMetric(o.height.value,'mm')}${o.height.value>h?'  *** TALLER THAN ITS WALL ***':''}`).join(''));
  }
  console.log('   total built wall face area m2', drywall.toFixed(3), '=', (drywall*10.7639).toFixed(1),'sq ft');
};
dump('IMPORTED',r.room);
dump('AFTER makeWall("opening-1")  [the garage door is really a wall]', makeWall(r.room,'opening-1'));
dump('AFTER makeCased("opening-1") [the garage door is really a cased opening]', makeCased(r.room,'opening-1'));
const v=cutAt(makeCased(r.room,'opening-1'),{height:1219200000n});
console.log('cut@4ft after makeCased:', JSON.stringify(v.walls.map(w=>({id:w.wallId,drawnTo:String(w.drawnTo),cut:w.cut,openingsCut:w.openingsCut}))));
