// Explicit one-owner recycle operation. No file deletion and no automatic retry.
// Workspace API: https://docs.oracle.com/en/database/oracle/apex/26.1/aeapi/APEX_APPLICATION_INSTALL.REMOVE_APPLICATION-Procedure.html
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import oracledb from 'oracledb';
import {validateSandboxPolicy} from '../../runtime/application/sandbox.mjs';
import {hashApplicationDefinition} from './build-definition.mjs';
import {assertArchiveRequest,assertArchiveObservation,assertArchivePreparationObservation,assertArchivedRemovalObservation,observeArchiveState} from './archive-application.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=message=>{throw new TypeError(message);};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const safePath=value=>typeof value==='string'&&value.trim()&&!/[\x00-\x1f"]/.test(value);
const json=async path=>{try{return JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));}catch{fail('Private cleanup configuration or evidence is unreadable');}};
const comparable=value=>JSON.stringify(value);
const rows=async(db,sql,binds={})=>(await db.execute(sql,binds,{outFormat:oracledb.OUT_FORMAT_OBJECT,fetchTypeHandler:metadata=>metadata.dbType===oracledb.DB_TYPE_CLOB?{type:oracledb.STRING}:undefined})).rows;

export function assertCleanupAuthorization(policy,authorization,request){
 validateSandboxPolicy(policy);assertArchiveRequest(policy,request);
 const keys=['mode','schema','workspace','workspaceId','applicationIds','runId','organismId','definitionHash'];
 if(!authorization||Object.keys(authorization).length!==keys.length||!keys.every(key=>Object.hasOwn(authorization,key)))fail('Explicit complete cleanup authorization required');
 if(authorization.mode!=='DISPOSE_ARCHIVED_OWNED_APPLICATION'||authorization.schema!==policy.schema||authorization.workspace!==policy.workspace||authorization.workspaceId!==policy.workspaceId||!Array.isArray(authorization.applicationIds)||authorization.applicationIds.length!==1||authorization.applicationIds[0]!==130||request.applicationId!==130)fail('This cleanup authorization permits only the explicitly owned old application130');
 if(authorization.runId!==request.runId||authorization.organismId!==request.organismId||authorization.definitionHash!==request.definitionHash)fail('Cleanup authorization does not match the old durable ownership');
 return true;
}

async function verifyFiles(directory,manifest){
 const root=await realpath(directory);if((await lstat(directory)).isSymbolicLink())fail('Evidence roots cannot be symbolic links');
 if(!Array.isArray(manifest.files)||!manifest.files.length)fail('A nonempty evidence file manifest is required');
 const seen=new Set();
 for(const file of manifest.files){
  if(!file||typeof file.path!=='string'||file.path.includes('\\')||file.path.includes(':')||/[\x00-\x1f]/.test(file.path)||file.path.split('/').some(part=>!part||part==='.'||part==='..')||!hash(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<1||seen.has(file.path.toLowerCase()))fail('Evidence path, size or hash is invalid');
  seen.add(file.path.toLowerCase());let current=root;
  for(const part of file.path.split('/')){current=join(current,part);if((await lstat(current)).isSymbolicLink())fail('Evidence files cannot traverse symbolic links');}
  const actual=await realpath(current);if(!actual.startsWith(root+sep))fail('Evidence file escapes its root');
  const bytes=await readFile(actual);if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)fail('Preserved evidence bytes no longer match their manifest');
 }
 return root;
}

