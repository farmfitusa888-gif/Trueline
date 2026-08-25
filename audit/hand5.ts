import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { toPhoto } from '../core/src/capture.ts';
const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const base=`${SD}/tl-garage/Room 2026-08-24 1819`;
const scan=JSON.parse(readFileSync(`${base}/room.json`,'utf8'));
const man=JSON.parse(readFileSync(`${base}/photos.json`,'utf8'));
const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
const d=r.frame.datum;
const plan=(x:number,z:number):[number,number]=>[x*d.x+z*d.y,-x*d.y+z*d.x];
const m0=scan.floors[0].transform, atf=(c:number,rw:number)=>m0[c*4+rw];
const corner=(i:number)=>{const p=scan.floors[0].polygonCorners[i];const w=(row:number)=>atf(0,row)*p[0]+atf(1,row)*p[1]+atf(2,row)*p[2]+atf(3,row);return [w(0),w(2)];};
const tv=scan.objects.find((o:any)=>o.category.television);
const targets:[string,number[]][]=[['C1',corner(1)],['television',[tv.transform[12],tv.transform[14]]]];
for (const name of ['photo_00007.jpg','photo_00005.jpg','photo_00008.jpg','photo_00054.jpg','photo_00051.jpg','photo_00046.jpg']) {
  const c=man.photos.find((p:any)=>p.fileName===name);
  const ph=toPhoto(c,r.frame);
  const vs=targets.map(([n,p])=>{const [px,py]=plan(p[0],p[1]);
    return {n, x:Number(BigInt(Math.round(px*1e9))-r.frame.origin.x-ph.pose.at.x), y:Number(BigInt(Math.round(py*1e9))-r.frame.origin.y-ph.pose.at.y)};});
  const cr=vs[0]!.x*vs[1]!.y - vs[0]!.y*vs[1]!.x;
  console.log(name,'cross_plan(C1 -> television) =', (cr/1e18).toFixed(3), cr>0?'CCW  => plan says TV is to the LEFT of C1':'CW => plan says TV is to the RIGHT of C1');
}
