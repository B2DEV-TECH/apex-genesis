// APEX Genesis supervisor: the single long-lived worker that measures
// organisms in a real headless browser while Oracle owns the genetic algorithm.
//
// Ownership is proven twice: a local lock file (cheap, per machine) and the
// Oracle lease in APXGEN_SUPERVISOR (authoritative). Every database mutation
// made by this process is guarded by the lease token.
//
// Exit codes: 0 graceful stop, 1 fatal error, 2 safe-stopped after repeated
// failures, 3 another live instance owns the lab.
import os from 'node:os';
import {join} from 'node:path';
import {access,unlink} from 'node:fs/promises';
import {connect,rows,oracledb} from '../scripts/db.mjs';
import {openEvaluator} from '../scripts/evaluate.mjs';
import {startServer} from '../scripts/serve.mjs';
import {ROOT,VERSION,stateDir,loadRuntimeConfig,sleep,writeJsonAtomic,createLogger,acquireLock,releaseLock,processTree,cpuSnapshot,cpuBusyPercent,diskFreeBytes} from './lib.mjs';
import {createPublisher,sanitizeText} from './publisher.mjs';

const cfg=await loadRuntimeConfig();
const log=createLogger('supervisor');
const LOCK=join(stateDir(),'supervisor.lock'),STATUS=join(stateDir(),'status.json'),STOP_FILE=join(stateDir(),'stop.request');
const DB_COMMANDS=new Set(['ENABLE','DISABLE','PAUSE','RESUME','STOP_RUN']);
const CONNECTION_ERROR=/NJS-(003|500|501|503|521)|DPI-1010|DPI-1080|ORA-0(3113|3114|3135|1012|1033|1034|1089)|ORA-125(14|37|41|43)|ORA-28547/;

const abort=new AbortController();let shutdownReason=null;
function requestShutdown(reason){if(!shutdownReason){shutdownReason=reason;abort.abort();}}
for(const signal of ['SIGINT','SIGTERM','SIGBREAK','SIGHUP'])process.on(signal,()=>requestShutdown('signal '+signal));

let db=null,token=null,server=null,evaluator=null,publisher=null;
const started=Date.now();
const metrics={evaluated:0,cached:0,measured:0,infraFailures:0,genomeFailures:0,throttles:0,browserRecycles:0,runsCreated:0,publications:0,lastEvaluationAt:null};
let supervisorState='STARTING',detail='Starting',activeRunId=null,activeGeneration=null;
let consecutiveFailures=0,throttleUntil=0,lastPublishCheck=0,lastResourceSample=0,lastEvaluatorUse=0,evaluationsSinceOpen=0;
let resource={},cpuBefore=cpuSnapshot(),treeCpuBefore=null,treeCpuAt=Date.now();

// ---------------------------------------------------------------------------
// Local status (read by the watchdog even when Oracle is unreachable)
// ---------------------------------------------------------------------------
async function writeStatus(){
 await writeJsonAtomic(STATUS,{pid:process.pid,version:VERSION,state:supervisorState,detail,heartbeat:new Date().toISOString(),
  startedAt:new Date(started).toISOString(),leaseHeld:!!token,activeRun:activeRunId,generation:activeGeneration,consecutiveFailures,metrics,resource}).catch(()=>{});
}
function setState(state,text){supervisorState=state;detail=String(text||'').slice(0,900);}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------
async function exec(sql,binds={},{commit=true,retries54=3}={}){
 for(let attempt=0;;attempt++){
  try{const r=await db.execute(sql,binds);if(commit)await db.commit();return r;}
  catch(error){
   await db.rollback().catch(()=>{});
   if(error.errorNum===54&&attempt<retries54){await sleep(500+attempt*500,abort.signal);continue;}
   throw error;
  }
 }
}
const tokenBind=()=>token;
async function openDatabase(){
 if(db){try{await db.ping();return;}catch{try{await db.close();}catch{}db=null;}}
 db=await connect();db.callTimeout=120000;
}
async function acquireLease(){
 const deadline=Date.now()+(cfg.leaseSeconds*2+30)*1000;
 while(!abort.signal.aborted){
  const r=await exec('begin :t:=apxgen_autonomy.acquire_lease(:h,:p,:v,:s);end;',{t:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32},h:os.hostname(),p:process.pid,v:VERSION,s:cfg.leaseSeconds});
  if(r.outBinds.t){token=r.outBinds.t;await log.info('Oracle lease acquired');return true;}
  if(Date.now()>deadline)return false;
  setState('STARTING','Waiting for an existing lease to expire');await writeStatus();
  await sleep(15000,abort.signal);
 }
 return false;
}
async function renew(){
 const m=JSON.stringify({...metrics,resource,uptimeSeconds:Math.round((Date.now()-started)/1000),consecutiveFailures,pid:undefined});
 await exec('begin apxgen_autonomy.renew_lease(:t,:s,:d,:m,:l);end;',{t:tokenBind(),s:supervisorState,d:sanitizeText(detail),m,l:cfg.leaseSeconds});
}
async function dbLog(level,message,details){
 try{await exec('begin apxgen_autonomy.log(:l,\'SUPERVISOR\',:m,:d);end;',{l:level,m:sanitizeText(message),d:details?JSON.stringify(details):null});}catch{}
}

