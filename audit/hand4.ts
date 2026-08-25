import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { toPhoto } from '../core/src/capture.ts';
const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const base=`${SD}/tl-garage/Room 2026-08-24 1819`;
const scan=JSON.parse(readFileSync(`${base}/room.json`,'utf8'));
const manifest=JSON.parse(readFileSync(`${base}/photos.json`,'utf8'));
const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
const d=r.frame.datum;
const m=scan.floors[0].transform, atf=(c:number,rw:number)=>m[c*4+rw];
// world corners of the floor polygon
const world=scan.floors[0].polygonCorners.map((p:number[])=>{const w=(row:number)=>atf(0,row)*p[0]+atf(1,row)*p[1]+atf(2,row)*p[2]+atf(3,row);return [w(0),w(1),w(2)];});
console.log('floor polygon world corners:', world.map((w:number[])=>w.map(v=>v.toFixed(3)).join(',')));
const plan=(x:number,z:number):[number,number]=>[x*d.x+z*d.y,-x*d.y+z*d.x];
let agree=0, disagree=0;
for(const c of manifest.photos as any[]){
  const mm=c.cameraPoseARFrame, t=[mm[12],mm[13],mm[14]];
  const col=(i:number)=>[mm[i*4],mm[i*4+1],mm[i*4+2]];
  const fx=c.intrinsics[0],cx=c.intrinsics[2],fy=c.intrinsics[4],cy=c.intrinsics[5];
  const dot=(a:number[],b:number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  let ph; try{ph=toPhoto(c,r.frame);}catch{continue;}
  const seen:{i:number;u:number;bear:number}[]=[];
  world.forEach((w:number[],i:number)=>{
    const P=[w[0],-0.063,w[2]];
    const v=[P[0]-t[0],P[1]-t[1],P[2]-t[2]];
    const xc=dot(v,col(0)),yc=dot(v,col(1)),zc=dot(v,col(2));
    if(zc>=-0.3) return;
    const u=fx*(xc/-zc)+cx, vv=fy*(-yc/-zc)+cy;
    if(u<0||u>1920||vv<0||vv>1440) return;
    const [px,py]=plan(w[0],w[2]);
    const vx=Number(BigInt(Math.round(px*1e9))-r.frame.origin.x-ph.pose.at.x);
    const vy=Number(BigInt(Math.round(py*1e9))-r.frame.origin.y-ph.pose.at.y);
    const f=ph.pose.forward;
    const bear=Math.atan2(Number(f.x)*vy-Number(f.y)*vx, Number(f.x)*vx+Number(f.y)*vy)*180/Math.PI;
    seen.push({i,u,bear});
  });
  if(seen.length<2) continue;
  seen.sort((a,b)=>a.u-b.u); // left to right in the actual image
  const bearAsc = seen.every((s,k)=>k===0||s.bear>=seen[k-1].bear);
  const bearDesc = seen.every((s,k)=>k===0||s.bear<=seen[k-1].bear);
  if(bearAsc) agree++; else if(bearDesc) disagree++;
  if(agree+disagree<=6) console.log(c.fileName,'image L->R corners', seen.map(s=>`#${s.i}@u=${Math.round(s.u)} planBearing=${s.bear.toFixed(1)}`).join('  '), bearAsc?'planCCW':bearDesc?'planCW':'mixed');
}
console.log('image-left-to-right == plan bearing INCREASING (CCW):',agree,'  == plan bearing DECREASING (CW):',disagree);
