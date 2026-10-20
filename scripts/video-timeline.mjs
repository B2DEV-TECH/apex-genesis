import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const ffprobe=process.env.APXGEN_FFPROBE||'C:/ffmpeg-8.1.1-essentials_build/bin/ffprobe.exe';
const narration=JSON.parse(await readFile('media/narration.json','utf8'));let number=0,time=0;const timeline=[],cues=[];
for(const chapter of narration.chapters){const scene={...chapter,start:time,segments:[]};let relative=1.5;
 for(const text of chapter.captions){number++;const path='.local/video/audio/'+String(number).padStart(2,'0')+'.wav';const duration=Number(execFileSync(ffprobe,['-v','error','-show_entries','format=duration','-of','csv=p=0',path],{encoding:'utf8'}).trim());scene.segments.push({path,start:relative,duration,text});cues.push({start:time+relative,end:time+relative+duration,text});relative+=duration+.5;}
 scene.duration=Math.max(chapter.minimumSeconds,relative+1.5);time+=scene.duration;timeline.push(scene);
}
function stamp(t,separator='.'){const ms=Math.round(t*1000),h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,s=Math.floor(ms/1000)%60;return[h,m,s].map(v=>String(v).padStart(2,'0')).join(':')+separator+String(ms%1000).padStart(3,'0');}
await mkdir('media/video',{recursive:true});await writeFile('.local/video/timeline.json',JSON.stringify({duration:time,chapters:timeline},null,2));
await writeFile('media/video/demo.en.vtt','WEBVTT\n\n'+cues.map(c=>`${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'));
await writeFile('.local/video/demo.en.srt',cues.map((c,i)=>`${i+1}\n${stamp(c.start,',')} --> ${stamp(c.end,',')}\n${c.text}\n`).join('\n'));
console.log(JSON.stringify({chapters:timeline.length,narrationSegments:number,durationSeconds:time}));
