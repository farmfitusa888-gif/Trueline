import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { importPhotos } from '../core/src/capture.ts';
import { wallsInFrame } from '../core/src/photo.ts';
import { corners } from '../core/src/room.ts';
const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const base=`${SD}/tl-garage/Room 2026-08-24 1819`;
const scan=JSON.parse(readFileSync(`${base}/room.json`,'utf8'));
const man=JSON.parse(readFileSync(`${base}/photos.json`,'utf8'));
const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
const {photos}=importPhotos(man,r.frame);
const pts=corners(r.room);
let worst={photo:'',wall:'',model:0,brute:0,diff:0};
let missing=0, total=0;
for(const p of photos){
  const got=new Map(wallsInFrame(p,r.room).map(w=>[w.wallId,Number(w.visibleLength)/1e6]));
  r.room.walls.forEach((w,i)=>{
    const a=pts[i]!,b=pts[(i+1)%pts.length]!;
    const N=20000; let inside=0;
    for(let k=0;k<N;k++){
      const t=(k+0.5)/N;
      const x=Number(a.x)+(Number(b.x)-Number(a.x))*t - Number(p.pose.at.x);
      const y=Number(a.y)+(Number(b.y)-Number(a.y))*t - Number(p.pose.at.y);
      const cR=Number(p.pose.rightEdge.x)*y-Number(p.pose.rightEdge.y)*x;
      const cL=Number(p.pose.leftEdge.x)*y-Number(p.pose.leftEdge.y)*x;
      if(cR>=0&&cL<=0) inside++;
    }
    const segLen=Math.hypot(Number(b.x)-Number(a.x),Number(b.y)-Number(a.y))/1e6;
    const brute=inside/N*segLen;
    const model=got.get(w.id)??0;
    total++;
    if(brute>1 && model===0){ missing++; console.log('MISSING',p.id,w.id,'brute mm',brute.toFixed(1)); }
    const d=Math.abs(brute-model);
    if(d>worst.diff) worst={photo:p.id,wall:w.id,model,brute,diff:d};
  });
}
console.log('worst |model-brute| mm', worst, 'checked', total, 'missing', missing);
