// Trusted, bounded native entrypoint. No scheduler, arbitrary engine loader,
// public service or automatic retry is installed by this command.
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {isDeepStrictEqual} from 'node:util';
import oracledb from 'oracledb';
import {runApplicationSmoke} from './run-smoke.mjs';
import {runControlWorker,validateControlWorkerConfig,CONTROL_WORKER_CAPABILITY_VERSION} from '../../runtime/application/control-worker.mjs';
import {validateSandboxPolicy} from '../../runtime/application/sandbox.mjs';
import {parseLivingJson} from '../../showcase/living-evidence.mjs';
import {acquireCoordinatorLock,releaseCoordinatorLock} from '../../runtime/application/coordinator-lock.mjs';

const OWNER='APXGEN_ORDER_LAB',CALL_TIMEOUT_MS=10000,RESOURCE_TIMEOUT_MS=5000;
const identifier=/^[a-f0-9]{32}$/;
const check=(condition,message)=>{if(!condition)throw new TypeError(message);};
const options={outFormat:oracledb.OUT_FORMAT_OBJECT};
const pathString=value=>typeof value==='string'&&value.trim().length>0&&!/[\x00-\x1f"]/.test(value);
function exact(value,keys,message){check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),message);}

export function parseControlOnceArgs(argv){
 check(Array.isArray(argv)&&(argv.length===3||argv.length===4)&&pathString(argv[0])&&pathString(argv[1])&&/\.json$/i.test(argv[0])&&/\.json$/i.test(argv[1])&&!argv[0].startsWith('--')&&!argv[1].startsWith('--')&&argv[2]==='--once','Usage: run-control-once.mjs <native-worker.json> <sandbox-worker.json> --once [--wait-seconds=0..120]');
 let waitSeconds=0;if(argv.length===4){const match=/^--wait-seconds=(0|[1-9]\d{0,2})$/.exec(argv[3]);check(match&&Number(match[1])<=120,'Only a bounded --wait-seconds=0..120 argument is supported');waitSeconds=Number(match[1]);}
 return {nativeConfigPath:resolve(argv[0]),sandboxConfigPath:resolve(argv[1]),waitSeconds};
}