export async function verifyOwnedArchive({archiveDir,manifestSha256,request,originalDefinitionPath}){
 if(!safePath(archiveDir)||!safePath(originalDefinitionPath)||!hash(manifestSha256))fail('Explicit original definition and immutable archive digest required');
 const manifestBytes=await readFile(join(archiveDir,'archive-manifest.json'));
 if(sha(manifestBytes)!==manifestSha256)fail('Archive manifest changed after approval');
 const manifest=await json(join(archiveDir,'archive-manifest.json'));
 if(manifest.mode!=='ARCHIVE_ONLY'||manifest.archiveVerified!==true||manifest.cleanupPerformed!==false||comparable(manifest.request)!==comparable(request))fail('Archive proof is not bound to this exact old application');
 const root=await verifyFiles(archiveDir,manifest);
 if(!manifest.files.some(file=>file.path==='definition-manifest.json')||!manifest.files.some(file=>file.path===`sql/f${request.applicationId}.sql`))fail('Original definition and actual SQL export are both required');
 if((await hashApplicationDefinition(join(root,'definition'))).definitionHash!==request.definitionHash||(await hashApplicationDefinition(originalDefinitionPath)).definitionHash!==request.definitionHash)fail('Preserved or original definition differs from the recorded DNA');
 const originalManifest=await json(join(root,'definition-manifest.json'));if(originalManifest.definitionHash!==request.definitionHash)fail('Archived definition manifest is not the original artifact');
 const sql=await readFile(join(root,`sql/f${request.applicationId}.sql`));
 if(!sql.includes(Buffer.from('wwv_flow_imp.import_begin')))fail('Actual SQLcl SQL export is incomplete');
 return {archiveVerified:true,manifest,manifestSha256,archiveDir:root};
}

