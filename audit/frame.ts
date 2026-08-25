import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { corners } from '../core/src/room.ts';
import { obstructions } from '../core/src/obstruction.ts';
import { insidePlan } from '../core/src/section.ts';

const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const FILES:[string,string][]=[['kitchen',`${SD}/kitchen/JSON/room.json`],['garage',`${SD}/garage/JSON/room.json`],['tl-garage',`${SD}/tl-garage/Room 2026-08-24 1819/room.json`]];

for(const [name,path] of FILES){
  const scan=JSON.parse(readFileSync(path,'utf8'));
  const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
  const d=r.frame.datum;
  const m=scan.floors[0].transform;
  const at=(c:number,rr:number)=>m[c*4+rr];
  const outline=scan.floors[0].polygonCorners.map((p:number[])=>{
    const w=(row:number)=>at(0,row)*p[0]+at(1,row)*p[1]+at(2,row)*p[2]+at(3,row);
    const x=w(0), z=w(2);
    return {x:x*d.x+z*d.y, y:-x*d.y+z*d.x};
  });
  const origin={x:Number(r.frame.origin.x)/1e9,y:Number(r.frame.origin.y)/1e9};
  const cs=corners(r.room).map(c=>({x:Number(c.x)/1e9,y:Number(c.y)/1e9}));
  console.log('==',name,'outline pts',outline.length,'room corners',cs.length);
  if(outline.length===cs.length){
    let worst=0;
    for(let i=0;i<cs.length;i++){
      const ox=outline[i].x-origin.x, oy=outline[i].y-origin.y;
      const dd=Math.hypot(cs[i].x-ox, cs[i].y-oy);
      if(dd>worst)worst=dd;
      console.log('  corner',i,'chain',cs[i].x.toFixed(4),cs[i].y.toFixed(4),' outline',ox.toFixed(4),oy.toFixed(4),' delta mm',(dd*1000).toFixed(3));
    }
    console.log('  WORST corner displacement mm', (worst*1000).toFixed(3));
  }
  // obstruction summary
  const obs=obstructions(r.room,r.footprints);
  for(const o of obs) if(o.blockedLength>0n) console.log('  blocked',o.wallId,'perMille',o.blockedPerMille,'by',o.by.map(x=>x.slice(0,8)));
}
