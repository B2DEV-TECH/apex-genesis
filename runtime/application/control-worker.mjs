// Native, one-claim bridge for the private Order Lab control queue. The CLI is
// deliberately unbound: this module never opens Oracle or starts an app itself.
import oracledb from 'oracledb';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {parseLivingJson} from '../../showcase/living-evidence.mjs';

export const CONTROL_WORKER_CAPABILITY_VERSION='order-lab-queued-feasibility/1.0';
const owner='APXGEN_ORDER_LAB',id=/^[a-f0-9]{32}$/;
const CALL_TIMEOUT_MS=10000,DRAIN_TIMEOUT_MS=10000;
const check=(condition,message)=>{if(!condition)throw new TypeError(message);};
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483647;
function exact(object,required,name){check(object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).length===required.length&&required.every(key=>Object.hasOwn(object,key)),'Explicit '+name+' configuration with no unknown fields is required');}

export function validateControlWorkerConfig(value){
 exact(value,['schemaVersion','enabled','mode','paidRequestBudget','binding','pool','capabilities','leaseSeconds','heartbeatSeconds'],'worker');
 check(value.schemaVersion==='1.0'&&typeof value.enabled==='boolean','Unsupported worker configuration version or enabled flag');
 check(value.mode==='GA_ONLY'&&value.paidRequestBudget===0,'Worker permits GA_ONLY with zero paid requests');
 check(typeof value.binding==='string'&&/^[A-Za-z0-9_-]{8,64}$/.test(value.binding),'Explicit bounded worker binding is required');
 exact(value.pool,['applicationIds','canaryApplicationId'],'application pool');
 check(Array.isArray(value.pool.applicationIds)&&value.pool.applicationIds.length===2&&value.pool.applicationIds.every(positive)&&new Set(value.pool.applicationIds).size===2&&positive(value.pool.canaryApplicationId)&&!value.pool.applicationIds.includes(value.pool.canaryApplicationId)&&[...value.pool.applicationIds,value.pool.canaryApplicationId].every(app=>![120,121].includes(app)),'Worker pool requires two distinct applications and a separate authorized canary');
 exact(value.capabilities,['seed','advances','materializations'],'capabilities');
 check(value.capabilities.seed===50000&&value.capabilities.advances===1&&value.capabilities.materializations===2,'Worker capabilities support only seed 50000, one advance and two materializations');
 check(Number.isSafeInteger(value.leaseSeconds)&&value.leaseSeconds>=30&&value.leaseSeconds<=300,'Worker lease must be 30..300 seconds');
 check(Number.isSafeInteger(value.heartbeatSeconds)&&value.heartbeatSeconds>=1&&value.heartbeatSeconds<=Math.min(60,value.leaseSeconds/3),'Worker heartbeat must be at most 60 seconds and one third of its lease');
 return Object.freeze({...value,pool:Object.freeze({applicationIds:Object.freeze([...value.pool.applicationIds]),canaryApplicationId:value.pool.canaryApplicationId}),capabilities:Object.freeze({...value.capabilities})});
}