async function context(configPath,authorization,request){
 if(!safePath(configPath))fail('Explicit private worker configuration required');
 const path=resolve(configPath),config=await json(path),policy=await json(resolve(dirname(path),config.sandboxPolicyPath));
 assertCleanupAuthorization(policy,authorization,request);
 const oracle=await json(resolve(dirname(path),config.oracleConfigPath));
 if(oracle.user!==policy.schema||oracle.workspace!==policy.workspace)fail('Cleanup connection differs from the explicit owner/workspace');
 const db=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});
 db.callTimeout=30000;return {db,policy,privateRoot:await realpath(dirname(path))};
}
async function claimPrivateDirectory(privateRoot,path){
 if(!safePath(path))fail('Explicit new private evidence directory required');
 const parent=await realpath(dirname(resolve(path))),target=join(parent,resolve(path).slice(dirname(resolve(path)).length+1));
 if(!target.startsWith(privateRoot+sep))fail('Cleanup evidence must stay under the private configuration root');
 await mkdir(target);return target;
}
async function writeEvidence(path,value,files){const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');await writeFile(path,bytes,{flag:'wx'});files.push({path:path.slice(dirname(path).length+1),sha256:sha(bytes),bytes:bytes.length});}
async function event(db,organism,state,detail){await db.execute('insert into apxgen_app_events(organism_id,state,detail) values(:organism,:state,:detail)',{organism,state,detail:JSON.stringify(detail)});}
async function fixture(db,app){return rows(db,`select o.*,to_char(sys_extract_utc(updated_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') updated_at_exact from genesis_orders o where application_id=:app order by order_id`,{app});}
async function canaries(db){return {applications:await rows(db,'select application_id,workspace,owner,alias from apex_applications where application_id in(131,132) order by application_id'),orders:await rows(db,`select o.*,to_char(sys_extract_utc(updated_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') updated_at_exact from genesis_orders o where application_id in(131,132) order by application_id,order_id`)};}

export async function prepareOwnedSlotArchive({configPath,authorization,request,snapshotDir}){
 const {db,policy,privateRoot}=await context(configPath,authorization,request);
 try{
  const observed=await observeArchiveState(db,policy,request);assertArchivePreparationObservation(policy,request,observed);
  if(observed.run.state!=='FAILED'||observed.organism.state!=='REJECTED'||observed.attempts[0].state!=='VERIFIED')fail('Only the expressly authorized failed pre-runtime app may be released');
  const snapshot=await claimPrivateDirectory(privateRoot,snapshotDir),files=[];
  const registry=await rows(db,`select s.*,to_char(sys_extract_utc(lease_until),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') lease_until_exact,to_char(sys_extract_utc(registered_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') registered_at_exact from genesis_order_lab_slots s where application_id=:app`,{app:request.applicationId});
  const orders=await fixture(db,request.applicationId);if(registry.length!==1||orders.length!==40)fail('Complete owned registry and40-order fixture snapshot required');
  for(const [name,value]of [['registry',registry],['orders',orders],['organism',await rows(db,'select * from apxgen_app_organisms where organism_id=:id',{id:request.organismId})],['run',await rows(db,'select * from apxgen_app_runs where run_id=:id',{id:request.runId})],['events',await rows(db,'select * from apxgen_app_events where organism_id=:id order by event_id',{id:request.organismId})],['import-attempts',await rows(db,'select * from apxgen_app_import_attempts where organism_id=:id',{id:request.organismId})],['canaries',await canaries(db)]])await writeEvidence(join(snapshot,name+'.json'),value,files);
  const manifest={formatVersion:'1.0',kind:'owned-slot-pre-release-snapshot',request,identity:observed.identity,files,createdAt:new Date().toISOString()};
  await verifyFiles(snapshot,manifest);const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(join(snapshot,'snapshot-manifest.json'),bytes,{flag:'wx'});
  const released=await db.execute("update genesis_order_lab_slots set slot_state='RELEASED',lease_until=systimestamp-interval '1' second where application_id=:app and workspace_id=:workspace and owner_run_id=:run and owner_organism_id=:organism and slot_state='ACTIVE'",{app:request.applicationId,workspace:policy.workspaceId,run:request.runId,organism:request.organismId});
  if(released.rowsAffected!==1)fail('Expected exactly one old active slot to release');
  await event(db,request.organismId,'SLOT_RELEASED',{applicationId:request.applicationId,snapshotSha256:sha(bytes)});await db.commit();
  const result={released:true,applicationId:request.applicationId,snapshotDir:snapshot,snapshotManifestSha256:sha(bytes)};
  await writeFile(join(snapshot,'release-result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
 }finally{await db.rollback();await db.close();}
}

export async function disposeArchivedApplication({configPath,authorization,request,snapshotDir,snapshotManifestSha256,archiveDir,archiveManifestSha256,originalDefinitionPath,cleanupDir}){
 const archive=await verifyOwnedArchive({archiveDir,manifestSha256:archiveManifestSha256,request,originalDefinitionPath});
 const snapshotBytes=await readFile(join(snapshotDir,'snapshot-manifest.json'));if(!hash(snapshotManifestSha256)||sha(snapshotBytes)!==snapshotManifestSha256)fail('Pre-release snapshot manifest digest changed');
 const snapshot=await json(join(snapshotDir,'snapshot-manifest.json'));if(snapshot.kind!=='owned-slot-pre-release-snapshot'||comparable(snapshot.request)!==comparable(request))fail('Snapshot belongs to another owned application');
 await verifyFiles(snapshotDir,snapshot);
 const originalRegistry=await json(join(snapshotDir,'registry.json')),originalOrders=await json(join(snapshotDir,'orders.json'));
 if(originalRegistry.length!==1||originalRegistry[0].APPLICATION_ID!==130||originalRegistry[0].OWNER_RUN_ID!==request.runId||originalRegistry[0].OWNER_ORGANISM_ID!==request.organismId)fail('Preserved registry ownership differs from cleanup authorization');
 const {db,policy,privateRoot}=await context(configPath,authorization,request);let started=false,directory;
 const cleanupId=randomUUID().replaceAll('-',''),audit={cleanupId,applicationId:130,request,archiveManifestSha256,snapshotManifestSha256,disposalVerified:false,apiInvoked:false};
 try{
  const observed=await observeArchiveState(db,policy,request);assertArchiveObservation(policy,request,observed);
  if(observed.slot.state!=='RELEASED')fail('Old slot must remain explicitly released before removal');
  if((await rows(db,"select event_id from apxgen_app_events where organism_id=:id and state in('CLEANUP_STARTED','DISPOSED','CLEANUP_UNCERTAIN')",{id:request.organismId})).length)fail('A previous cleanup attempt exists; automatic retries are prohibited');
  assert.deepEqual(JSON.parse(comparable(await fixture(db,130))),originalOrders,'Owned fixture changed after preservation');
  const protectedBefore=await canaries(db);directory=await claimPrivateDirectory(privateRoot,cleanupDir);
  await event(db,request.organismId,'ARCHIVED',{cleanupId,applicationId:130,archiveSha256:archiveManifestSha256});
  await event(db,request.organismId,'CLEANUP_STARTED',{cleanupId,applicationId:130,archiveSha256:archiveManifestSha256});await db.commit();started=true;
  // Recheck after the durable attempt; Oracle's removal API may commit itself.
  assertArchiveObservation(policy,request,await observeArchiveState(db,policy,request));
  await verifyOwnedArchive({archiveDir:archive.archiveDir,manifestSha256:archiveManifestSha256,request,originalDefinitionPath});
  audit.apiInvoked=true;
  await db.execute('begin apex_application_install.set_workspace(:workspace);apex_application_install.set_keep_sessions(false);apex_application_install.remove_application(:app);end;',{workspace:policy.workspace,app:130});
  const after=await observeArchiveState(db,policy,request);assertArchivedRemovalObservation(policy,request,after);
  assert.deepEqual(JSON.parse(comparable(await fixture(db,130))),originalOrders,'Fixture changed during API removal');
  await verifyOwnedArchive({archiveDir:archive.archiveDir,manifestSha256:archiveManifestSha256,request,originalDefinitionPath});
  const removedOrders=await db.execute('delete from genesis_orders where application_id=:app',{app:130});
  const removedSlot=await db.execute("delete from genesis_order_lab_slots where application_id=:app and workspace_id=:workspace and owner_run_id=:run and owner_organism_id=:organism and slot_state='RELEASED' and lease_until<=systimestamp",{app:130,workspace:policy.workspaceId,run:request.runId,organism:request.organismId});
  if(removedOrders.rowsAffected!==originalOrders.length||removedSlot.rowsAffected!==1)fail('Only the exact old owned fixture and registry row may be removed');
  assert.deepEqual(await canaries(db),protectedBefore,'Canary applications or fixtures changed');
  await event(db,request.organismId,'DISPOSED',{cleanupId,applicationId:130,archiveSha256:archiveManifestSha256});await db.commit();
  for(const table of ['apex_applications','genesis_orders','genesis_order_lab_slots'])if((await rows(db,`select count(*) n from ${table} where application_id=:app`,{app:130}))[0].N!==0)fail('Final application/fixture/slot absence was not confirmed');
  audit.disposalVerified=true;audit.deletedFixtureRows=removedOrders.rowsAffected;audit.deletedRegistryRows=removedSlot.rowsAffected;audit.otherApplicationsUnchanged=true;audit.completedAt=new Date().toISOString();
  await writeFile(join(directory,'cleanup-result.json'),JSON.stringify(audit,null,2)+'\n',{flag:'wx'});return {...audit,cleanupDir:directory};
 }catch(error){
  await db.rollback();audit.failure=/^(ORA|NJS)-\d+$/.test(error.code||'')?error.code:error instanceof TypeError?error.message:'CLEANUP_INCOMPLETE';
  if(started){try{await event(db,request.organismId,'CLEANUP_UNCERTAIN',{cleanupId,applicationId:130,errorCode:'CLEANUP_INCOMPLETE'});await db.commit();}catch{await db.rollback();}}
  if(directory)await writeFile(join(directory,'cleanup-incomplete.json'),JSON.stringify(audit,null,2)+'\n',{flag:'wx'});
  fail('Cleanup incomplete; preserve audit and registry evidence; never retry automatically');
 }finally{await db.rollback();await db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const [mode,path]=process.argv.slice(2),options=await json(path);if(!['prepare','dispose'].includes(mode))fail('Explicit prepare or dispose mode required');console.log(JSON.stringify(await(mode==='prepare'?prepareOwnedSlotArchive(options):disposeArchivedApplication(options)),null,2));}
 catch(error){console.error(error instanceof TypeError?error.message:'Owned application cleanup failed; inspect private evidence');process.exitCode=1;}
}
