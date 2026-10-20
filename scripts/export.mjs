import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {connect,oracledb,rows} from './db.mjs';
const output=process.argv[2]||'showcase/datasets/pilot';const db=await connect();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=[];
async function save(path,value){const bytes=Buffer.from(JSON.stringify(value));await mkdir(output+'/'+path.split('/').slice(0,-1).join('/'),{recursive:true});await writeFile(output+'/'+path,bytes);files.push({path,sha256:hash(bytes),bytes:bytes.length});}
async function call(sql,binds={}){const r=await db.execute(sql,{...binds,out:{dir:oracledb.BIND_OUT,type:oracledb.CLOB}});const lob=r.outBinds.out;return JSON.parse(typeof lob==='string'?lob:await lob.getData());}
try{
 const suite=JSON.parse(await readFile(process.argv[3]||'.local/offline-suite.json','utf8'));
 const index=await call('begin :out:=apxgen_export.index_json;end;');const ids=new Set(suite.runs.map(r=>r.id));index.runs=index.runs.filter(r=>ids.has(r.id));
 for(const run of index.runs){if(run.state!=='COMPLETED'||run.generations.length!==run.targetGenerations+1)throw new Error('Cannot publish an incomplete run');
  for(const gen of run.generations){const part=await call('begin :out:=apxgen_export.generation_json(:run,:gen);end;',{run:run.id,gen:gen.generation});await save(gen.path,part);}
 }
 if(!suite.sourceCommit||!suite.sourceHashes)throw new Error('Run-time source provenance required. Do not replace it with current source files.');
 const sourceHashes=suite.sourceHashes;
 index.protocol=suite.protocol;index.sourceHashes=sourceHashes;index.exportedAt=new Date().toISOString();index.sourceCommit=suite.sourceCommit;
 await save('index.json',index);
 const events=await rows(db,'select run_id,generation,event_type,details,occurred_at from apxgen_events order by event_id');await save('events.json',events.filter(e=>ids.has(e.RUN_ID)));
 await save('protocol.json',suite.protocol);
 const cacheOrigins=await rows(db,'select e.organism_id,e.environment_hash,e.measurements,o.fingerprint from apxgen_evaluations e join apxgen_organisms o on o.organism_id=e.organism_id where exists(select 1 from apxgen_evaluations c where c.cached_from=e.organism_id)');
 const publishedIds=new Set();for(const run of index.runs)for(const gen of run.generations){const part=JSON.parse(await readFile(output+'/'+gen.path,'utf8'));for(const organism of part.organisms)publishedIds.add(organism.id);}
 const referenced=new Set();for(const run of index.runs)for(const gen of run.generations){const part=JSON.parse(await readFile(output+'/'+gen.path,'utf8'));for(const organism of part.organisms)if(organism.cachedFrom!==null&&!publishedIds.has(organism.cachedFrom))referenced.add(organism.cachedFrom);}
 await save('cache-origins.json',cacheOrigins.filter(x=>referenced.has(x.ORGANISM_ID)).map(x=>({organismId:x.ORGANISM_ID,fingerprint:x.FINGERPRINT,environmentHash:x.ENVIRONMENT_HASH,measurements:JSON.parse(x.MEASUREMENTS),scope:'Observation reused from outside published populations; not an additional experiment candidate'})));
 const invocations=await rows(db,'select invocation_id,run_id,generation,organism_id,state,reserved_usd,actual_usd,input_rate,output_rate,input_tokens,output_tokens,model_id,proposal,error_code,applied_organism from apxgen_invocations order by created_at');await save('ai-invocations.json',invocations.filter(x=>ids.has(x.RUN_ID)));
 const manifest={schemaVersion:'1.0',kind:'recorded-oracle-experiment',experimentId:suite.experimentId||'genesis-offline-paired-20261020',exportedAt:index.exportedAt,databaseVersion:index.databaseVersion,apexVersion:index.apexVersion,sourceHashes,sourceCommit:index.sourceCommit,files};
 await writeFile(output+'/manifest.json',JSON.stringify(manifest));
 await mkdir('experiments/published-results',{recursive:true});await writeFile('experiments/published-results/'+(suite.experimentId?'haiku-run-index.json':'run-index.json'),JSON.stringify({experimentId:manifest.experimentId,runs:index.runs.map(r=>({id:r.id,mode:r.mode,seed:r.seed,generations:r.generations.length-1,candidateCount:r.candidateCount})),manifest:'../../'+output+'/manifest.json'},null,2));
 console.log(JSON.stringify({runs:index.runs.length,files:files.length,bytes:files.reduce((s,f)=>s+f.bytes,0),manifest:output+'/manifest.json'}));
}finally{await db.close();}