function connection(value){return value&&['execute','commit','rollback'].every(name=>typeof value[name]==='function');}
function boundConnection(client){
 try{const previous=client.callTimeout;client.callTimeout=Number.isSafeInteger(previous)&&previous>0?Math.min(previous,CALL_TIMEOUT_MS):CALL_TIMEOUT_MS;check(Number.isSafeInteger(client.callTimeout)&&client.callTimeout>0&&client.callTimeout<=CALL_TIMEOUT_MS,'Bounded queue driver timeout is required');}
 catch{throw new TypeError('Queue and heartbeat connections require a bounded driver callTimeout before SQL');}
}
async function drainWithin(promise){let timer;try{return await Promise.race([promise.then(()=>true,()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),DRAIN_TIMEOUT_MS);})]);}finally{if(timer!==undefined)clearTimeout(timer);}}
const options={outFormat:oracledb.OUT_FORMAT_OBJECT};
async function assertOwner(db){
 const rows=(await db.execute("select sys_context('USERENV','CURRENT_SCHEMA') schema_name,sys_context('USERENV','SESSION_USER') session_user,sys_context('USERENV','CURRENT_USER') current_user from dual",{},options)).rows;
 check(rows?.length===1&&['SCHEMA_NAME','SESSION_USER','CURRENT_USER'].every(key=>rows[0][key]===owner),'Queue and heartbeat require the direct authorized Oracle owner identity');
}
async function assertConfiguration(db,config){
 const rows=(await db.execute('select config_id,enabled,schema_name,workspace_id,control_application_id,max_generations,max_materializations,worker_enabled,worker_binding from apxgen_app_control_config where config_id=1',{},options)).rows;
 check(rows?.length===1,'Exactly one bound Oracle control configuration is required');const row=rows[0];
 check(row.CONFIG_ID===1&&row.ENABLED===1&&row.WORKER_ENABLED===1&&row.SCHEMA_NAME===owner&&Number.isSafeInteger(row.WORKSPACE_ID)&&row.WORKSPACE_ID>0&&positive(row.CONTROL_APPLICATION_ID)&&row.WORKER_BINDING===config.binding,'Oracle control configuration is disabled, unbound or differs from this worker');
 check(row.MAX_GENERATIONS===1&&row.MAX_MATERIALIZATIONS===2,'Oracle control capabilities must advertise exactly the supported bounds');
 check(![120,121,130,131,132,133,...config.pool.applicationIds,config.pool.canaryApplicationId].includes(row.CONTROL_APPLICATION_ID),'Control application overlaps a protected application or engine pool');
}
async function claimJson(value){
 if(value===null)return null;
 if(value&&typeof value.getData==='function'){const lob=value;try{value=await lob.getData();}finally{if(typeof lob.close==='function')await lob.close();}}
 check(typeof value==='string'&&Buffer.byteLength(value,'utf8')<=4096,'Bounded Oracle claim JSON is required');return parseLivingJson(value);
}
function validateClaim(claim,config){
 exact(claim,['id','label','state','seed','generations','materializationBudget','runId','claimToken'],'claim');
 check(id.test(claim.id)&&id.test(claim.claimToken)&&claim.state==='CLAIMED'&&claim.runId===null,'A new exact-token Oracle claim is required');
 check(typeof claim.label==='string'&&claim.label.trim().length>0&&Buffer.byteLength(claim.label,'utf8')<=120&&!/\p{Cc}/u.test(claim.label),'A bounded immutable request label is required');
 check(claim.seed===config.capabilities.seed&&claim.generations===1&&claim.materializationBudget===2,'Claim exceeds the supported worker capabilities');
}
async function assertCurrentClaim(db,claim,config){
 const rows=(await db.execute('select request_id,label,state,population_mode,seed,generations,materialization_budget,run_id,claim_token,claim_binding,case when lease_until>systimestamp then 1 else 0 end lease_current from apxgen_app_control_requests where request_id=:request',{request:claim.id},options)).rows;
 check(rows?.length===1,'Immutable Oracle request is missing');const row=rows[0];
 check(row.REQUEST_ID===claim.id&&row.LABEL===claim.label&&row.STATE==='CLAIMED'&&row.POPULATION_MODE==='GA_ONLY'&&row.SEED===claim.seed&&row.GENERATIONS===claim.generations&&row.MATERIALIZATION_BUDGET===claim.materializationBudget&&row.RUN_ID===null&&row.CLAIM_TOKEN===claim.claimToken&&row.CLAIM_BINDING===config.binding&&row.LEASE_CURRENT===1,'Claim differs from its immutable Oracle request or live lease');
}