// ---------------------------------------------------------------------------
// Evaluator lifecycle (opened only when there is work; recycled on limits)
// ---------------------------------------------------------------------------
async function ensureEvaluator(){
 if(evaluator)return evaluator;
 if(!server)server=await startServer(0);
 evaluator=await openEvaluator('http://127.0.0.1:'+server.address().port);
 evaluationsSinceOpen=0;
 await log.info('Evaluator opened',{environment:evaluator.environment.slice(0,16),browser:evaluator.browser.version()});
 return evaluator;
}
async function closeEvaluator(reason){
 if(!evaluator)return;const e=evaluator;evaluator=null;
 try{await Promise.race([e.close(),sleep(15000)]);}catch{}
 await log.info('Evaluator closed',{reason});
}
async function recycleEvaluator(reason){metrics.browserRecycles++;await closeEvaluator(reason);}
function environmentDescription(e){
 return {evaluatorEnvironmentHash:e.environment,browser:'chromium '+e.browser.version(),node:process.version,platform:process.platform,arch:process.arch,
  viewports:[390,768,1440],viewportHeight:1000,fitnessVersion:'fitness-1.1.0',supervisorVersion:VERSION};
}

// ---------------------------------------------------------------------------
// Resources and limits
// ---------------------------------------------------------------------------
async function sampleResources(){
 const L=cfg.limits;const tree=await processTree(process.pid);const now=Date.now();
 const cpuAfter=cpuSnapshot();const systemCpu=cpuBusyPercent(cpuBefore,cpuAfter);cpuBefore=cpuAfter;
 let treeCpuPercent=null;
 if(tree&&treeCpuBefore!=null){treeCpuPercent=Math.round(1000*((tree.cpu100ns-treeCpuBefore)/1e4)/((now-treeCpuAt)*os.cpus().length))/10;}
 if(tree){treeCpuBefore=tree.cpu100ns;treeCpuAt=now;}
 const disk=await diskFreeBytes(ROOT);
 resource={sampledAt:new Date(now).toISOString(),systemCpuPercent:systemCpu,treeCpuPercent,freeMemoryMb:Math.round(os.freemem()/1048576),
  diskFreeMb:disk==null?null:Math.round(disk/1048576),treeWorkingSetMb:tree?Math.round(tree.workingSetBytes/1048576):null,
  browserWorkingSetMb:tree?Math.round(tree.browserWorkingSetBytes/1048576):null,processes:tree?.processes??null,nodeRssMb:Math.round(process.memoryUsage().rss/1048576),
  evaluatorOpen:!!evaluator};
 if(resource.browserWorkingSetMb>L.maxBrowserWorkingSetMb||resource.treeWorkingSetMb>L.maxTreeWorkingSetMb){
  await log.warn('Memory limit exceeded; recycling browser',{browserMb:resource.browserWorkingSetMb,treeMb:resource.treeWorkingSetMb});
  await dbLog('WARN','Memory limit exceeded; browser recycled',{browserMb:resource.browserWorkingSetMb,treeMb:resource.treeWorkingSetMb});
  await recycleEvaluator('memory limit');
 }
 const reasons=[];
 if(resource.diskFreeMb!=null&&resource.diskFreeMb<L.minFreeDiskMb)reasons.push('free disk '+resource.diskFreeMb+' MB < '+L.minFreeDiskMb);
 if(resource.freeMemoryMb<L.minFreeMemoryMb)reasons.push('free memory '+resource.freeMemoryMb+' MB < '+L.minFreeMemoryMb);
 if(systemCpu>L.maxSystemCpuPercent)reasons.push('system CPU '+systemCpu+'% > '+L.maxSystemCpuPercent+'%');
 if(reasons.length){
  throttleUntil=Date.now()+L.throttleSeconds*1000;metrics.throttles++;
  setState('RUNNING','Throttled: '+reasons.join('; '));
  await log.warn('Throttling evaluation',{reasons});
  if(metrics.throttles%10===1)await dbLog('WARN','Evaluation throttled: '+reasons.join('; '));
 }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function processCommands(){
 const pending=await rows(db,"select command_id,command,requested_by from apxgen_commands where state='PENDING' order by command_id fetch first 20 rows only");
 for(const c of pending){
  const id=c.COMMAND_ID;
  try{
   if(DB_COMMANDS.has(c.COMMAND)){await exec('begin apxgen_autonomy.apply_command(:t,:id);end;',{t:tokenBind(),id});await log.info('Command applied',{id,command:c.COMMAND});}
   else if(c.COMMAND==='PUBLISH_NOW'){
    const result=await publisher.check({force:true});
    const ok=!!result.published||!!result.pointer;
    await exec('begin apxgen_autonomy.complete_command(:t,:id,:s,:r);end;',{t:tokenBind(),id,s:ok?'DONE':'REJECTED',r:JSON.stringify(result).slice(0,900)});
    lastPublishCheck=Date.now();
   }else if(c.COMMAND==='SHUTDOWN'){
    await exec('begin apxgen_autonomy.complete_command(:t,:id,\'DONE\',\'Supervisor stopping\');end;',{t:tokenBind(),id});
    requestShutdown('SHUTDOWN command #'+id);return;
   }
  }catch(error){
   if(error.errorNum===54)continue;                               // run row busy; retried next loop
   if(error.errorNum===20070||CONNECTION_ERROR.test(error.message))throw error;
   await exec('begin apxgen_autonomy.complete_command(:t,:id,\'REJECTED\',:r);end;',{t:tokenBind(),id,r:sanitizeText(error.message)}).catch(()=>{});
   await log.warn('Command rejected',{id,command:c.COMMAND,error:sanitizeText(error.message)});
  }
 }
}

// ---------------------------------------------------------------------------
// Runs and evaluation
// ---------------------------------------------------------------------------
async function activeRun(){
 return (await rows(db,`select a.run_id,a.sequence_no,a.environment_hash,r.state,r.current_generation,
   (select count(*) from apxgen_organisms o where o.run_id=r.run_id and o.generation=r.current_generation and (o.evaluation_state='PENDING' or (o.evaluation_state='CLAIMED' and o.lease_until<systimestamp))) claimable,
   case when r.current_generation=0 or systimestamp>=g.started_at+numtodsinterval(c.generation_interval_seconds,'SECOND') then 1 else 0 end due,
   round((cast(g.started_at+numtodsinterval(c.generation_interval_seconds,'SECOND') as date)-cast(systimestamp as date))*86400) wait_seconds
  from apxgen_autonomy_runs a join apxgen_runs r on r.run_id=a.run_id
  join apxgen_generations g on g.run_id=r.run_id and g.generation=r.current_generation cross join apxgen_autonomy_config c
  where a.outcome='ACTIVE' order by a.sequence_no desc fetch first 1 row only`))[0]||null;
}

async function maybeStartRun(){
 const r=await exec('declare d varchar2(400);begin :n:=apxgen_autonomy.admission(d);:d:=d;end;',{n:{dir:oracledb.BIND_OUT,type:oracledb.NUMBER},d:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:400}},{commit:false});
 if(r.outBinds.n!==1){setState('IDLE',r.outBinds.d);return false;}
 const e=await ensureEvaluator();
 const created=await exec('begin :id:=apxgen_autonomy.start_next_run(:t,:h,:e);end;',{id:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32},t:tokenBind(),h:e.environment,e:JSON.stringify(environmentDescription(e))});
 if(created.outBinds.id){metrics.runsCreated++;await log.info('Run created',{run:created.outBinds.id});return true;}
 return false;
}

