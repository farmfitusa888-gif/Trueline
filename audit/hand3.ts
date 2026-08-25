import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const base=`${SD}/tl-garage/Room 2026-08-24 1819`;
const scan=JSON.parse(readFileSync(`${base}/room.json`,'utf8'));
const manifest=JSON.parse(readFileSync(`${base}/photos.json`,'utf8'));
const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
const d=r.frame.datum;
const plan=(x:number,z:number):[number,number]=>[x*d.x+z*d.y,-x*d.y+z*d.x];
let dets:number[]=[], signs:number[]=[], upy:number[]=[];
for(const c of manifest.photos as any[]){
  const m=c.cameraPoseARFrame;
  const col=(i:number)=>[m[i*4],m[i*4+1],m[i*4+2]];
  const R=col(0),U=col(1),B=col(2);
  // det of [R U B]
  const det=R[0]*(U[1]*B[2]-U[2]*B[1])-U[0]*(R[1]*B[2]-R[2]*B[1])+B[0]*(R[1]*U[2]-R[2]*U[1]);
  dets.push(det);
  const F=[-B[0],-B[1],-B[2]];
  const [fx,fy]=plan(F[0],F[2]);
  const [rx,ry]=plan(R[0],R[2]);
  signs.push(fx*ry-fy*rx);       // cross_plan(forward, cameraRight)
  upy.push(U[1]);
}
const s=(a:number[])=>({min:Math.min(...a).toFixed(4),max:Math.max(...a).toFixed(4)});
console.log('det(cameraBasis)      ', s(dets), ' -> right-handed if +1');
console.log('cross_plan(fwd,right) ', s(signs), ' positive on', signs.filter(v=>v>0).length, 'of', signs.length);
console.log('camera up world-y     ', s(upy));
// same test for the room floor: shoelace sign of the polygon in plan coords vs true overhead
const m=scan.floors[0].transform, at=(c:number,rw:number)=>m[c*4+rw];
const pts=scan.floors[0].polygonCorners.map((p:number[])=>{const w=(row:number)=>at(0,row)*p[0]+at(1,row)*p[1]+at(2,row)*p[2]+at(3,row);return [w(0),w(2)];});
let sh=0; for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length]; sh+=a[0]*b[1]-b[0]*a[1];}
console.log('floor polygon shoelace in (x,z):', sh.toFixed(4));