/** Pure validation happens before either direct-owner connection is opened. */
export function validateControlOnceConfiguration({native,sandbox,policy,oracle}){
 const config=validateControlWorkerConfig(native);
 check(config.leaseSeconds===300,'The bound engine requires the reviewed 300-second queue lease');
 check(!config.enabled||config.binding!=='DISABLED_NOT_A_BINDING','Replace the disabled example binding before enabling this worker configuration');
 exact(sandbox,['oracleConfigPath','sandboxPolicyPath','sqlclPath'],'Explicit three-path sandbox worker configuration is required');check(Object.values(sandbox).every(pathString),'Safe explicit sandbox configuration paths are required');
 validateSandboxPolicy(policy);
 check(policy.schema===OWNER&&policy.workspace===OWNER,'The dedicated application sandbox owner and workspace are required');
 check(oracle&&oracle.user===OWNER&&oracle.user===policy.schema&&oracle.workspace===policy.workspace,'Oracle credentials differ from the dedicated sandbox owner or workspace');
 check(typeof oracle.password==='string'&&oracle.password.length>0&&!/[\x00-\x1f"]/.test(oracle.password)&&typeof oracle.connectString==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/?=&%+-]*$/.test(oracle.connectString),'Explicit bounded sandbox credentials are required');
 check(['apexUser','apexPassword'].every(key=>typeof oracle[key]==='string'&&oracle[key].length>0&&!/[\x00-\x1f]/.test(oracle[key])),'Explicit private APEX sandbox credentials are required');
 check([...config.pool.applicationIds,config.pool.canaryApplicationId].every(app=>policy.applicationIds.includes(app)&&!policy.protectedApplicationIds.includes(app))&&policy.maxMaterializationsPerRun>=2,'Native application pool differs from the authorized sandbox policy');
 return {native:config,sandbox,policy,oracle};
}

async function jsonFile(path){const bytes=await readFile(path);check(bytes.length<=16384,'Configuration exceeds its bounded JSON size');return parseLivingJson(bytes.toString('utf8').replace(/^\uFEFF/,''));}
function bound(client){check(client&&['execute','commit','rollback','close'].every(key=>typeof client[key]==='function'),'A direct-owner queue connection is required');const old=client.callTimeout;client.callTimeout=Number.isSafeInteger(old)&&old>0?Math.min(old,CALL_TIMEOUT_MS):CALL_TIMEOUT_MS;check(Number.isInteger(client.callTimeout)&&client.callTimeout>0&&client.callTimeout<=CALL_TIMEOUT_MS,'A bounded queue driver timeout is required');}
async function bounded(operation){let timer;try{await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Bounded resource retirement timed out')),RESOURCE_TIMEOUT_MS);})]);return true;}catch{return false;}finally{if(timer!==undefined)clearTimeout(timer);}}

/** Always attempt both clients, even if one break/close fails or never settles. */
export async function retireControlConnections(clients,{force=false}={}){
 const unique=[...new Set(clients.filter(Boolean))];
 const outcomes=await Promise.all(unique.map(async client=>{let complete=true;if(force){if(typeof client.break==='function')complete=await bounded(()=>client.break());else complete=false;}const closed=await bounded(()=>client.close());return complete&&closed;}));
 return outcomes.every(Boolean);
}

async function serverSnapshot(db,config,policy,previous){
 const identities=[];
 for(const client of [db.queue,db.heartbeat]){const rows=(await client.execute("select sys_context('USERENV','CURRENT_SCHEMA') schema_name,sys_context('USERENV','SESSION_USER') session_user,sys_context('USERENV','CURRENT_USER') current_user,sys_context('USERENV','DB_NAME') database_name,sys_context('USERENV','CON_NAME') container_name from dual",{},options)).rows;check(rows?.length===1&&['SCHEMA_NAME','SESSION_USER','CURRENT_USER'].every(key=>rows[0][key]===OWNER),'Native worker connection identity differs from the dedicated owner');identities.push(rows[0]);}
 check(identities[0].DATABASE_NAME===identities[1].DATABASE_NAME&&identities[0].CONTAINER_NAME===identities[1].CONTAINER_NAME,'Queue and heartbeat must use the same dedicated Oracle database');
 const mappings=(await db.queue.execute('select w.workspace,w.workspace_id from apex_workspaces w join apex_workspace_schemas s on s.workspace_id=w.workspace_id where s.schema=:schema and w.workspace=:workspace',{schema:policy.schema,workspace:policy.workspace},options)).rows;
 check(mappings?.length===1&&mappings[0].WORKSPACE===policy.workspace&&mappings[0].WORKSPACE_ID===policy.workspaceId,'Actual Oracle workspace differs from the explicit sandbox policy');
 const rows=(await db.queue.execute('select config_id,enabled,schema_name,workspace_id,control_application_id,max_generations,max_materializations,worker_enabled,worker_binding from apxgen_app_control_config where config_id=1',{},options)).rows;check(rows?.length===1,'One explicit server control configuration is required');const row=rows[0];
 if(row.ENABLED!==1||row.WORKER_ENABLED!==1)return null;
 check(row.CONFIG_ID===1&&row.SCHEMA_NAME===policy.schema&&row.WORKSPACE_ID===policy.workspaceId&&row.WORKER_BINDING===config.binding&&row.MAX_GENERATIONS===1&&row.MAX_MATERIALIZATIONS===2&&Number.isSafeInteger(row.CONTROL_APPLICATION_ID)&&row.CONTROL_APPLICATION_ID>0&&![120,121,130,131,132,133,...config.pool.applicationIds,config.pool.canaryApplicationId].includes(row.CONTROL_APPLICATION_ID),'Server control binding, workspace, pool or capabilities differ from this worker');
 check(previous===null||isDeepStrictEqual(previous,row),'Reviewed server control configuration changed during bounded waiting');return row;
}

const safeReasons=new Set(['CONFIGURATION_UNAVAILABLE','CONNECTION_UNAVAILABLE','CONTROL_BINDING_UNAVAILABLE','CONTROL_WORKER_UNAVAILABLE','CLAIM_COMMIT_UNCERTAIN','INVALID_REQUEST','RUN_ATTACHMENT_FAILED','LEASE_RENEWAL_FAILED','LEASE_EXPIRED','DATABASE_DRAIN_UNCERTAIN','ENGINE_FAILED','MISSING_RUN_ATTACHMENT','RUN_IDENTITY_MISMATCH','ORACLE_FINISH_UNCERTAIN','RESOURCE_CLEANUP_UNCERTAIN','COORDINATOR_LOCKED','COORDINATOR_LOCK_UNCERTAIN']);
export function controlOnceOutput(result){
 const output={status:['disabled','idle','finished','uncertain'].includes(result?.status)?result.status:'uncertain'};
 for(const key of ['requestId','runId'])if(typeof result?.[key]==='string'&&identifier.test(result[key]))output[key]=result[key];
 if(output.status==='uncertain')output.reason=safeReasons.has(result?.reason)?result.reason:'CONTROL_WORKER_UNAVAILABLE';
 if(['COMPLETED','FAILED'].includes(result?.queueState))output.queueState=result.queueState;
 if(['COMPLETE','FAILED','CANCELLED'].includes(result?.oracleState))output.oracleState=result.oracleState;
 if(result?.cleanupPending===true)output.cleanupPending=true;if(result?.coordinatorLockRetained===true)output.coordinatorLockRetained=true;return output;
}

/**
 * Test services replace only configuration/primitive lock I/O, connections and time.
 * The engine binding is always the reviewed runApplicationSmoke import above.
 */
export async function runControlOnce(argv,services={}){
 check(services&&typeof services==='object'&&Object.keys(services).every(key=>['readJson','connect','sleep','now','lockIo'].includes(key)),'Unknown test service or alternate engine injection is forbidden');
 const parsed=parseControlOnceArgs(argv),readJson=services.readJson||jsonFile,connect=services.connect||(credentials=>oracledb.getConnection(credentials)),sleep=services.sleep||(ms=>new Promise(resolve=>setTimeout(resolve,ms))),now=services.now||(()=>performance.now());
 let native,sandbox,policy,oracle;
 try{native=validateControlWorkerConfig(await readJson(parsed.nativeConfigPath));if(!native.enabled)return {status:'disabled'};sandbox=await readJson(parsed.sandboxConfigPath);exact(sandbox,['oracleConfigPath','sandboxPolicyPath','sqlclPath'],'Explicit three-path sandbox worker configuration is required');check(Object.values(sandbox).every(pathString),'Safe explicit sandbox configuration paths are required');policy=await readJson(resolve(dirname(parsed.sandboxConfigPath),sandbox.sandboxPolicyPath));oracle=await readJson(resolve(dirname(parsed.sandboxConfigPath),sandbox.oracleConfigPath));}
 catch(error){if(error.code==='ENOENT')return {status:'disabled'};throw error instanceof TypeError?error:new TypeError('Explicit native and sandbox configuration is unavailable');}
 ({native,sandbox,policy,oracle}=validateControlOnceConfiguration({native,sandbox,policy,oracle}));
 // Atomic fixed path derives from the real sandbox config file location. It
 // spans both Oracle clients, idle waiting, engine work and resource retirement.
 let coordinator;try{coordinator=await acquireCoordinatorLock(parsed.sandboxConfigPath,{io:services.lockIo});}
 catch(error){return controlOnceOutput({status:'uncertain',reason:error.code==='COORDINATOR_LOCKED'?'COORDINATOR_LOCKED':'COORDINATOR_LOCK_UNCERTAIN',coordinatorLockRetained:error.lockRetained===true});}
 const clients=[];let result=null,force=false;
 try{
  const credentials={user:oracle.user,password:oracle.password,connectString:oracle.connectString};
  const queue=await connect(credentials);clients.push(queue);bound(queue);const heartbeat=await connect(credentials);clients.push(heartbeat);bound(heartbeat);check(queue!==heartbeat,'Two distinct owner connections are required');
  const db={queue,heartbeat};let snapshot=null;const deadline=now()+parsed.waitSeconds*1000;
  // The engine cannot be selected by a config path, environment value or flag.
  const engine=input=>{check(input.capabilityVersion===CONTROL_WORKER_CAPABILITY_VERSION&&input.mode==='GA_ONLY'&&input.paidRequestBudget===0,'Only the reviewed queued GA protocol is supported');return runApplicationSmoke(parsed.sandboxConfigPath,{applicationIds:input.pool.applicationIds,canaryApplicationId:input.pool.canaryApplicationId,queuedRequest:input.request,onRunCreated:input.onRunCreated,signal:input.signal});};
  while(true){
   snapshot=await serverSnapshot(db,native,policy,snapshot);if(snapshot===null){result={status:'disabled'};break;}
   result=await runControlWorker({db,engine,config:native});if(result.status!=='idle')break;
   const remaining=deadline-now();if(remaining<=0)break;await sleep(Math.min(5000,remaining));if(now()>=deadline)break;
  }
  force=result.status==='uncertain'||result.cleanupPending===true;
 }catch{force=true;result={status:'uncertain',reason:clients.length<2?'CONNECTION_UNAVAILABLE':'CONTROL_BINDING_UNAVAILABLE'};}
 finally{
  const complete=await retireControlConnections(clients,{force});if(!complete)result={...controlOnceOutput(result),status:'uncertain',reason:'RESOURCE_CLEANUP_UNCERTAIN',cleanupPending:true};
  // Disabled server admission made no claim; idle/finished are Oracle-verified.
  // Every uncertainty retains the marker, even after connections appear closed.
  if(complete&&['disabled','idle','finished'].includes(result?.status)&&result?.cleanupPending!==true){try{await releaseCoordinatorLock(coordinator);}catch{result={...controlOnceOutput(result),status:'uncertain',reason:'COORDINATOR_LOCK_UNCERTAIN',coordinatorLockRetained:true};}}
  else result={...controlOnceOutput(result),coordinatorLockRetained:true};
 }
 return controlOnceOutput(result);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const result=await runControlOnce(process.argv.slice(2));console.log(JSON.stringify(controlOnceOutput(result)));if(result.status==='uncertain')process.exitCode=1;}catch{console.error(JSON.stringify({status:'disabled',reason:'CONFIGURATION_UNAVAILABLE'}));process.exitCode=1;}}