function withTimeout(promise,ms,label){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error(label+' timed out'),{infrastructure:true})),ms);})]).finally(()=>clearTimeout(timer));}

// Claims and evaluates one organism. Returns false when nothing is claimable.
async function evaluateOne(run){
 const e=await ensureEvaluator();
 if(e.environment!==run.ENVIRONMENT_HASH){
  throw Object.assign(new Error('Evaluator environment changed from the run definition; refusing to mix measurement environments'),{safeStop:true});
 }
 const claim=await exec('begin apxgen_evolution.claim(:run,:lease,:id,:token,:genome);end;',{run:run.RUN_ID,lease:tokenBind(),id:{dir:oracledb.BIND_OUT,type:oracledb.NUMBER},token:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32},genome:{dir:oracledb.BIND_OUT,type:oracledb.CLOB}});
 const c=claim.outBinds;if(!c.id)return false;
 const genome=JSON.parse(typeof c.genome==='string'?c.genome:await c.genome.getData());
 lastEvaluatorUse=Date.now();
 const previous=await rows(db,"select e.organism_id,e.measurements from apxgen_evaluations e join apxgen_organisms p on p.organism_id=e.organism_id join apxgen_organisms o on o.fingerprint=p.fingerprint where o.organism_id=:id and e.environment_hash=:env and p.evaluation_state='COMPLETE' order by e.organism_id fetch first 1 row only",{id:c.id,env:e.environment});
 let measurements,source=null;
 if(previous.length){measurements=JSON.parse(previous[0].MEASUREMENTS);source=previous[0].ORGANISM_ID;metrics.cached++;}
 else{
  try{measurements=await withTimeout(e.measure(genome),cfg.measureTimeoutSeconds*1000,'Measurement');metrics.measured++;evaluationsSinceOpen++;}
  catch(error){
   if(/Evaluator rejected schema/.test(error.message)){
    metrics.genomeFailures++;
    await exec('begin apxgen_evolution.fail_evaluation(:id,:token,:env,:reason);end;',{id:c.id,token:c.token,env:e.environment,reason:error.message.slice(0,900)});
    return true;
   }
   // Infrastructure failure: do not blame the genome. The claim lease expires
   // (120 s) and the organism is reclaimed by a fresh browser.
   metrics.infraFailures++;await recycleEvaluator('measurement failure');
   throw Object.assign(error,{infrastructure:true});
  }
 }
 await exec('begin apxgen_evolution.submit_evaluation(:id,:token,:env,:metrics,:source);end;',{id:c.id,token:c.token,env:e.environment,metrics:JSON.stringify(measurements),source});
 metrics.evaluated++;metrics.lastEvaluationAt=new Date().toISOString();
 if(evaluationsSinceOpen>=cfg.browserRecycleEvaluations)await recycleEvaluator('scheduled recycle');
 return true;
}

