// Acceptance test 5: a failed publication never damages the live dataset.
//
// Runs against the VERIFY schema and the DIRECTORY target only. It takes the
// supervisor lease itself, so the supervisor must be shut down first and the
// lab must have unpublished, completed generations (run a few generations,
// then `genesisctl shutdown --wait`).
//
//   APXGEN_CONFIG=.local/verify-oracle.json APXGEN_STATE=verify node tests/integration/autonomy-publication.mjs
import os from 'node:os';
import {join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {connect,rows,oracledb} from '../../scripts/db.mjs';
import {ROOT,VERSION,loadRuntimeConfig,createLogger} from '../../runtime/lib.mjs';
import {createPublisher,resolveTarget,validateRunDocument,sha256} from '../../runtime/publisher.mjs';

const assert=(ok,message)=>{if(!ok)throw new Error('Assertion failed: '+message);};
const cfg=await loadRuntimeConfig();const log=createLogger('publication-test');
const db=await connect();
const evidence={test:'autonomy-publication',startedAt:new Date().toISOString(),version:VERSION,steps:[]};
let token=null;

async function readOrNull(target,key){try{return await target.get(key);}catch{return null;}}
// A pointer is consistent when its catalog exists with the advertised hash and
// every run document the catalog names exists with its advertised hash.
async function assertConsistent(target,pointerText,label){
 const pointer=JSON.parse(pointerText);const prefix=cfg.publication.prefix;
 const catalogText=await target.get(prefix+pointer.catalog.key);
 assert(sha256(catalogText)===pointer.catalog.sha256,label+': catalog hash matches pointer');
 const catalog=JSON.parse(catalogText);
 for(const run of catalog.runs){
  const text=await target.get(prefix+run.key);
  assert(sha256(text)===run.sha256,label+': run document hash matches catalog for '+run.runId);
  validateRunDocument(JSON.parse(text));
 }
 return {catalogRevision:catalog.revision,runs:catalog.runs.length,pointerSha:sha256(pointerText).slice(0,16)};
}

try{
 const config=(await rows(db,'select label_prefix,publish_enabled from apxgen_autonomy_config'))[0];
 assert(/^TEST/.test(config.LABEL_PREFIX),'this test only runs where labelPrefix starts with TEST');
 assert(Number(config.PUBLISH_ENABLED)===1,'publication enabled in configuration');
 const r=await db.execute('begin :t:=apxgen_autonomy.acquire_lease(:h,:p,:v,90);end;',{t:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32},h:os.hostname(),p:process.pid,v:VERSION+'-test'});
 token=r.outBinds.t;assert(token,'lease acquired (shut the supervisor down first)');
 const target=resolveTarget(cfg,config.LABEL_PREFIX);assert(target.name==='DIRECTORY','TEST data is never sent to R2');
 const pointerKey=cfg.publication.prefix+'latest.json';
 const failures=async()=>Number((await rows(db,`select count(*) n from apxgen_publications where state in('FAILED','ROLLED_BACK') and target='DIRECTORY'`))[0].N);

 const before=await readOrNull(target,pointerKey);assert(before,'a previous dataset is live');
 evidence.steps.push({step:'baseline',...await assertConsistent(target,before,'baseline')});

 // 1. Upload failure on a run document: nothing reaches the pointer.
 let pub=createPublisher({db,token:()=>token,cfg,log,faults:{failUpload:/\/(progress-g[0-9]{4}|final)-/}});
 const due=(await pub.plan({force:true})).due;assert(due.length>0,'unpublished generations exist (run a few generations first)');
 let failedBefore=await failures();let result=await pub.check({force:true});
 assert(result.failed&&/Injected upload failure/.test(result.failed),'upload failure reported');
 assert(result.retryAt,'bounded retry scheduled');
 const afterUpload=await target.get(pointerKey);
 assert(afterUpload===before,'live pointer byte-identical after upload failure');
 evidence.steps.push({step:'upload-failure',due:due.map(d=>({run:d.row.RUN_ID,kind:d.kind})),result,pointerUnchanged:true,failureRows:await failures()-failedBefore,
  ...await assertConsistent(target,afterUpload,'after upload failure')});

 // 2. Pointer read-back mismatch on the new pointer only (the rollback write is
 //    verified normally): the new pointer is replaced by last-known-good.
 pub=createPublisher({db,token:()=>token,cfg,log,faults:{corruptVerify:{hits:0,test(key){return /latest\.json$/.test(key)&&this.hits++===0;}}}});
 failedBefore=await failures();result=await pub.check({force:true});
 assert(result.failed&&/Verification hash mismatch/.test(result.failed),'pointer verification failure reported');
 const afterRollback=await target.get(pointerKey);
 assert(afterRollback===before,'pointer rolled back to the byte-identical last-known-good');
 const rolled=(await rows(db,`select publication_id,error from apxgen_publications where state='ROLLED_BACK' and target='DIRECTORY' order by publication_id desc fetch first 1 row only`))[0];
 assert(rolled&&/Restored last-known-good/.test(rolled.ERROR),'ROLLED_BACK row recorded');
 evidence.steps.push({step:'pointer-verification-failure',result,rolledBackPublication:Number(rolled.PUBLICATION_ID),failureRows:await failures()-failedBefore,
  ...await assertConsistent(target,afterRollback,'after rollback')});

 // 3. Clean retry: publication succeeds and the new dataset is consistent.
 pub=createPublisher({db,token:()=>token,cfg,log});
 result=await pub.check({force:true});
 assert(!result.failed&&result.published?.length>0,'clean publication succeeds');
 const after=await target.get(pointerKey);assert(after!==before,'pointer advanced after a clean publication');
 assert(JSON.parse(after).previousSha256===sha256(before),'new pointer chains to the previous live pointer');
 const state=await pub.loadState();assert(state.failures===0&&!state.nextAttemptAt,'backoff cleared after success');
 evidence.steps.push({step:'clean-retry',published:result.published,...await assertConsistent(target,after,'after clean publication')});
 evidence.outcome='PASSED';
}catch(error){evidence.outcome='FAILED';evidence.error=error.message;process.exitCode=1;}
finally{
 if(token)await db.execute(`begin apxgen_autonomy.release_lease(:t,'STOPPED','Publication test finished');end;`,{t:token}).then(()=>db.commit()).catch(()=>{});
 await db.close();await log.flush();
 evidence.finishedAt=new Date().toISOString();
 const dir=join(ROOT,'docs','testing');await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'autonomy-publication-evidence.json'),JSON.stringify(evidence,null,1)+'\n');
 console.log(JSON.stringify(evidence,null,1));
}
