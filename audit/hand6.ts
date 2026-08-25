import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { toPhoto } from '../core/src/capture.ts';
const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const base=`${SD}/tl-garage/Room 2026-08-24 1819`;
const scan=JSON.parse(readFileSync(`${base}/room.json`,'utf8'));
const man=JSON.parse(readFileSync(`${base}/photos.json`,'utf8'));
const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
const d=r.frame.datum;
const plan=(x:number,z:number):[number,number]=>[x*d.x+(-z)*d.y,-x*d.y+(-z)*d.x];
const m0=scan.floors[0].transform, atf=(c:number,rw:number)=>m0[c*4+rw];
const L:Record<string,number[]>={};
for(const o of scan.objects) L[Object.keys(o.category)[0]]=[o.transform[12],o.transform[13],o.transform[14]];
for(const o of scan.doors||[]) L['DOOR']=[o.transform[12],o.transform[13],o.transform[14]];
scan.floors[0].polygonCorners.forEach((p:number[],i:number)=>{const w=(row:number)=>atf(0,row)*p[0]+atf(1,row)*p[1]+atf(2,row)*p[2]+atf(3,row);L['C'+i]=[w(0),-0.4,w(2)];});
const dot=(a:number[],b:number[])=>a[0]!*b[0]!+a[1]!*b[1]!+a[2]!*b[2]!;
let agree=0,mirror=0,skipped=0;
for(const c of man.photos as any[]){
  const m=c.cameraPoseARFrame,t=[m[12],m[13],m[14]];
  const col=(i:number)=>[m[i*4],m[i*4+1],m[i*4+2]];
  const fx=c.intrinsics[0],cx=c.intrinsics[2],fy=c.intrinsics[4],cy=c.intrinsics[5];
  const th=(90-Math.atan2(m[5],m[1])*180/Math.PI)*Math.PI/180;
  let ph; try{ph=toPhoto(c,r.frame);}catch{continue;}
  const pts:{n:string;rx:number;px:number;py:number}[]=[];
  for(const [n,p] of Object.entries(L)){
    const v=[p[0]!-t[0],p[1]!-t[1],p[2]!-t[2]];
    const xc=dot(v,col(0)),yc=dot(v,col(1)),zc=dot(v,col(2));
    if(zc>=-0.5) continue;
    const u=fx*(xc/-zc)+cx, vv=fy*(-yc/-zc)+cy;
    if(!(60<u&&u<1860&&60<vv&&vv<1380)) continue;
    const sx=u-cx, sy=-(vv-cy);
    const rx=sx*Math.cos(th)-sy*Math.sin(th);
    const [pxx,pyy]=plan(p[0]!,p[2]!);
    pts.push({n,rx,px:Number(BigInt(Math.round(pxx*1e9))-r.frame.origin.x-ph.pose.at.x),py:Number(BigInt(Math.round(pyy*1e9))-r.frame.origin.y-ph.pose.at.y)});
  }
  for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++){
    const A=pts[i]!,B=pts[j]!;
    if(Math.abs(A.rx-B.rx)<120){skipped++;continue;}
    const imageBRightOfA = B.rx>A.rx;               // ground truth from the gravity-aligned photograph
    const cr=A.px*B.py-A.py*B.px;                   // >0 => B is CCW of A in the code's plan
    const planBRightOfA = cr<0;
    if(imageBRightOfA===planBRightOfA) agree++; else mirror++;
  }
}
console.log('landmark pairs where the plan agrees with the photograph:',agree);
console.log('landmark pairs where the plan is MIRRORED vs the photograph:',mirror,'  (skipped, too close:',skipped,')');
