import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { northOnPlan } from '../core/src/capture.ts';
const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const base=`${SD}/tl-garage/Room 2026-08-24 1819`;
const scan=JSON.parse(readFileSync(`${base}/room.json`,'utf8'));
const man=JSON.parse(readFileSync(`${base}/photos.json`,'utf8'));
const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
// Real-world compass heading of each pose, clockwise from world -z, seen from above.
// True overhead plan is (x, -z) (see the 12/12 photograph test).
const heading=(m:number[])=>{
  const f=[-m[8],-m[10]];            // forward, (x, z)
  const T=[f[0]!, -f[1]!];           // true overhead
  const ref=[0,1];                   // world -z in true overhead coords
  const ccw=Math.atan2(ref[0]!*T[1]!-ref[1]!*T[0]!, ref[0]!*T[0]!+ref[1]!*T[1]!);
  return ((-ccw*180/Math.PI)%360+360)%360;   // clockwise from the reference
};
const picks=[10,20,30,40].map(i=>man.photos[i]);
console.log('one physical north, four different camera poses:');
for(const p of picks){
  const n=northOnPlan({trueHeading:heading(p.cameraPoseARFrame),accuracy:5,atPose:p.cameraPoseARFrame}, r.frame.datum);
  console.log('  ',p.fileName,'realHeading',heading(p.cameraPoseARFrame).toFixed(1),'deg ->  north on plan bearing',
    (Math.atan2(n!.y,n!.x)*180/Math.PI).toFixed(1),'deg');
}
