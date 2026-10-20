import {connect} from './db.mjs';import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const evidence=JSON.parse(await readFile('media/video/evidence.json','utf8')),db=await connect();
try{
 const index=JSON.parse((await db.execute('select apxgen_export.index_json data from dual')).rows[0].DATA),metadata=index.runs.find(r=>r.id===evidence.videoRun);
 if(!metadata||metadata.state!=='COMPLETED'||metadata.generations.length!==6)throw new Error('Recorded demonstration run is not complete');
 const generations=[];for(const g of metadata.generations)generations.push(JSON.parse((await db.execute('select apxgen_export.generation_json(:run,:generation) data from dual',{run:metadata.id,generation:g.generation})).rows[0].DATA));
 const output=JSON.stringify({kind:'recorded-oracle-video-demonstration',metadata,generations,provenance:'Actual stored five-generation run shown in the video. Its engine 1.0.1 source was subsequently archived in commit 449ca4e; the execution checkout SHA was not recorded. This is separate from the ten-run pilot.'});
 await writeFile('media/video/run.json',output);evidence.runData={path:'media/video/run.json',sha256:createHash('sha256').update(output).digest('hex'),generations:generations.length,organisms:generations.reduce((n,g)=>n+g.organisms.length,0)};await writeFile('media/video/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({exported:true,run:metadata.id,...evidence.runData}));
}finally{await db.close();}