async function tickRun(runId){
 try{await exec('begin apxgen_evolution.tick(:id);end;',{id:runId},{retries54:0});}catch(error){if(error.errorNum!==54)throw error;}
 await exec('begin apxgen_autonomy.assess_stagnation(:t,:id);end;',{t:tokenBind(),id:runId});
}

// One supervision cycle. Returns the suggested delay before the next cycle.
async function cycle(){
 await renew();
 await processCommands();
 if(abort.signal.aborted)return 0;
 const outcome=(await exec('begin :o:=apxgen_autonomy.reconcile(:t);end;',{o:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:40},t:tokenBind()})).outBinds.o;
 if(['COMPLETED','STOPPED','RECOVERED','FAILED'].includes(outcome))await log.info('Run reconciled',{outcome});
 if(Date.now()-lastResourceSample>=cfg.resourceSampleSeconds*1000){lastResourceSample=Date.now();await sampleResources();}
 if(Date.now()-lastPublishCheck>=cfg.publication.checkSeconds*1000){
  lastPublishCheck=Date.now();const p=await publisher.check();if(p.published)metrics.publications++;
 }
 let run=await activeRun();
 if(!run){
  activeRunId=null;activeGeneration=null;
  if(await maybeStartRun()){setState('RUNNING','Run created');return 0;}
  if(evaluator&&Date.now()-lastEvaluatorUse>600000)await closeEvaluator('idle');
  return cfg.idlePollSeconds*1000;
 }
 activeRunId=run.RUN_ID;activeGeneration=Number(run.CURRENT_GENERATION);
 if(run.STATE!=='RUNNING'){
  setState('PAUSED','Run #'+run.SEQUENCE_NO+' '+run.STATE.toLowerCase()+' at generation '+activeGeneration);
  if(evaluator&&Date.now()-lastEvaluatorUse>600000)await closeEvaluator('idle while paused');
  return cfg.idlePollSeconds*1000;
 }
 if(Date.now()<throttleUntil)return Math.min(cfg.idlePollSeconds*1000,throttleUntil-Date.now());
 if(Number(run.CLAIMABLE)>0&&Number(run.DUE)===1){
  setState('RUNNING','Evaluating run #'+run.SEQUENCE_NO+' generation '+activeGeneration);
  let n=0;
  while(!abort.signal.aborted&&Date.now()>=throttleUntil&&n<cfg.limits.maxEvaluationsPerCycle){
   if(!(await evaluateOne(run)))break;n++;
  }
  await tickRun(run.RUN_ID);
  return 0;
 }
 await tickRun(run.RUN_ID);
 if(Number(run.CLAIMABLE)>0){setState('RUNNING','Run #'+run.SEQUENCE_NO+' generation '+activeGeneration+' scheduled in '+Math.max(0,Number(run.WAIT_SECONDS))+' s');
  return Math.max(1000,Math.min(cfg.idlePollSeconds*1000,Number(run.WAIT_SECONDS)*1000));}
 setState('RUNNING','Run #'+run.SEQUENCE_NO+' generation '+activeGeneration+' awaiting completion');
 return cfg.workPollMilliseconds;
}

