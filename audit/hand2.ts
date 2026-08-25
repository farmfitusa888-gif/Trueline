import { readFileSync } from 'node:fs';
const SD='/tmp/claude-0/-home-user-plumbline/8750ebd8-0467-530e-b127-b3606e79e870/scratchpad';
const base=`${SD}/tl-garage/Room 2026-08-24 1819`;
const scan=JSON.parse(readFileSync(`${base}/room.json`,'utf8'));
const manifest=JSON.parse(readFileSync(`${base}/photos.json`,'utf8'));
const O:Record<string,number[]>={};
for(const o of scan.objects) O[Object.keys(o.category)[0]]=[o.transform[12],o.transform[13],o.transform[14]];
for(const c of manifest.photos as any[]){
  const m=c.cameraPoseARFrame; const t=[m[12],m[13],m[14]];
  const col=(i:number)=>[m[i*4],m[i*4+1],m[i*4+2]];
  const fx=c.intrinsics[0],cx=c.intrinsics[2],fy=c.intrinsics[4],cy=c.intrinsics[5];
  const out:string[]=[];
  for(const [name,p] of Object.entries(O)){
    const v=[p[0]-t[0],p[1]-t[1],p[2]-t[2]];
    const dot=(a:number[],b:number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const xc=dot(v,col(0)), yc=dot(v,col(1)), zc=dot(v,col(2));
    if(zc>=-0.15){out.push(`${name}:behind`);continue;}
    const u=Math.round(fx*(xc/-zc)+cx), vv=Math.round(fy*(-yc/-zc)+cy);
    out.push(`${name}:(${u},${vv})`);
  }
  console.log(c.fileName, out.join(' '));
}
