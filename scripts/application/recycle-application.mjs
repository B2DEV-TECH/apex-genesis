// Initial generic executor: terminal runs only, explicit owner approval, four
// disposable slots. No operation runs on import of this module. Migration 011
// must be reviewed/installed separately; neither this module nor its CLI does so.
// STARTED after a crash is uncertain and permanently blocks automatic retries.
import { readFile, writeFile, mkdir, lstat, realpath, readdir } from 'node:fs/promises';
import { resolve, join, dirname, sep, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import oracledb from 'oracledb';
import { validateSandboxPolicy, assertSandboxIdentity } from '../../runtime/application/sandbox.mjs';
import { canonicalApplicationGenome } from '../../evolution/application/genome.mjs';
import { hashApplicationDefinition } from './build-definition.mjs';
import { archiveApplication } from './archive-application.mjs';
import { assertArchivePreparationObservation } from './archive-application.mjs';
import { createRecyclingAuthorization, assertRecyclingAuthorization, createOwnedCleanupAttempt, recyclingAuthorizationHash, recyclingPolicyHash } from './recycle-policy.mjs';
import { coordinatorLockPath, acquireCoordinatorLock, releaseCoordinatorLock } from '../../runtime/application/coordinator-lock.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new TypeError(message);};
const check=(value,message)=>{if(!value)fail(message);};
const id=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stable=value=>value instanceof Date?stable(value.toJSON()):Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
const equal=(a,b)=>stable(a)===stable(b);
const copy=value=>JSON.parse(JSON.stringify(value));
const policyHash=recyclingPolicyHash;
const roles={candidate:'candidate-evidence.json',compiler:'compiler/compiler-validation.json',compilerOutput:'compiler/compiler-output.txt',import:'import/import-evidence.json',importOutput:'import/import-output.txt'};
const inside=(root,path)=>path===root||path.startsWith(root+sep);
function keys(value,expected,label){check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key)),'Invalid '+label+' fields');}
async function json(path){try{return JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));}catch{fail('Private recycling configuration or evidence is unreadable');}}
async function save(path,value){await writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
function resourceError(report,code){if(report){report.resourceCleanupErrors??=[];if(!report.resourceCleanupErrors.includes(code))report.resourceCleanupErrors.push(code);}}
async function settleResources(operations,report){for(const [code,operation]of operations){try{await operation();}catch{resourceError(report,code);}}}
async function closeContext(ctx,report,evidenceDir,completed=false){
  await settleResources([['ROLLBACK_FAILED',()=>ctx.db?.rollback()],['CLOSE_FAILED',()=>ctx.db?.close()]],report);
  if(completed&&!report?.resourceCleanupErrors?.length)await settleResources([['LOCK_RELEASE_FAILED',()=>ctx.release()]],report);
  else resourceError(report,'LOCK_RETAINED');
  if(report?.resourceCleanupErrors?.length&&evidenceDir){try{await save(join(evidenceDir,'resource-cleanup.json'),{kind:'recycling-resource-cleanup-1',resourceCleanupErrors:report.resourceCleanupErrors});}catch{resourceError(report,'RESOURCE_AUDIT_WRITE_FAILED');}}
}
async function realDirectory(path){check(typeof path==='string'&&path.trim()&&!/[\x00-\x1f"]/.test(path),'Explicit safe private directory required');const info=await lstat(resolve(path));check(info.isDirectory()&&!info.isSymbolicLink(),'Recycling evidence directories cannot be symbolic links');return realpath(resolve(path));}
async function bytesAt(root,path){check(typeof path==='string'&&/^[-A-Za-z0-9_./]+$/.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Unsafe evidence path');let full=root;for(const part of path.split('/')){full=join(full,part);check(!(await lstat(full)).isSymbolicLink(),'Evidence paths cannot traverse symbolic links');}check(inside(root,await realpath(full)),'Evidence escaped its root');const info=await lstat(full);check(info.isFile()&&info.size>0&&info.size<=16*1024*1024,'Invalid evidence file size/type');return readFile(full);}
async function catalog(root,prefix=''){
  const result=[];
  for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){
    const path=prefix?prefix+'/'+entry.name:entry.name;check(!entry.isSymbolicLink(),'Candidate inventories cannot traverse symbolic links');
    if(entry.isDirectory())result.push(...await catalog(root,path));
    else{check(entry.isFile(),'Unsupported candidate evidence entry');if(path==='evidence-manifest.json')continue;const bytes=await bytesAt(root,path);result.push({path,sha256:sha(bytes),bytes:bytes.length});}
  }
  result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);check(result.length<=4096&&result.reduce((sum,file)=>sum+file.bytes,0)<=128*1024*1024,'Candidate evidence exceeds its bound');return result;
}

export function assertTerminalRecycleApproval(policy,approval,request){
  validateSandboxPolicy(policy);
  keys(request,['mode','applicationId','runId','organismId','genomeHash','definitionHash'],'recycling request');
  keys(approval,['mode','schema','workspace','workspaceId','applicationId','runId','organismId','genomeHash','definitionHash','policyHash','expectedDatabase'],'explicit terminal target approval');
  check(request.mode==='RECYCLE_OWNED_APPLICATION'&&approval.mode==='RECYCLE_TERMINAL_OWNED_APPLICATION','Explicit terminal recycling mode required');
  check([130,131,132,133].includes(request.applicationId)&&policy.applicationIds.includes(request.applicationId)&&![120,121,134,...policy.protectedApplicationIds].includes(request.applicationId),'Target is protected/control or outside the initial disposable pool');
  check(approval.schema===policy.schema&&approval.workspace===policy.workspace&&approval.workspaceId===policy.workspaceId&&approval.policyHash===policyHash(policy),'Original explicit policy/owner approval changed');
  for(const name of ['applicationId','runId','organismId','genomeHash','definitionHash'])check(approval[name]===request[name],'Approved target ownership differs');
  check(id(request.runId)&&id(request.organismId)&&hash(request.genomeHash)&&hash(request.definitionHash),'Immutable owner/genome/artifact identity required');
  keys(approval.expectedDatabase,['databaseName','containerName'],'explicit database identity');
  check(Object.values(approval.expectedDatabase).every(value=>typeof value==='string'&&/^[A-Z][A-Z0-9_$#]{0,127}$/.test(value)),'Exact expected database/container required');return true;
}

/** Copies every actual original candidate file; no generated image or log rewriting. */
export async function preserveOriginalCandidateEvidence({originalCandidateDir,evidenceDir,request}={}){
  const source=await realDirectory(originalCandidateDir),destination=resolve(evidenceDir),actualParent=await realpath(dirname(destination)),output=join(actualParent,destination.slice(dirname(destination).length+1));
  check(!inside(source,output)&&!inside(output,source),'Candidate preservation must be separate from the original');
  const files=await catalog(source),candidate=JSON.parse((await bytesAt(source,roles.candidate)).toString()),compiler=JSON.parse((await bytesAt(source,roles.compiler)).toString()),imported=JSON.parse((await bytesAt(source,roles.import)).toString());
  check(candidate.organismId===request.organismId&&candidate.applicationId===request.applicationId&&candidate.genomeHash===request.genomeHash&&candidate.definitionHash===request.definitionHash,'Original candidate ownership differs');
  check(compiler.compilerValid===true&&compiler.definitionHash===request.definitionHash&&compiler.outputSha256===sha(await bytesAt(source,roles.compilerOutput)),'Original compiler evidence/output differs');
  check(imported.importVerified===true&&imported.runId===request.runId&&imported.organismId===request.organismId&&imported.applicationId===request.applicationId&&imported.definitionHash===request.definitionHash&&imported.compilerEvidenceSha256===sha(await bytesAt(source,roles.compiler))&&imported.outputSha256===sha(await bytesAt(source,roles.importOutput)),'Original actual import evidence/output differs');
  check((await hashApplicationDefinition(join(source,'definition/application'))).definitionHash===request.definitionHash,'Original source no longer matches the imported artifact');
  for(const screenshot of candidate.browserMeasurements?.screenshots||[])check(hash(screenshot.sha256)&&files.some(file=>file.sha256===screenshot.sha256),'Actual screenshot is missing from the original inventory');
  await mkdir(output);
  for(const file of files){const bytes=await bytesAt(source,file.path);check(sha(bytes)===file.sha256,'Original candidate changed during preservation');await mkdir(dirname(join(output,file.path)),{recursive:true});await writeFile(join(output,file.path),bytes,{flag:'wx'});check(sha(await bytesAt(output,file.path))===file.sha256,'Preserved candidate failed byte verification');}
  check(equal(await catalog(source),files),'Original candidate changed during inventory');
  const manifest={kind:'owned-application-evidence-1',request:copy(request),roles,files},bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(join(output,'evidence-manifest.json'),bytes,{flag:'wx'});
  return {evidenceDir:output,evidenceManifestSha256:sha(bytes),files:files.length};
}

/** Orchestration boundary. Production supplies the locked Oracle backend below;
 * injected backends are for unit fault tests and cannot establish runtime proof.
 */
export async function executeTerminalRecycle({policy,request,approval,preservation,cleanupDir,backend}={}){
  assertTerminalRecycleApproval(policy,approval,request);
  ({policy,request,approval,preservation}=copy({policy,request,approval,preservation}));
  check(backend&&['observe','currentPolicy','fixture','canaries','startAttempt','commit','rollback','removeApplication','deleteOwnedRows','absence','finishAttempt','recordEvent'].every(name=>typeof backend[name]==='function'),'Trusted recycling backend required');
  const snapshot=await json(join(preservation.snapshotDir,'snapshot-manifest.json'));
  check(sha(await readFile(join(preservation.snapshotDir,'snapshot-manifest.json')))===preservation.snapshotManifestSha256,'Snapshot manifest changed');
  const savedOrders=await json(join(preservation.snapshotDir,'orders.json')),savedCanaries=await json(join(preservation.snapshotDir,'canaries.json'));
  let observed=await backend.observe();check(['COMPLETE','FAILED','CANCELLED'].includes(observed.run?.state),'Initial recycling executor refuses every live/running owner run');
  check(observed.run.bestOrganismId!==request.organismId,'The current incumbent is pinned, including terminal source runs');
  const authorization=await createRecyclingAuthorization({policy,request,observed,preservation});
  check(equal(await backend.fixture(),savedOrders)&&equal(await backend.canaries(),savedCanaries),'Snapshot fixture or other-application canaries changed before cleanup');
  await mkdir(cleanupDir);
  const attemptId=randomUUID().replaceAll('-',''),ownAttempt=createOwnedCleanupAttempt(authorization,attemptId);
  const audit={attemptId,request:copy(request),authorizationHash:recyclingAuthorizationHash(authorization),disposalVerified:false,apiInvoked:false,cleanupAttemptCommitted:false};
  let started=false;
  try{
    await save(join(cleanupDir,'authorization.json'),authorization);
    await backend.startAttempt(attemptId,authorization);started=true;await backend.commit();audit.cleanupAttemptCommitted=true;
    policy=await backend.currentPolicy();assertTerminalRecycleApproval(policy,approval,request);
    observed=await backend.observe();check(['COMPLETE','FAILED','CANCELLED'].includes(observed.run?.state),'Owner run is no longer terminal');
    check(observed.run.bestOrganismId!==request.organismId,'The current incumbent is pinned');
    await assertRecyclingAuthorization({authorization,ownAttempt,policy,request,observed,preservation});
    check(equal(await backend.fixture(),savedOrders)&&equal(await backend.canaries(),savedCanaries),'Fixture or canary changed after the durable attempt');
    audit.apiInvoked=true;await backend.removeApplication();
    const after=await backend.observe();check(after.application===null&&equal(after,{...observed,application:null}),'Removal did not preserve exact released ownership and terminal state');
    check(equal(await backend.fixture(),savedOrders)&&equal(await backend.canaries(),savedCanaries),'Fixture or other-application canaries changed during removal');
    const removed=await backend.deleteOwnedRows();check(removed.orders===savedOrders.length&&removed.orders===40&&removed.slots===1,'Only the exact owned fixture and registry may be removed');
    check(equal(await backend.canaries(),savedCanaries),'Other applications/registry/fixtures changed before cleanup commit');
    await backend.commit();
    check(equal(await backend.absence(),{applications:0,orders:0,slots:0})&&equal(await backend.canaries(),savedCanaries),'Final independent absence/canary verification failed');
    await backend.finishAttempt(attemptId,'VERIFIED');await backend.recordEvent('DISPOSED',{cleanupId:attemptId,applicationId:request.applicationId});await backend.commit();
    Object.assign(audit,{disposalVerified:true,deletedFixtureRows:removed.orders,deletedRegistryRows:removed.slots,otherApplicationsUnchanged:true,completedAt:new Date().toISOString()});await save(join(cleanupDir,'cleanup-result.json'),audit);return audit;
  }catch(error){
    await settleResources([['ROLLBACK_FAILED',()=>backend.rollback()]],audit);audit.disposalVerified=false;audit.failure=/^(?:ORA|NJS)-\d+$/.test(error.code||'')?error.code:'CLEANUP_INCOMPLETE';
    if(started){try{await backend.finishAttempt(attemptId,'UNCERTAIN',audit.failure);await backend.recordEvent('CLEANUP_UNCERTAIN',{cleanupId:attemptId,applicationId:request.applicationId});await backend.commit();audit.attemptState='UNCERTAIN';}catch{await settleResources([['ROLLBACK_FAILED',()=>backend.rollback()]],audit);audit.attemptState='FINALIZATION_UNKNOWN';}}
    await save(join(cleanupDir,'cleanup-incomplete.json'),audit);fail('Cleanup incomplete or uncertain; preserve all evidence and never retry automatically');
  }finally{await settleResources([['ROLLBACK_FAILED',()=>backend.rollback()]],audit);}
}

/** The trusted operator/worker coordinator must actually stop its own browser
 * and workers, then attest these facts. Missing lease observations never mean 0.
 */
export function assertRecycleQuiescence(attestation,request,{now=Date.now(),runEvidenceSha256}={}){
  keys(attestation,['kind','applicationId','runId','organismId','runEvidenceSha256','workerStopped','browserStopped','activeWorkerCount','activeEvaluationLeases','activeBrowserLeases','observedAt','expiresAt'],'owner quiescence attestation');
  check(attestation.kind==='operator-owned-worker-stop-1'&&['applicationId','runId','organismId'].every(key=>attestation[key]===request[key])&&hash(runEvidenceSha256)&&attestation.runEvidenceSha256===runEvidenceSha256,'Quiescence attestation belongs to another original owner/run');
  check(attestation.workerStopped===true&&attestation.browserStopped===true&&['activeWorkerCount','activeEvaluationLeases','activeBrowserLeases'].every(key=>attestation[key]===0),'Owned workers/browser must actually stop and all evaluation/browser leases end');
  const at=Date.parse(attestation.observedAt),until=Date.parse(attestation.expiresAt);
  check(Number.isFinite(now)&&Number.isFinite(at)&&Number.isFinite(until)&&at<=now+5000&&until>now&&until>at&&until-at<=15*60*1000,'Quiescence attestation is stale or invalid');return true;
}

const dbOptions={outFormat:oracledb.OUT_FORMAT_OBJECT,fetchTypeHandler:metadata=>metadata.dbType===oracledb.DB_TYPE_CLOB?{type:oracledb.STRING}:undefined};
const rows=async(db,sql,binds={})=>(await db.execute(sql,binds,dbOptions)).rows;
const archiveRequest=request=>({mode:'ARCHIVE_ONLY',applicationId:request.applicationId,runId:request.runId,organismId:request.organismId,definitionHash:request.definitionHash});

async function assertWorkerContext(db,policy,expectedDatabase){
  await db.execute(`begin
    if sys_context('USERENV','SESSION_USER')<>:schema or sys_context('USERENV','CURRENT_SCHEMA')<>:schema or sys_context('USERENV','CURRENT_USER')<>:schema
      or sys_context('USERENV','DB_NAME')<>:database_name or sys_context('USERENV','CON_NAME')<>:container_name
      or nvl(apex_application.g_flow_id,0)<>0 or nvl(apex_application.g_instance,0)<>0 or v('APP_ID') is not null or v('APP_USER') is not null then
      raise_application_error(-20137,'Direct approved cleanup worker context required');
    end if;
  end;`,{schema:policy.schema,database_name:expectedDatabase.databaseName,container_name:expectedDatabase.containerName});
}

async function observeLocked(db,policy,request,approval,quiescence){
  assertRecycleQuiescence(quiescence,request,{runEvidenceSha256:quiescence.runEvidenceSha256});
  await assertWorkerContext(db,policy,approval.expectedDatabase);
  const mappings=await rows(db,'select workspace_name,workspace_id from apex_workspace_schemas where schema=:schema and workspace_name=:workspace',{schema:policy.schema,workspace:policy.workspace});
  check(mappings.length===1&&mappings[0].WORKSPACE_ID===policy.workspaceId,'Exact schema/workspace mapping required');
  await db.execute('lock table genesis_order_lab_slots in exclusive mode nowait');
  const run=(await rows(db,'select run_id,state,best_organism_id,current_generation,materializations,materialization_budget from apxgen_app_runs where run_id=:run for update nowait',{run:request.runId}))[0];
  const organism=(await rows(db,'select organism_id,run_id,application_id,genome_json,genome_hash,artifact_hash,state from apxgen_app_organisms where organism_id=:organism for update nowait',{organism:request.organismId}))[0];
  const slot=(await rows(db,"select application_id,workspace_id,owner_run_id,owner_organism_id,slot_state,case when slot_state='ACTIVE' and lease_until>systimestamp then 1 else 0 end lease_current from genesis_order_lab_slots where application_id=:app for update nowait",{app:request.applicationId}))[0];
  const app=(await rows(db,'select application_id,workspace,owner from apex_applications where application_id=:app',{app:request.applicationId}))[0];
  const imports=await rows(db,'select attempt_id,organism_id,run_id,application_id,definition_hash,state,case when completed_at is not null then 1 else 0 end completed from apxgen_app_import_attempts where organism_id=:organism',{organism:request.organismId});
  const attempts=await rows(db,'select attempt_id,organism_id,run_id,application_id,genome_hash,artifact_hash,policy_hash,archive_hash,snapshot_hash,evidence_hash,authorization_hash,state,case when completed_at is not null then 1 else 0 end completed from apxgen_app_cleanup_attempts where organism_id=:organism',{organism:request.organismId});
  const legacy=await rows(db,"select event_id,state from apxgen_app_events where organism_id=:organism and state in('CLEANUP_STARTED','DISPOSED','CLEANUP_UNCERTAIN') order by event_id",{organism:request.organismId});
  const pending=(await rows(db,"select count(*) n from apxgen_app_organisms where application_id=:app and state not in('SELECTED','REJECTED')",{app:request.applicationId}))[0].N;
  const activeImports=(await rows(db,"select count(*) n from apxgen_app_import_attempts where application_id=:app and state='STARTED'",{app:request.applicationId}))[0].N;
  const identity={schema:policy.schema,sessionUser:policy.schema,workspace:mappings[0].WORKSPACE_NAME,workspaceId:mappings[0].WORKSPACE_ID};assertSandboxIdentity(policy,identity);
  return {identity,application:app?{applicationId:app.APPLICATION_ID,workspace:app.WORKSPACE,schema:app.OWNER}:null,
    slot:slot?{applicationId:slot.APPLICATION_ID,workspaceId:slot.WORKSPACE_ID,runId:slot.OWNER_RUN_ID,organismId:slot.OWNER_ORGANISM_ID,state:slot.SLOT_STATE,leaseCurrent:slot.LEASE_CURRENT===1}:null,
    run:run?{runId:run.RUN_ID,state:run.STATE,bestOrganismId:run.BEST_ORGANISM_ID,currentGeneration:run.CURRENT_GENERATION,materializations:run.MATERIALIZATIONS,materializationBudget:run.MATERIALIZATION_BUDGET}:null,
    organism:organism?{organismId:organism.ORGANISM_ID,runId:organism.RUN_ID,applicationId:organism.APPLICATION_ID,genome:JSON.parse(organism.GENOME_JSON),genomeHash:organism.GENOME_HASH,artifactHash:organism.ARTIFACT_HASH,state:organism.STATE}:null,
    attempts:imports.map(row=>({attemptId:row.ATTEMPT_ID,organismId:row.ORGANISM_ID,runId:row.RUN_ID,applicationId:row.APPLICATION_ID,definitionHash:row.DEFINITION_HASH,state:row.STATE,completed:row.COMPLETED===1})),
    activity:{browserStopped:quiescence.browserStopped,pendingEvaluations:pending,activeEvaluationLeases:quiescence.activeEvaluationLeases,activeBrowserLeases:quiescence.activeBrowserLeases,activeImportLeases:activeImports},
    cleanupAttempts:[...attempts.map(row=>({attemptId:row.ATTEMPT_ID,organismId:row.ORGANISM_ID,runId:row.RUN_ID,applicationId:row.APPLICATION_ID,genomeHash:row.GENOME_HASH,definitionHash:row.ARTIFACT_HASH,policyHash:row.POLICY_HASH,archiveManifestSha256:row.ARCHIVE_HASH,snapshotManifestSha256:row.SNAPSHOT_HASH,evidenceManifestSha256:row.EVIDENCE_HASH,authorizationHash:row.AUTHORIZATION_HASH,state:row.STATE,completed:row.COMPLETED===1})),...legacy.map(row=>({source:'legacy-event',eventId:row.EVENT_ID,state:row.STATE}))],
    locks:{slotTableExclusive:true,runRow:Boolean(run),organismRow:Boolean(organism),slotRow:Boolean(slot)}};
}

const fixtureRows=(db,app,other=false)=>rows(db,`select o.*,to_char(sys_extract_utc(updated_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') updated_at_exact from genesis_orders o where application_id${other?'<>':'='}:app order by application_id,order_id`,{app});
const registryRows=(db,app,other=false)=>rows(db,`select s.*,to_char(sys_extract_utc(lease_until),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') lease_until_exact,to_char(sys_extract_utc(registered_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') registered_at_exact from genesis_order_lab_slots s where application_id${other?'<>':'='}:app order by application_id`,{app});
async function otherCanaries(db,app){return {applications:await rows(db,'select a.* from apex_applications a where application_id<>:app order by application_id',{app}),registry:await registryRows(db,app,true),orders:await fixtureRows(db,app,true)};}
async function privateDestination(privateRoot,path){check(typeof path==='string'&&isAbsolute(path),'Explicit absolute new private evidence directory required');const parent=await realpath(dirname(resolve(path))),target=join(parent,resolve(path).slice(dirname(resolve(path)).length+1));check(target.startsWith(privateRoot+sep),'Recycling evidence must remain under its private configuration root');return target;}

async function context({configPath,approval,request,originalCandidateDir,quiescenceAttestation,workerLockPath},connect=options=>oracledb.getConnection(options)){
  const path=resolve(configPath),config=await json(path);keys(config,['oracleConfigPath','sandboxPolicyPath','sqlclPath'],'explicit worker configuration');
  const policyPath=resolve(dirname(path),config.sandboxPolicyPath),policy=await json(policyPath);assertTerminalRecycleApproval(policy,approval,request);
  const oracle=await json(resolve(dirname(path),config.oracleConfigPath));check(oracle.user===policy.schema&&oracle.workspace===policy.workspace&&typeof oracle.password==='string'&&oracle.password.length>0&&typeof oracle.connectString==='string','Worker credentials differ from explicit owner/workspace');
  const privateRoot=await realDirectory(dirname(path)),original=await realDirectory(originalCandidateDir),runEvidencePath=join(dirname(original),'run-evidence.json'),runBytes=await readFile(runEvidencePath),run=JSON.parse(runBytes.toString('utf8'));
  check(inside(privateRoot,original)&&run.runId===request.runId&&['COMPLETE','FAILED','CANCELLED'].includes(run.oracleRun?.STATE)&&run.candidates?.some(candidate=>candidate.organismId===request.organismId&&candidate.applicationId===request.applicationId),'Original terminal run evidence and exact private candidate required');
  assertRecycleQuiescence(quiescenceAttestation,request,{runEvidenceSha256:sha(runBytes)});
  check(typeof workerLockPath==='string'&&isAbsolute(workerLockPath),'An explicit shared absolute owned-worker lock path is required');
  const lockPath=await coordinatorLockPath(path);check(resolve(workerLockPath)===lockPath&&inside(privateRoot,lockPath),'The canonical shared coordinator lock path is required');
  const lease=await acquireCoordinatorLock(path);
  let db;
  const release=()=>releaseCoordinatorLock(lease);
  try{db=await connect({user:oracle.user,password:oracle.password,connectString:oracle.connectString});db.callTimeout=30000;await assertWorkerContext(db,policy,approval.expectedDatabase);}
  catch(error){await closeContext({db,release},error,undefined,true);throw error;}
  return {db,policy,policyPath,privateRoot,original,runBytes,quiescence:copy(quiescenceAttestation),release,configPath:path};
}

function oracleBackend(ctx,request,approval){
  const db=ctx.db,binds={app:request.applicationId,workspace:ctx.policy.workspaceId,run:request.runId,organism:request.organismId};
  return {
    observe:async()=>{assertRecycleQuiescence(ctx.quiescence,request,{runEvidenceSha256:sha(ctx.runBytes)});return observeLocked(db,ctx.policy,request,approval,ctx.quiescence);},
    currentPolicy:()=>json(ctx.policyPath),fixture:()=>fixtureRows(db,request.applicationId),canaries:()=>otherCanaries(db,request.applicationId),commit:()=>db.commit(),rollback:()=>db.rollback(),
    async startAttempt(attemptId,authorization){await db.execute(`insert into apxgen_app_cleanup_attempts(attempt_id,organism_id,run_id,application_id,genome_hash,artifact_hash,policy_hash,archive_hash,snapshot_hash,evidence_hash,authorization_hash,state)
      values(:attempt,:organism,:run,:app,:genome,:artifact,:policy,:archive,:snapshot,:evidence,:authorization,'STARTED')`,{attempt:attemptId,organism:request.organismId,run:request.runId,app:request.applicationId,genome:request.genomeHash,artifact:request.definitionHash,policy:authorization.policyHash,archive:authorization.archiveManifestSha256,snapshot:authorization.snapshotManifestSha256,evidence:authorization.evidenceManifestSha256,authorization:recyclingAuthorizationHash(authorization)});},
    async removeApplication(){await db.execute('begin apex_application_install.set_workspace(:workspace);apex_application_install.set_keep_sessions(false);apex_application_install.remove_application(:app);end;',{workspace:ctx.policy.workspace,app:request.applicationId});},
    async deleteOwnedRows(){const orders=await db.execute("delete from genesis_orders where application_id=:app and exists(select 1 from genesis_order_lab_slots where application_id=:app and workspace_id=:workspace and owner_run_id=:run and owner_organism_id=:organism and slot_state='RELEASED' and lease_until<=systimestamp)",binds);const slots=await db.execute("delete from genesis_order_lab_slots where application_id=:app and workspace_id=:workspace and owner_run_id=:run and owner_organism_id=:organism and slot_state='RELEASED' and lease_until<=systimestamp",binds);return {orders:orders.rowsAffected,slots:slots.rowsAffected};},
    async absence(){const found={};for(const [name,table]of [['applications','apex_applications'],['orders','genesis_orders'],['slots','genesis_order_lab_slots']])found[name]=(await rows(db,`select count(*) n from ${table} where application_id=:app`,{app:request.applicationId}))[0].N;return found;},
    async finishAttempt(attemptId,state,errorCode=null){check(['VERIFIED','UNCERTAIN'].includes(state),'Invalid cleanup final state');const result=await db.execute("update apxgen_app_cleanup_attempts set state=:state,completed_at=systimestamp,error_code=:error where attempt_id=:attempt and organism_id=:organism and run_id=:run and application_id=:app and state='STARTED'",{state,error:errorCode,attempt:attemptId,organism:request.organismId,run:request.runId,app:request.applicationId});check(result.rowsAffected===1,'Cleanup attempt already final or identity changed');},
    async recordEvent(state,detail){await db.execute('insert into apxgen_app_events(organism_id,state,detail) values(:organism,:state,:detail)',{organism:request.organismId,state,detail:JSON.stringify(detail)});}
  };
}

/** Phase 1: original bytes and full FF9 snapshots precede exact lease revocation.
 * This phase does not remove an application or any fixture/registry row.
 */
export async function prepareTerminalApplicationRecycle(options,{connect}={}){
  const pinned=copy(options),{request,approval}=pinned,ctx=await context(pinned,connect);
  let result,failure,evidenceDir;
  try{
    const observed=await observeLocked(ctx.db,ctx.policy,request,approval,ctx.quiescence);
    assertArchivePreparationObservation(ctx.policy,archiveRequest(request),{...observed,pendingEvaluations:observed.activity.pendingEvaluations});
    check(observed.run.bestOrganismId!==request.organismId,'The current incumbent is pinned');
    check(observed.organism.genomeHash===request.genomeHash&&sha(canonicalApplicationGenome(observed.organism.genome))===request.genomeHash,'Actual Oracle genome differs');
    check(observed.activity.browserStopped===true&&Object.entries(observed.activity).filter(([name])=>name!=='browserStopped').every(([,value])=>value===0)&&observed.cleanupAttempts.length===0,'Previous cleanup or active work blocks preparation');
    const preparationDir=await privateDestination(ctx.privateRoot,pinned.preparationDir);await mkdir(preparationDir);evidenceDir=preparationDir;
    const evidence=await preserveOriginalCandidateEvidence({originalCandidateDir:ctx.original,evidenceDir:join(preparationDir,'evidence'),request});
    const snapshotDir=join(preparationDir,'snapshot');await mkdir(snapshotDir);const files=[];
    const snapshotValues={
      'registry.json':await registryRows(ctx.db,request.applicationId),'orders.json':await fixtureRows(ctx.db,request.applicationId),
      'organism.json':await rows(ctx.db,'select * from apxgen_app_organisms where organism_id=:id',{id:request.organismId}),
      'run.json':await rows(ctx.db,'select * from apxgen_app_runs where run_id=:id',{id:request.runId}),
      'events.json':await rows(ctx.db,'select * from apxgen_app_events where organism_id=:id order by event_id',{id:request.organismId}),
      'import-attempts.json':await rows(ctx.db,'select * from apxgen_app_import_attempts where organism_id=:id',{id:request.organismId}),
      'canaries.json':await otherCanaries(ctx.db,request.applicationId),'original-run-evidence.json':JSON.parse(ctx.runBytes.toString('utf8')),'quiescence-attestation.json':ctx.quiescence
    };
    check(snapshotValues['registry.json'].length===1&&snapshotValues['orders.json'].length===40,'Complete exact registry and 40-row fixture snapshot required');
    for(const [path,value]of Object.entries(snapshotValues)){await save(join(snapshotDir,path),value);const bytes=await bytesAt(snapshotDir,path);files.push({path,sha256:sha(bytes),bytes:bytes.length});}
    const snapshot={kind:'owned-slot-pre-release-snapshot',request:archiveRequest(request),identity:observed.identity,files};await save(join(snapshotDir,'snapshot-manifest.json'),snapshot);const snapshotManifestSha256=sha(await bytesAt(snapshotDir,'snapshot-manifest.json'));
    for(const file of files)check(sha(await bytesAt(snapshotDir,file.path))===file.sha256,'Pre-release snapshot bytes changed');
    check(equal(await fixtureRows(ctx.db,request.applicationId),snapshotValues['orders.json'])&&equal(await otherCanaries(ctx.db,request.applicationId),snapshotValues['canaries.json']),'Fixture or other application changed before lease release');
    const preparation={kind:'terminal-application-recycle-preparation-1',request,approval,policyHash:policyHash(ctx.policy),originalCandidateDir:ctx.original,originalDefinitionPath:join(ctx.original,'definition/application'),snapshotDir,snapshotManifestSha256,...evidence};
    await save(join(preparationDir,'preparation-manifest.json'),preparation);const preparationManifestSha256=sha(await bytesAt(preparationDir,'preparation-manifest.json'));
    assertTerminalRecycleApproval(await json(ctx.policyPath),approval,request);
    const current=await observeLocked(ctx.db,ctx.policy,request,approval,ctx.quiescence);check(equal(current,observed),'Locked owner/run state changed before release');
    check(equal(await fixtureRows(ctx.db,request.applicationId),snapshotValues['orders.json'])&&equal(await otherCanaries(ctx.db,request.applicationId),snapshotValues['canaries.json']),'Fixture or canary changed immediately before lease release');
    if(current.slot.state==='ACTIVE'){
      const result=await ctx.db.execute("update genesis_order_lab_slots set slot_state='RELEASED',lease_until=systimestamp-interval '1' second where application_id=:app and workspace_id=:workspace and owner_run_id=:run and owner_organism_id=:organism and slot_state='ACTIVE'",{app:request.applicationId,workspace:ctx.policy.workspaceId,run:request.runId,organism:request.organismId});check(result.rowsAffected===1,'Exact old terminal slot was not released');
    }
    await oracleBackend(ctx,request,approval).recordEvent('SLOT_RELEASED',{applicationId:request.applicationId,snapshotSha256:snapshotManifestSha256});await ctx.db.commit();
    const released=await observeLocked(ctx.db,ctx.policy,request,approval,ctx.quiescence);check(released.slot.state==='RELEASED'&&released.slot.leaseCurrent===false,'Durable terminal slot release was not verified');
    result={released:true,applicationId:request.applicationId,preparationDir,preparationManifestSha256};await save(join(preparationDir,'release-result.json'),result);return result;
  }catch(error){failure=error;throw error;}finally{await closeContext(ctx,result||failure,evidenceDir,result?.released===true);}
}

/** Phase 2: archiveApplication performs a genuine SQLcl export; this wrapper
 * verifies the immutable preparation/archive then enters the guarded executor.
 */
export async function recycleTerminalApplication(options,{connect,archive=archiveApplication}={}){
  const pinned=copy(options),{request,approval}=pinned;
  const preparationDir=await realDirectory(pinned.preparationDir),bytes=await bytesAt(preparationDir,'preparation-manifest.json');check(hash(pinned.preparationManifestSha256)&&sha(bytes)===pinned.preparationManifestSha256,'Preparation manifest digest changed');const preparation=JSON.parse(bytes.toString('utf8'));
  check(preparation.kind==='terminal-application-recycle-preparation-1'&&equal(preparation.request,request)&&equal(preparation.approval,approval),'Preparation belongs to another explicit target');
  // Short-lived owner attestation and local shared lock are reacquired here;
  // callers cannot pass an ownAttempt or resume a saved cleanup invocation.
  const ctx=await context({...pinned,originalCandidateDir:preparation.originalCandidateDir},connect);
  let result,failure,evidenceDir;
  try{
    const archiveDir=await privateDestination(ctx.privateRoot,pinned.archiveDir),cleanupDir=await privateDestination(ctx.privateRoot,pinned.cleanupDir);evidenceDir=cleanupDir;
    let archived;
    try{
      const observed=await observeLocked(ctx.db,ctx.policy,request,approval,ctx.quiescence);check(['COMPLETE','FAILED','CANCELLED'].includes(observed.run?.state)&&observed.run.bestOrganismId!==request.organismId&&observed.cleanupAttempts.length===0,'Terminal nonincumbent with no prior cleanup required');
      await ctx.db.rollback(); // Release row/table locks before archive's own connection.
      archived=await archive({configPath:ctx.configPath,definitionPath:preparation.originalDefinitionPath,evidenceDir:archiveDir,request:archiveRequest(request)});
    }catch{fail('Actual immutable SQL archive failed; retain its evidence and do not remove the application');}
    const preservation={archiveDir,archiveManifestSha256:archived.manifestSha256,snapshotDir:preparation.snapshotDir,snapshotManifestSha256:preparation.snapshotManifestSha256,originalDefinitionPath:preparation.originalDefinitionPath,evidenceDir:preparation.evidenceDir,evidenceManifestSha256:preparation.evidenceManifestSha256};
    result=await executeTerminalRecycle({policy:ctx.policy,request,approval,preservation,cleanupDir,backend:oracleBackend(ctx,request,approval)});return result;
  }catch(error){failure=error;throw error;}finally{await closeContext(ctx,result||failure,evidenceDir,result?.disposalVerified===true);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const [mode,optionsPath]=process.argv.slice(2);check(['prepare','dispose'].includes(mode)&&optionsPath,'Explicit prepare/dispose options file required');const options=await json(resolve(optionsPath));check(!Object.hasOwn(options,'ownAttempt'),'A saved cleanup attempt can never resume');console.log(JSON.stringify(await(mode==='prepare'?prepareTerminalApplicationRecycle(options):recycleTerminalApplication(options))));}
  catch(error){console.error(error instanceof TypeError?error.message:'Terminal application recycling failed; preserve private evidence and inspect its audit');process.exitCode=1;}
}
