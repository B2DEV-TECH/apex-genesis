// Acceptance test 3: a worker that dies holding an evaluation claim and the
// supervisor lease neither blocks the lab nor duplicates work.
//
// Runs against the VERIFY schema only, with the supervisor stopped and an
// active autonomous run that has PENDING organisms.
//
//   node tests/integration/autonomy-crash.mjs orphan    take the lease, claim one organism, die
//   (start the supervisor and let it run past the 120 s claim lease)
//   node tests/integration/autonomy-crash.mjs verify    check takeover, reclaim and uniqueness
//
//   APXGEN_CONFIG=.local/verify-oracle.json APXGEN_STATE=verify node tests/integration/autonomy-crash.mjs <mode>
import os from 'node:os';
import {join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {connect,rows,oracledb} from '../../scripts/db.mjs';
import {ROOT,VERSION,stateDir,readJson,writeJsonAtomic} from '../../runtime/lib.mjs';

const assert=(ok,message)=>{if(!ok)throw new Error('Assertion failed: '+message);};
const mode=process.argv[2];
const ORPHAN=join(stateDir(),'crash-test-orphan.json');
const EVIDENCE=join(ROOT,'docs','testing','autonomy-crash-evidence.json');
const db=await connect();
const out=(name,type=oracledb.STRING,maxSize=4000)=>({dir:oracledb.BIND_OUT,type,maxSize});

async function guard(){
 const config=(await rows(db,'select label_prefix from apxgen_autonomy_config'))[0];
 assert(/^TEST/.test(config.LABEL_PREFIX),'this test only runs where labelPrefix starts with TEST');
 const run=(await rows(db,`select r.run_id,r.current_generation from apxgen_runs r join apxgen_autonomy_runs a on a.run_id=r.run_id where r.state='RUNNING'`))[0];
 assert(run,'an autonomous run is RUNNING');
 return run;
}

async function orphan(){
 const run=await guard();
 // An ordinary (lease-less) claim on an autonomous run must be refused.
 let rejected=null;
 try{await db.execute('begin apxgen_evolution.claim(:r,:o,:t,:g);end;',{r:run.RUN_ID,o:out('o',oracledb.NUMBER),t:out('t',oracledb.STRING,32),g:out('g',oracledb.CLOB)});}
 catch(error){rejected=error.message.split('\n')[0];}
 await db.rollback();
 assert(rejected&&/ORA-20075/.test(rejected),'claim without the supervisor lease is rejected');
 const r=await db.execute('begin :t:=apxgen_autonomy.acquire_lease(:h,:p,:v,90);end;',{t:out('t',oracledb.STRING,32),h:os.hostname(),p:process.pid,v:VERSION+'-crash-test'});
 const token=r.outBinds.t;assert(token,'lease acquired (stop the supervisor and wait for its lease to expire)');
 const c=await db.execute('begin apxgen_evolution.claim(:r,:l,:o,:t,:g);end;',{r:run.RUN_ID,l:token,o:out('o',oracledb.NUMBER),t:out('t',oracledb.STRING,32),g:out('g',oracledb.CLOB)});
 await db.commit();
 const organism=c.outBinds.o;assert(organism,'an organism was claimed');
 const row=(await rows(db,'select organism_id,generation,ordinal,evaluation_state,lease_until from apxgen_organisms where organism_id=:id',{id:organism}))[0];
 const record={orphanedAt:new Date().toISOString(),runId:run.RUN_ID,leasePid:process.pid,unguardedClaimRejected:rejected,
  organism:{id:Number(row.ORGANISM_ID),generation:Number(row.GENERATION),ordinal:Number(row.ORDINAL),state:row.EVALUATION_STATE,claimLeaseUntil:row.LEASE_UNTIL}};
 await writeJsonAtomic(ORPHAN,record);
 console.log(JSON.stringify(record,null,1));
 // Die abruptly: no submit, no lease release, no connection close.
 process.exit(0);
}

async function verify(){
 const record=await readJson(ORPHAN,null);assert(record,'orphan step ran first');
 const o=(await rows(db,`select o.evaluation_state,o.claim_token,e.evaluated_at,e.fitness,e.cached_from,(select count(*) from apxgen_evaluations x where x.organism_id=o.organism_id) evaluations
  from apxgen_organisms o left join apxgen_evaluations e on e.organism_id=o.organism_id where o.organism_id=:id`,{id:record.organism.id}))[0];
 assert(o.EVALUATION_STATE==='COMPLETE','the orphaned organism was reclaimed and evaluated (state '+o.EVALUATION_STATE+')');
 assert(Number(o.EVALUATIONS)===1,'exactly one evaluation for the orphaned organism');
 assert(new Date(o.EVALUATED_AT)>new Date(record.organism.claimLeaseUntil),'evaluated only after the orphaned claim lease expired');
 const dup=await rows(db,`select generation,ordinal,count(*) n from apxgen_organisms where run_id=:r group by generation,ordinal having count(*)>1`,{r:record.runId});
 assert(dup.length===0,'no duplicate organisms per generation and ordinal');
 const multi=await rows(db,`select o.organism_id from apxgen_organisms o join apxgen_evaluations e on e.organism_id=o.organism_id where o.run_id=:r group by o.organism_id having count(*)>1`,{r:record.runId});
 assert(multi.length===0,'no organism of the run has more than one evaluation');
 const takeover=(await rows(db,`select apxgen_autonomy.utc_text(logged_at) at,message from apxgen_supervisor_log where source='SUPERVISOR' and message like 'Lease acquired by pid%' and logged_at>from_tz(to_timestamp(:t,'YYYY-MM-DD"T"HH24:MI:SS'),'UTC') order by log_id`,{t:record.orphanedAt.slice(0,19)})).find(x=>!x.MESSAGE.startsWith('Lease acquired by pid '+record.leasePid+' '));
 assert(takeover&&/previous lease expired/.test(takeover.MESSAGE),'the supervisor (not the dead test process) took over the expired lease');
 const run=(await rows(db,'select state,current_generation from apxgen_runs where run_id=:r',{r:record.runId}))[0];
 assert(Number(run.CURRENT_GENERATION)>record.organism.generation,'the run advanced past the orphaned generation');
 const evidence={test:'autonomy-crash',version:VERSION,outcome:'PASSED',orphan:record,
  takeover:{at:takeover.AT,message:takeover.MESSAGE},
  reclaimed:{state:o.EVALUATION_STATE,evaluatedAt:o.EVALUATED_AT,fitness:o.FITNESS==null?null:Number(o.FITNESS),cachedFrom:o.CACHED_FROM??null,evaluations:Number(o.EVALUATIONS)},
  run:{state:run.STATE,generation:Number(run.CURRENT_GENERATION)},duplicateOrdinals:0,multiplyEvaluatedOrganisms:0};
 return evidence;
}

let evidence;
try{
 if(mode==='orphan')await orphan();
 else if(mode==='verify')evidence=await verify();
 else throw new Error('Usage: autonomy-crash.mjs orphan|verify');
}catch(error){evidence={test:'autonomy-crash',version:VERSION,mode,outcome:'FAILED',error:error.message};process.exitCode=1;}
await db.close().catch(()=>{});
if(evidence){
 const previous=await readJson(EVIDENCE,{});
 evidence={...evidence,hardKill:previous.hardKill??null,finishedAt:new Date().toISOString()};
 await mkdir(join(ROOT,'docs','testing'),{recursive:true});
 await writeFile(EVIDENCE,JSON.stringify(evidence,null,1)+'\n');
 console.log(JSON.stringify(evidence,null,1));
}
