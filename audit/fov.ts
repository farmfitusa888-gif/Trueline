import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { toPhoto } from '../core/src/capture.ts';

const SD = '/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const base = `${SD}/tl-garage/Room 2026-08-24 1819`;
const scan = JSON.parse(readFileSync(`${base}/room.json`, 'utf8'));
const manifest = JSON.parse(readFileSync(`${base}/photos.json`, 'utf8'));
const r = importRoomPlan(scan, { at: '2026-08-25T00:00:00Z' });
const d = r.frame.datum;
const plan = (x:number,z:number):[number,number] => [x*d.x + z*d.y, -x*d.y + z*d.x];
const norm=(a:number)=>{while(a>180)a-=360;while(a<-180)a+=360;return a;};

let worst = {id:'', diff:0, sampled:0, four:0, minHoriz: 1};
for (const c of manifest.photos as any[]) {
  const m = c.cameraPoseARFrame;
  const fx=m0(0),cx=c.intrinsics[2],fy=c.intrinsics[4],cy=c.intrinsics[5];
  function m0(_:number){return c.intrinsics[0];}
  const F=[-m[8],-m[9],-m[10]], R=[m[0],m[1],m[2]], U=[m[4],m[5],m[6]];
  const hx=cx/c.intrinsics[0], hy=cy/fy;
  const ray=(u:number,v:number)=>[0,1,2].map(i=>F[i]!+u*hx*R[i]!+v*hy*U[i]!);
  // dense boundary sample
  const N=400; const az:number[]=[]; let minHoriz=1;
  const push=(rr:number[])=>{ const L=Math.hypot(rr[0]!,rr[1]!,rr[2]!); const h=Math.hypot(rr[0]!,rr[2]!)/L; if(h<minHoriz)minHoriz=h;
    const [x,y]=plan(rr[0]!,rr[2]!); az.push(Math.atan2(y,x)*180/Math.PI); };
  for(let i=0;i<=N;i++){const t=-1+2*i/N; push(ray(t,1)); push(ray(t,-1)); push(ray(1,t)); push(ray(-1,t));}
  // widest angular span of sampled azimuths (assume < 180): find min-covering arc
  const s=[...az].sort((a,b)=>a-b);
  let bestGap=-1, gapAt=0;
  for(let i=0;i<s.length;i++){ const g=norm(s[(i+1)%s.length]! - s[i]! + (i===s.length-1?360:0)); const gg = i===s.length-1 ? (s[0]!+360-s[i]!) : (s[i+1]!-s[i]!); if(gg>bestGap){bestGap=gg;gapAt=i;} }
  const sampledSpan = 360-bestGap;
  let four=NaN;
  try { const p=toPhoto(c,r.frame);
    const a1=Math.atan2(Number(p.pose.rightEdge.y),Number(p.pose.rightEdge.x))*180/Math.PI;
    const a2=Math.atan2(Number(p.pose.leftEdge.y),Number(p.pose.leftEdge.x))*180/Math.PI;
    four=norm(a2-a1);
  } catch(e){ four=NaN; }
  if(!Number.isNaN(four)){
    const diff = sampledSpan-four;
    if(diff>worst.diff) worst={id:c.id,diff,sampled:sampledSpan,four,minHoriz};
    if(diff>0.5) console.log(c.id,'sampled',sampledSpan.toFixed(2),'four-corner',four.toFixed(2),'diff',diff.toFixed(2),'minHoriz',minHoriz.toFixed(3));
  }
}
console.log('WORST', worst);