// ---------------------------------------------------------------------------
// Shutdown paths
// ---------------------------------------------------------------------------
async function completeShutdownCommands(state,result,{before=null}={}){
 const pending=await rows(db,`select command_id from apxgen_commands where state='PENDING' and command='SHUTDOWN'`+(before?' and requested_at<:b':''),before?{b:before}:{});
 for(const c of pending)await exec('begin apxgen_autonomy.complete_command(:t,:id,:s,:r);end;',{t:tokenBind(),id:c.COMMAND_ID,s:state,r:result.slice(0,900)});
 return pending.length;
}
async function releaseAll(finalState,text,{pauseReason=null}={}){
 setState(finalState,text);
 if(db&&token){
  try{if(pauseReason)await exec('begin apxgen_autonomy.shutdown_pause(:t,:r);end;',{t:tokenBind(),r:pauseReason},{retries54:10});}
  catch(error){await log.warn('Could not pause the active run during shutdown',{error:sanitizeText(error.message)});}
  // A stop file and a queued SHUTDOWN usually arrive together; close the command
  // here so it cannot stop the next instance.
  try{await completeShutdownCommands('DONE','Supervisor stopped: '+text);}catch{}
  try{await exec('begin apxgen_autonomy.release_lease(:t,:s,:d);end;',{t:tokenBind(),s:finalState,d:text});await dbLog(finalState==='SAFE_STOPPED'?'ERROR':'INFO','Supervisor '+finalState.toLowerCase()+': '+text);}
  catch(error){await log.warn('Lease release failed; it will expire',{error:sanitizeText(error.message)});}
  token=null;
 }
 await closeEvaluator('shutdown');
 if(server)await new Promise(r=>server.close(()=>r()));
 if(db)await db.close().catch(()=>{});
 await writeStatus();await releaseLock(LOCK);await log.info('Supervisor exited',{state:finalState,detail:text});await log.flush();
}