/**
 * One invocation claims at most one request. db.queue and db.heartbeat are
 * distinct owner connections, separate from the engine's Oracle connection.
 * engine is an internal binding (a synthetic function in unit tests), never
 * an operator-selected module or executable. It must honor its AbortSignal.
 * The trusted caller owns connection closure. If cleanupPending is returned,
 * retire both connections with bounded break/close; never reuse them or retry
 * the uncertain request. No claim is released or requeued by this bridge.
 */
export async function runControlWorker({db,engine,config}={}){
 if(config===undefined)return {status:'disabled'};
 const cfg=validateControlWorkerConfig(config);if(!cfg.enabled)return {status:'disabled'};
 check(db&&connection(db.queue)&&connection(db.heartbeat)&&db.queue!==db.heartbeat,'Separate queue and heartbeat owner connections are required');check(typeof engine==='function','A reviewed internal engine binding is required');
 boundConnection(db.queue);boundConnection(db.heartbeat);
 await assertOwner(db.queue);await assertOwner(db.heartbeat);await assertConfiguration(db.queue,cfg);
 let operationTail=Promise.resolve();
 // Both queue connections touch the configuration lock. Serialize short
 // transactions to avoid competing with this worker's own heartbeat.
 function transaction(client,operation){const task=operationTail.then(async()=>{try{const result=await operation();await client.commit();return result;}catch(error){try{await client.rollback();}catch{}throw error;}});operationTail=task.catch(()=>{});return task;}
 try{await transaction(db.heartbeat,()=>db.heartbeat.execute('begin apxgen_app_control.worker_heartbeat(:binding);end;',{binding:cfg.binding}));}
 catch{throw new Error('Native queue worker heartbeat admission failed');}
 let claim=null,attachedRun=null,fatalReason=null,stopped=false,timer=null,leaseTimer=null,leaseDeadline=null,claimStartedAt=null,pendingRenew=null,attachmentStarted=false;
 const controller=new AbortController();
 function abort(reason){fatalReason=fatalReason||reason;controller.abort(new Error(fatalReason));if(timer!==null)clearInterval(timer);if(leaseTimer!==null)clearTimeout(leaseTimer);}
 function armLease(startedAt){
  if(leaseTimer!==null)clearTimeout(leaseTimer);
  // Start before the Oracle invocation, not its response. A stalled network
  // cannot extend authority; stop one second before this conservative bound.
  leaseDeadline=startedAt+cfg.leaseSeconds*1000-1000;
  const remaining=leaseDeadline-performance.now();if(remaining<=0){abort('LEASE_EXPIRED');return;}
  leaseTimer=setTimeout(()=>abort('LEASE_EXPIRED'),remaining);
 }
 function assertLease(){if(leaseDeadline!==null&&performance.now()>=leaseDeadline)abort('LEASE_EXPIRED');check(!controller.signal.aborted,'Worker claim authority has expired');}
 const uncertain=reason=>({status:'uncertain',requestId:id.test(claim?.id||'')?claim.id:null,runId:attachedRun,reason:fatalReason||reason});
 try{
  await transaction(db.queue,async()=>{claimStartedAt=performance.now();const result=await db.queue.execute('begin :claim:=apxgen_app_control.worker_claim(:binding,:lease_seconds);end;',{claim:{dir:oracledb.BIND_OUT,type:oracledb.CLOB},binding:cfg.binding,lease_seconds:cfg.leaseSeconds});claim=await claimJson(result.outBinds?.claim);});
 }catch{return uncertain('CLAIM_COMMIT_UNCERTAIN');}
 if(claim===null)return {status:'idle'};
 try{validateClaim(claim,cfg);await assertCurrentClaim(db.queue,claim,cfg);}catch{return uncertain('INVALID_REQUEST');}
 armLease(claimStartedAt);if(controller.signal.aborted)return uncertain('LEASE_EXPIRED');
 const privateBinds=()=>({request:claim.id,binding:cfg.binding,token:claim.claimToken});
 async function onRunCreated(run){
  if(stopped||attachmentStarted||!id.test(run)||controller.signal.aborted){abort('RUN_ATTACHMENT_FAILED');throw new Error('Fresh Oracle run attachment was refused');}
  attachmentStarted=true;
  try{
   await transaction(db.queue,async()=>{assertLease();await db.queue.execute('begin apxgen_app_control.worker_attach_run(:request,:binding,:token,:run);end;',{...privateBinds(),run});});
   attachedRun=run;assertLease();
  }catch{abort('RUN_ATTACHMENT_FAILED');throw new Error('Fresh Oracle run attachment failed');}
 }
 timer=setInterval(()=>{
  if(stopped||pendingRenew||controller.signal.aborted)return;
  let renewedAt;
  pendingRenew=transaction(db.heartbeat,async()=>{assertLease();renewedAt=performance.now();await db.heartbeat.execute('begin apxgen_app_control.worker_renew(:request,:binding,:token,:lease_seconds);end;',{...privateBinds(),lease_seconds:cfg.leaseSeconds});}).then(()=>{if(!stopped&&!controller.signal.aborted)armLease(renewedAt);}).catch(()=>abort('LEASE_RENEWAL_FAILED')).finally(()=>{pendingRenew=null;});
 },cfg.heartbeatSeconds*1000);
 const request=Object.freeze({id:claim.id,label:claim.label,seed:claim.seed,generations:claim.generations,materializationBudget:claim.materializationBudget});
 const input=Object.freeze({request,pool:cfg.pool,mode:'GA_ONLY',paidRequestBudget:0,capabilityVersion:CONTROL_WORKER_CAPABILITY_VERSION,signal:controller.signal,onRunCreated});
 let result,engineFailed=false,drained=true;
 try{assertLease();result=await engine(input);}catch{engineFailed=true;}
 finally{stopped=true;clearInterval(timer);drained=await drainWithin(Promise.allSettled([pendingRenew,operationTail]));if(leaseTimer!==null)clearTimeout(leaseTimer);}
 if(!drained){abort('DATABASE_DRAIN_UNCERTAIN');return {...uncertain('DATABASE_DRAIN_UNCERTAIN'),cleanupPending:true};}
 if(fatalReason)return uncertain(fatalReason);
 if(attachedRun===null)return uncertain(engineFailed?'ENGINE_FAILED':'MISSING_RUN_ATTACHMENT');
 if(!engineFailed&&result?.runId!==attachedRun)return uncertain('RUN_IDENTITY_MISMATCH');
 try{
  // No engine-provided status or fitness is accepted. Oracle derives the
  // terminal queue outcome from the exact attached run under its live lease.
  await transaction(db.queue,()=>db.queue.execute('begin apxgen_app_control.worker_finish(:request,:binding,:token);end;',privateBinds()));
  const rows=(await db.queue.execute('select r.request_id,r.run_id,r.state request_state,a.state run_state from apxgen_app_control_requests r join apxgen_app_runs a on a.run_id=r.run_id where r.request_id=:request',{request:claim.id},options)).rows;
  check(rows?.length===1&&rows[0].REQUEST_ID===claim.id&&rows[0].RUN_ID===attachedRun,'Terminal Oracle request identity differs');const row=rows[0];
  check((row.RUN_STATE==='COMPLETE'&&row.REQUEST_STATE==='COMPLETED')||(['FAILED','CANCELLED'].includes(row.RUN_STATE)&&row.REQUEST_STATE==='FAILED'),'Oracle run has no verified terminal queue outcome');
  return {status:'finished',requestId:claim.id,runId:attachedRun,queueState:row.REQUEST_STATE,oracleState:row.RUN_STATE};
 }catch{return uncertain(engineFailed?'ENGINE_FAILED':'ORACLE_FINISH_UNCERTAIN');}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 console.error(process.argv.slice(2).every(value=>value==='--once')?'Native control worker CLI is disabled until its trusted engine and explicit sandbox binding are reviewed.':'Only --once is supported; native control worker CLI remains disabled.');process.exitCode=1;
}
