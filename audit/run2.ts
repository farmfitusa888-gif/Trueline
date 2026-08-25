import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { importPhotos, heightsAboveFloor, toPhoto, PLAUSIBLE_CAMERA_HEIGHT } from '../core/src/capture.ts';
import { insidePlan } from '../core/src/section.ts';
import { wallsInFrame, unphotographedWalls } from '../core/src/photo.ts';
import { formatMetric, formatFeetInches } from '../core/src/length.ts';
import { corners } from '../core/src/room.ts';

const SD = '/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const base = `${SD}/tl-garage/Room 2026-08-24 1819`;
const scan = JSON.parse(readFileSync(`${base}/room.json`, 'utf8'));
const manifest = JSON.parse(readFileSync(`${base}/photos.json`, 'utf8'));

const r = importRoomPlan(scan, { at: '2026-08-25T00:00:00Z' });
const imported = importPhotos(manifest, r.frame);
console.log('photos', imported.photos.length, 'rejected', imported.rejected.length);
for (const rj of imported.rejected) console.log('  rejected', rj.id, rj.reason.slice(0,110));

// floor level
const w0 = scan.walls[0];
const floorLevelM = w0.transform[13] - w0.dimensions[1]/2;
console.log('floorLevel (m)', floorLevelM);
const heights = heightsAboveFloor(manifest, BigInt(Math.round(floorLevelM*1e9)));
const hs = heights.map(Number).sort((a,b)=>a-b);
console.log('camera heights mm: min', (hs[0]/1e6).toFixed(1), 'median', (hs[Math.floor(hs.length/2)]/1e6).toFixed(1), 'max', (hs[hs.length-1]/1e6).toFixed(1));
console.log('outside plausible band:', heights.filter(h=>h<PLAUSIBLE_CAMERA_HEIGHT.low||h>PLAUSIBLE_CAMERA_HEIGHT.high).length);

const outside = imported.photos.filter(p=>!insidePlan(r.room, p.pose.at));
console.log('outside plan:', outside.length, '/', imported.photos.length);

// wedge half-angles
function ang(v:{x:bigint,y:bigint}){ return Math.atan2(Number(v.y), Number(v.x))*180/Math.PI; }
function norm(d:number){ while(d>180)d-=360; while(d<-180)d+=360; return d; }
const widths = imported.photos.map(p=>norm(ang(p.pose.leftEdge)-ang(p.pose.rightEdge)));
widths.sort((a,b)=>a-b);
console.log('wedge widths deg: min',widths[0].toFixed(2),'p25',widths[Math.floor(widths.length*0.25)].toFixed(2),'median',widths[Math.floor(widths.length/2)].toFixed(2),'max',widths[widths.length-1].toFixed(2));

// right.y stats
const ry = manifest.photos.map((p:any)=>p.cameraPoseARFrame[1]).sort((a:number,b:number)=>a-b);
console.log('camera X axis world-y: min',ry[0].toFixed(3),'median',ry[Math.floor(ry.length/2)].toFixed(3),'max',ry[ry.length-1].toFixed(3));

console.log('unphotographed walls', unphotographedWalls(imported.photos, r.room));
for (const p of imported.photos.slice(0,5)) {
  console.log(p.id, 'at', formatMetric(p.pose.at.x,'mm'), formatMetric(p.pose.at.y,'mm'), 'walls', wallsInFrame(p, r.room).map(w=>w.wallId+':'+w.fractionPerMille).join(' '));
}