async function main(){
 if(!(await acquireLock(LOCK))){await log.warn('Another supervisor holds the local lock; exiting');await log.flush();return 3;}
 try{os.setPriority(process.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
 await unlink(STOP_FILE).catch(()=>{});
 await log.info('Supervisor starting',{version:VERSION,pid:process.pid,state:process.env.APXGEN_STATE||'lab'});
 const B=cfg.backoff;
 // Connect and lease, with capped backoff while Oracle is unavailable.
 for(let attempt=1;!abort.signal.aborted;attempt++){
  try{await openDatabase();if(await acquireLease())break;
   setState('STOPPED','Another live supervisor holds the Oracle lease');await writeStatus();await releaseLock(LOCK);await log.warn('Oracle lease held by another instance; exiting');await log.flush();return 3;}
  catch(error){const wait=Math.min(B.maxSeconds,B.initialSeconds*2**Math.min(attempt-1,10));
   setState('BACKOFF','Database unavailable: '+sanitizeText(error.message).slice(0,200));await writeStatus();await log.warn('Database unavailable; retrying',{waitSeconds:wait,error:sanitizeText(error.message)});
   db=null;await sleep(wait*1000,abort.signal);}
 }
 if(abort.signal.aborted){await releaseAll('STOPPED','Stopped before start ('+shutdownReason+')');return 0;}
 publisher=createPublisher({db:{execute:(...a)=>db.execute(...a),commit:()=>db.commit(),rollback:()=>db.rollback()},token:()=>token,cfg,log});
 await exec('begin apxgen_autonomy.ensure_scheduler;end;');
 // Starting the supervisor is the operator's latest intent: a SHUTDOWN queued
 // while no supervisor was running is closed instead of stopping this start.
 const superseded=await completeShutdownCommands('REJECTED','Superseded: the supervisor was started after this request',{before:new Date(started)});
 if(superseded)await log.info('Stale SHUTDOWN commands superseded',{count:superseded});
 setState('RUNNING','Lease held');await writeStatus();

 while(!abort.signal.aborted){
  let delay;
  try{
   try{await access(STOP_FILE);requestShutdown('stop file');break;}catch{}
   delay=await cycle();consecutiveFailures=0;
  }catch(error){
   const message=sanitizeText(error.message);
   if(error.safeStop){await log.error('Safe stop',{error:message});await releaseAll('SAFE_STOPPED',message,{pauseReason:'SAFE_STOP'});return 2;}
   if(error.errorNum===20070){
    await log.warn('Oracle lease lost; re-acquiring',{error:message});token=null;await closeEvaluator('lease lost');
    try{await openDatabase();if(!(await acquireLease())){await releaseAll('STOPPED','Lease taken by another instance');return 3;}}catch{}
   }else if(CONNECTION_ERROR.test(error.message)){
    await log.warn('Database connection lost',{error:message});try{await db?.close();}catch{}db=null;
    for(let a=1;!abort.signal.aborted;a++){try{await openDatabase();break;}catch{setState('BACKOFF','Database unavailable');await writeStatus();await sleep(Math.min(B.maxSeconds,B.initialSeconds*2**Math.min(a,10))*1000,abort.signal);}}
    continue;
   }
   consecutiveFailures++;
   const wait=Math.min(B.maxSeconds,B.initialSeconds*2**(consecutiveFailures-1));
   setState('BACKOFF','Failure '+consecutiveFailures+'/'+B.safeStopAfterFailures+': '+message.slice(0,300));
   await log.warn('Cycle failed',{error:message,consecutiveFailures,waitSeconds:wait});
   await dbLog('WARN','Supervisor cycle failed ('+consecutiveFailures+'/'+B.safeStopAfterFailures+'): '+message);
   if(consecutiveFailures>=B.safeStopAfterFailures){await releaseAll('SAFE_STOPPED','Repeated failures: '+message.slice(0,300),{pauseReason:'SAFE_STOP'});return 2;}
   delay=wait*1000;
   try{if(db&&token)await renew();}catch{}
  }
  await writeStatus();
  if(delay>0)await sleep(delay,abort.signal);
 }
 await releaseAll('STOPPED','Graceful shutdown ('+shutdownReason+')',{pauseReason:'SUPERVISOR_SHUTDOWN'});
 return 0;
}

let code=1;
try{code=await main();}
catch(error){await log.error('Supervisor fatal error',{error:sanitizeText(error.stack||error.message)});try{await releaseAll('STOPPED','Fatal: '+sanitizeText(error.message).slice(0,300));}catch{}}
await log.flush();
process.exit(code);
