import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { obstructions, DEFAULT_REACH } from '../core/src/obstruction.ts';
import { corners } from '../core/src/room.ts';
import { formatMetric } from '../core/src/length.ts';
import { heightsAboveFloor, PLAUSIBLE_CAMERA_HEIGHT } from '../core/src/capture.ts';
import { checkCapture } from '../core/src/health.ts';

const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const FILES:[string,string][]=[['kitchen',`${SD}/kitchen/JSON/room.json`],['garage',`${SD}/garage/JSON/room.json`],['tl-garage',`${SD}/tl-garage/Room 2026-08-24 1819/room.json`]];

console.log('--- object local-Y vs world up, and dimension ordering ---');
for(const [name,path] of FILES){
  const scan=JSON.parse(readFileSync(path,'utf8'));
  for(const o of scan.objects??[]){
    const m=o.transform;
    console.log(' ',name,Object.keys(o.category)[0].padEnd(14),'dims',o.dimensions.map((x:number)=>x.toFixed(3)).join('/'),
      'localY=',[m[4],m[5],m[6]].map((x:number)=>x.toFixed(3)).join(','),
      'localX.y=',m[1].toFixed(4),'localZ.y=',m[9].toFixed(4));
  }
}
console.log('\n--- wall local-X tilt (y component of the wall long axis) ---');
for(const [name,path] of FILES){
  const scan=JSON.parse(readFileSync(path,'utf8'));
  console.log(' ',name, scan.walls.map((w:any)=>w.transform[1].toExponential(2)).join(' '));
}

console.log('\n--- true distance from each blocking object to the wall it is said to block ---');
for(const [name,path] of FILES){
  const scan=JSON.parse(readFileSync(path,'utf8'));
  const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
  const pts=corners(r.room);
  for(const o of obstructions(r.room,r.footprints)){
    if(o.blockedLength===0n) continue;
    const i=r.room.walls.findIndex(w=>w.id===o.wallId);
    const a=pts[i]!,b=pts[(i+1)%pts.length]!;
    for(const id of o.by){
      const f=r.footprints.find(x=>x.id===id)!;
      // min distance from AABB to segment, sampled
      let best=Infinity;
      for(let k=0;k<=500;k++){const t=k/500;
        const px=Number(a.x)+(Number(b.x)-Number(a.x))*t, py=Number(a.y)+(Number(b.y)-Number(a.y))*t;
        const dx=Math.max(Number(f.min.x)-px,0,px-Number(f.max.x));
        const dy=Math.max(Number(f.min.y)-py,0,py-Number(f.max.y));
        best=Math.min(best,Math.hypot(dx,dy));}
      console.log(' ',name,o.wallId,'blocked by',f.category,id.slice(0,8),'true gap',(best/1e6).toFixed(1),'mm', best>Number(DEFAULT_REACH)?'  *** FURTHER THAN THE 6 in REACH ***':'');
    }
  }
}

console.log('\n--- health camera-height finding: what it reports when the poses are in the wrong frame ---');
const base=`${SD}/tl-garage/Room 2026-08-24 1819`;
const scan=JSON.parse(readFileSync(`${base}/room.json`,'utf8'));
const man=JSON.parse(readFileSync(`${base}/photos.json`,'utf8'));
const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
const level=BigInt(Math.round((scan.walls[0].transform[13]-scan.walls[0].dimensions[1]/2)*1e9));
// lift a handful of poses by 3 m, as a frame mismatch would
const broken={...man, photos: man.photos.map((p:any,i:number)=> i%10===0 ? {...p, cameraPoseARFrame:[...p.cameraPoseARFrame.slice(0,13), p.cameraPoseARFrame[13]+3, ...p.cameraPoseARFrame.slice(14)]} : p)};
const hs=heightsAboveFloor(broken,level);
const odd=hs.filter(h=>h<PLAUSIBLE_CAMERA_HEIGHT.low||h>PLAUSIBLE_CAMERA_HEIGHT.high);
console.log(' odd heights are', odd.map(h=>formatMetric(h,'mm')).join(', '));
for(const f of checkCapture({room:r.room,report:r.report,cameraHeights:hs})) if(f.severity==='stop'&&f.what.includes('same room')) console.log(' FINDING SAYS:',f.detail.split('.')[0]);
