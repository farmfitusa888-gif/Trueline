import { readFileSync } from 'node:fs';
import { importRoomPlan } from '../core/src/import-roomplan.ts';
import { formatFeetInches, formatMetric } from '../core/src/length.ts';
import { runLength } from '../core/src/room.ts';
import { cutStops, cutAt, CONVENTIONAL_CUT_HEIGHT } from '../core/src/section.ts';
import { checkCapture } from '../core/src/health.ts';

const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const FILES:[string,string][]=[['kitchen',`${SD}/kitchen/JSON/room.json`],['garage',`${SD}/garage/JSON/room.json`],['tl-garage',`${SD}/tl-garage/Room 2026-08-24 1819/room.json`]];
for(const [name,path] of FILES){
  const scan=JSON.parse(readFileSync(path,'utf8'));
  console.log('\n====',name);
  console.log('wall bottoms (m):', scan.walls.map((w:any)=>(w.transform[13]-w.dimensions[1]/2).toFixed(6)).join(' '));
  console.log('wall heights (m):', scan.walls.map((w:any)=>w.dimensions[1].toFixed(4)).join(' '));
  const r=importRoomPlan(scan,{at:'2026-08-25T00:00:00Z'});
  for(const w of r.room.walls){
    console.log(' ', w.id, 'len', formatMetric(w.length.value,'mm'), 'wallHeight', w.height?formatMetric(w.height.value,'mm'):'(room)');
    for(const o of w.openings??[]){
      const end = o.offsetFromStart.value + o.width.value;
      console.log('     ',o.id,'off',formatMetric(o.offsetFromStart.value,'mm'),'w',formatMetric(o.width.value,'mm'),'h',formatFeetInches(o.height.value),
        'sill',o.sillHeight?formatMetric(o.sillHeight.value,'mm'):'-',
        'end',formatMetric(end,'mm'), end>runLength(w)?`  *** OVERFLOWS WALL by ${formatMetric(end-runLength(w),'mm')} ***`:'',
        (o.sillHeight?o.sillHeight.value:0n)+o.height.value > r.room.ceilingHeight.value ? '  *** HEAD ABOVE CEILING ***':'');
    }
  }
  console.log('  ceiling', formatMetric(r.room.ceilingHeight.value,'mm'));
  console.log('  cutStops', cutStops(r.room).map(s=>formatMetric(s,'mm')).join(', '));
  const v=cutAt(r.room,{height:CONVENTIONAL_CUT_HEIGHT});
  console.log('  cut@4ft openingsCut', v.walls.map(w=>w.wallId+':'+w.openingsCut.join('/')).join(' '), 'needsSill', v.needsSillHeight);
  for(const f of checkCapture({room:r.room,report:r.report})) console.log('  ['+f.severity+']', f.what);
}
