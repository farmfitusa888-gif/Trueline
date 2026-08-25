import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { toPhoto } from '../core/src/capture.ts';

const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const base=`${SD}/tl-garage/Room 2026-08-24 1819`;
const scan=JSON.parse(readFileSync(`${base}/room.json`,'utf8'));
const manifest=JSON.parse(readFileSync(`${base}/photos.json`,'utf8'));
const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
const d=r.frame.datum;
const O:Record<string,number[]>={};
for(const o of scan.objects) O[Object.keys(o.category)[0]]=[o.transform[12],o.transform[13],o.transform[14]];

for(const c of manifest.photos as any[]){
  const m=c.cameraPoseARFrame;
  const t=[m[12],m[13],m[14]];
  const R=[[m[0],m[1],m[2]],[m[4],m[5],m[6]],[m[8],m[9],m[10]]]; // columns: right, up, back
  const fx=c.intrinsics[0], cx=c.intrinsics[2], fy=c.intrinsics[4], cy=c.intrinsics[5];
  const res:Record<string,any>={};
  let ok=true;
  for(const [name,p] of Object.entries(O)){
    const v=[p[0]-t[0],p[1]-t[1],p[2]-t[2]];
    const xc=v[0]*R[0][0]+v[1]*R[0][1]+v[2]*R[0][2];
    const yc=v[0]*R[1][0]+v[1]*R[1][1]+v[2]*R[1][2];
    const zc=v[0]*R[2][0]+v[1]*R[2][1]+v[2]*R[2][2];
    if(zc>=-0.2){continue;}
    const u=fx*(xc/-zc)+cx, vv=fy*(-yc/-zc)+cy;
    if(u<60||u>1860||vv<40||vv>1400){continue;}
    res[name]={u:Math.round(u),v:Math.round(vv)};
  }
  if(Object.keys(res).length<2) continue;
  // plan bearings via the code's own frame
  let ph; try{ ph=toPhoto(c,r.frame);}catch{continue;}
  const f=ph.pose.forward;
  const bearings:Record<string,number>={};
  for(const [name,p] of Object.entries(O)){
    const plan=(x:number,z:number):[number,number]=>[x*d.x+z*d.y,-x*d.y+z*d.x];
    const [px,py]=plan(p[0],p[2]);
    const vx=BigInt(Math.round(px*1e9))-r.frame.origin.x-ph.pose.at.x;
    const vy=BigInt(Math.round(py*1e9))-r.frame.origin.y-ph.pose.at.y;
    bearings[name]=Number(f.x*vy-f.y*vx); // cross_plan(forward, v) : >0 = CCW in plan coords
  }
  console.log(c.fileName, JSON.stringify(res), 'crossPlan', Object.fromEntries(Object.entries(bearings).map(([k,v])=>[k,(v as number)>0?'+':'-'])));
}
