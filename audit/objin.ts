import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { insidePlan } from '../core/src/section.ts';
import { formatMetric } from '../core/src/length.ts';
const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
for(const [n,p] of [['kitchen',`${SD}/kitchen/JSON/room.json`],['garage',`${SD}/garage/JSON/room.json`],['tl-garage',`${SD}/tl-garage/Room 2026-08-24 1819/room.json`]] as [string,string][]){
  const scan=JSON.parse(readFileSync(p,'utf8'));
  const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
  for(const f of r.footprints){
    const c={x:(f.min.x+f.max.x)/2n,y:(f.min.y+f.max.y)/2n};
    console.log(n,f.category.padEnd(12),'centre',formatMetric(c.x,'mm').padEnd(16),formatMetric(c.y,'mm').padEnd(16), insidePlan(r.room,c)?'inside':'*** OUTSIDE THE ROOM OUTLINE ***');
  }
}
