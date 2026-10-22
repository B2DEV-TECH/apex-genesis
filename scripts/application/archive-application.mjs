// Archive only: this module contains no application removal or fixture cleanup.
// API references: https://docs.oracle.com/en/database/oracle/apex/26.1/aeapi/GET_APPLICATION_Function.html
// APEX26.2 export behavior: https://docs.oracle.com/en/database/oracle/apex/26.2/htmrn/changed-behavior.html
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import oracledb from 'oracledb';
import {validateSandboxPolicy,assertSandboxIdentity} from '../../runtime/application/sandbox.mjs';
import {hashApplicationDefinition} from './build-definition.mjs';
import {executeSqlcl,fingerprintSqlcl} from './validate-definition.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const id=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const safePath=value=>typeof value==='string'&&value.trim()&&!/[\x00-\x1f"]/.test(value);
const reject=message=>{throw new TypeError(message);};
const inside=(root,path)=>path===root||path.startsWith(root+sep);
async function json(path){try{return JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));}catch{throw new TypeError('Archive configuration or manifest is unreadable');}}

export function assertArchiveRequest(policy,request){
 validateSandboxPolicy(policy);
 const keys=['mode','applicationId','runId','organismId','definitionHash'];
 if(!request||Object.keys(request).length!==keys.length||!keys.every(key=>Object.hasOwn(request,key)))reject('Explicit archive-only request required');
 if(request.mode!=='ARCHIVE_ONLY'||!Number.isSafeInteger(request.applicationId)||!policy.applicationIds.includes(request.applicationId)||[120,121,...policy.protectedApplicationIds].includes(request.applicationId))reject('Archive target or mode is outside the explicit disposable scope');
 if(!id(request.runId)||!id(request.organismId)||!hash(request.definitionHash))reject('Exact durable ownership and original definition hash required');
 return true;
}

function assertArchiveBoundary(policy,request,observed,{requireInactive=true,requireAbsent=false}={}){
 assertArchiveRequest(policy,request);assertSandboxIdentity(policy,observed?.identity);
 if(observed.identity.sessionUser!==policy.schema)reject('Archive session owner differs from the authorized parsing schema');
 const app=observed.application,slot=observed.slot,run=observed.run,organism=observed.organism;
 if(requireAbsent?app!==null:!app||app.applicationId!==request.applicationId||app.workspace!==policy.workspace||app.schema!==policy.schema)reject('Actual installed app differs from the expected archive/removal state');
 if(!slot||slot.applicationId!==request.applicationId||slot.workspaceId!==policy.workspaceId||slot.runId!==request.runId||slot.organismId!==request.organismId||!['ACTIVE','RELEASED'].includes(slot.state)||typeof slot.leaseCurrent!=='boolean'||(requireInactive&&slot.leaseCurrent!==false))reject('Exact durable slot ownership with the required lease state is required');
 if(!run||run.runId!==request.runId||!['COMPLETE','FAILED','CANCELLED'].includes(run.state))reject('Archive requires a terminal run');
 if(!organism||organism.organismId!==request.organismId||organism.runId!==request.runId||organism.applicationId!==request.applicationId||organism.artifactHash!==request.definitionHash||!['SELECTED','REJECTED'].includes(organism.state))reject('Archive requires the terminal candidate and its original artifact');
 if(observed.pendingEvaluations!==0||!Array.isArray(observed.attempts)||observed.attempts.length!==1)reject('Pending or ambiguous application work cannot be archived');
 const attempt=observed.attempts[0];
 if(attempt.organismId!==request.organismId||attempt.runId!==request.runId||attempt.applicationId!==request.applicationId||attempt.definitionHash!==request.definitionHash||!['VERIFIED','FAILED'].includes(attempt.state)||attempt.completed!==true)reject('A matching finalized unambiguous import audit is required');
 return true;
}
export function assertArchiveObservation(policy,request,observed){return assertArchiveBoundary(policy,request,observed);}
export function assertArchivePreparationObservation(policy,request,observed){return assertArchiveBoundary(policy,request,observed,{requireInactive:false});}
export function assertArchivedRemovalObservation(policy,request,observed){return assertArchiveBoundary(policy,request,observed,{requireAbsent:true});}

export async function observeArchiveState(db,policy,request){
 const rows=async(sql,binds={})=>(await db.execute(sql,binds,{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
 const c=(await rows("select sys_context('USERENV','CURRENT_SCHEMA') schema_name,sys_context('USERENV','SESSION_USER') session_user from dual"))[0];
 const mappings=await rows('select workspace_name,workspace_id from apex_workspace_schemas where schema=:schema and workspace_name=:workspace',{schema:policy.schema,workspace:policy.workspace});
 if(mappings.length!==1)reject('Exactly one configured owner/workspace mapping is required');
 const identity={schema:c.SCHEMA_NAME,sessionUser:c.SESSION_USER,workspace:mappings[0].WORKSPACE_NAME,workspaceId:mappings[0].WORKSPACE_ID};
 assertSandboxIdentity(policy,identity);if(identity.sessionUser!==policy.schema)reject('Archive session identity rejected');
 // Same lock order as import admission; fail rather than wait on active work.
 await db.execute('lock table genesis_order_lab_slots in exclusive mode nowait');
 const run=(await rows('select run_id,state from apxgen_app_runs where run_id=:run for update nowait',{run:request.runId}))[0];
 const organism=(await rows('select organism_id,run_id,application_id,artifact_hash,state from apxgen_app_organisms where organism_id=:organism for update nowait',{organism:request.organismId}))[0];
 const slot=(await rows("select application_id,workspace_id,owner_run_id,owner_organism_id,slot_state,case when slot_state='ACTIVE' and lease_until>systimestamp then 1 else 0 end lease_current from genesis_order_lab_slots where application_id=:app for update nowait",{app:request.applicationId}))[0];
 const app=(await rows('select application_id,workspace,owner from apex_applications where application_id=:app',{app:request.applicationId}))[0];
 const attempts=await rows('select organism_id,run_id,application_id,definition_hash,state,case when completed_at is not null then 1 else 0 end completed from apxgen_app_import_attempts where organism_id=:organism',{organism:request.organismId});
 return {identity,application:app?{applicationId:app.APPLICATION_ID,workspace:app.WORKSPACE,schema:app.OWNER}:null,
  slot:slot?{applicationId:slot.APPLICATION_ID,workspaceId:slot.WORKSPACE_ID,runId:slot.OWNER_RUN_ID,organismId:slot.OWNER_ORGANISM_ID,state:slot.SLOT_STATE,leaseCurrent:slot.LEASE_CURRENT===1}:null,
  run:run?{runId:run.RUN_ID,state:run.STATE}:null,
  organism:organism?{organismId:organism.ORGANISM_ID,runId:organism.RUN_ID,applicationId:organism.APPLICATION_ID,artifactHash:organism.ARTIFACT_HASH,state:organism.STATE}:null,
  pendingEvaluations:(await rows("select count(*) n from apxgen_app_organisms where application_id=:app and state not in('SELECTED','REJECTED')",{app:request.applicationId}))[0].N,
  attempts:attempts.map(row=>({organismId:row.ORGANISM_ID,runId:row.RUN_ID,applicationId:row.APPLICATION_ID,definitionHash:row.DEFINITION_HASH,state:row.STATE,completed:row.COMPLETED===1}))};
}

export async function archiveApplication({configPath,definitionPath,evidenceDir,request,timeoutMs=120000}={}){
 if(![configPath,definitionPath,evidenceDir].every(safePath)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)reject('Explicit safe archive paths and bounded timeout required');
 const configurationPath=resolve(configPath),configuration=await json(configurationPath);
 if(Object.keys(configuration).length!==3||!['oracleConfigPath','sandboxPolicyPath','sqlclPath'].every(key=>safePath(configuration[key])))reject('Explicit archive worker configuration required');
 const policy=await json(resolve(dirname(configurationPath),configuration.sandboxPolicyPath));assertArchiveRequest(policy,request);
 const oracle=await json(resolve(dirname(configurationPath),configuration.oracleConfigPath));
 if(oracle.user!==policy.schema||oracle.workspace!==policy.workspace||typeof oracle.password!=='string'||!oracle.password.length||/[\x00-\x1f"]/.test(oracle.password)||typeof oracle.connectString!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/?=&%+-]*$/.test(oracle.connectString))reject('Archive connection differs from configured sandbox grammar');
 const original=await realpath(resolve(definitionPath));if((await lstat(resolve(definitionPath))).isSymbolicLink())reject('Original definition cannot be a symbolic link');
 const destination=resolve(evidenceDir);
 // Existing parent is intentional: resolve aliases before writing any archive.
 const actualParent=await realpath(dirname(destination));
 const actualDestination=join(actualParent,destination.slice(dirname(destination).length+1));
 if(inside(original,actualDestination)||inside(actualDestination,original))reject('Archive must be separate from the preserved original definition');
 const before=await hashApplicationDefinition(original);
 if(before.definitionHash!==request.definitionHash)reject('Original definition bytes differ from the durable import artifact');
 const sourceManifestPath=join(dirname(original),'definition-manifest.json'),sourceManifest=await readFile(sourceManifestPath);
 const parsedManifest=await json(sourceManifestPath);
 if(parsedManifest.definitionHash!==request.definitionHash||JSON.stringify(parsedManifest.files)!==JSON.stringify(before.files))reject('Original definition manifest differs from the supplied source');
 const sqlclPath=resolve(dirname(configurationPath),configuration.sqlclPath),compiler=await fingerprintSqlcl(sqlclPath);
 let db,claimed=false;
 const evidence={formatVersion:'1.0',mode:'ARCHIVE_ONLY',archiveVerified:false,cleanupPerformed:false,request,observedAt:new Date().toISOString()};
 try{
  db=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});
  const observed=await observeArchiveState(db,policy,request);assertArchiveObservation(policy,request,observed);
  evidence.admission=observed;await mkdir(actualDestination);claimed=true;
  const files=[];
  for(const file of before.files){const bytes=await readFile(join(original,file.path));if(sha(bytes)!==file.sha256)reject('Original definition changed while being archived');const path='definition/'+file.path;await mkdir(dirname(join(actualDestination,path)),{recursive:true});await writeFile(join(actualDestination,path),bytes,{flag:'wx'});files.push({path,sha256:sha(bytes),bytes:bytes.length});}
  await writeFile(join(actualDestination,'definition-manifest.json'),sourceManifest,{flag:'wx'});files.push({path:'definition-manifest.json',sha256:sha(sourceManifest),bytes:sourceManifest.length});
  await mkdir(join(actualDestination,'sql'));const exportPath=join(actualDestination,'sql',`f${request.applicationId}.sql`);
  const sql=`prompt\nset echo off verify off feedback off heading off pagesize 0 linesize 32767 trimspool on\nset long 100000000 longchunksize 32767\nset define off\nwhenever sqlerror exit failure rollback\nconnect ${oracle.user}/"${oracle.password}"@${oracle.connectString}\ndeclare n number;begin if user<>'${policy.schema}' or sys_context('USERENV','CURRENT_SCHEMA')<>'${policy.schema}' then raise_application_error(-20135,'Archive identity rejected');end if;select count(*) into n from apex_workspace_schemas where schema='${policy.schema}' and workspace_name='${policy.workspace}' and workspace_id=${policy.workspaceId};if n<>1 then raise_application_error(-20135,'Archive workspace rejected');end if;select count(*) into n from apex_applications where application_id=${request.applicationId} and workspace='${policy.workspace}' and owner='${policy.schema}';if n<>1 then raise_application_error(-20135,'Archive application rejected');end if;apex_util.set_security_group_id(${policy.workspaceId});end;\n/\nvariable contents clob\ndeclare files apex_t_export_files;begin files:=apex_export.get_application(p_application_id=>${request.applicationId},p_type=>'SQL',p_split=>false,p_with_date=>false,p_with_supporting_objects=>'N',p_with_acl_assignments=>false);if files.count<>1 or files(1).contents is null then raise_application_error(-20135,'One actual SQL export required');end if;:contents:=files(1).contents;end;\n/\nspool "${exportPath.replaceAll('\\','/')}"\nprint contents\nspool off\nexit\n`;
  const result=await executeSqlcl(sqlclPath,['-thin','-nohistory','-noupdates','-S','/nolog'],{input:sql,timeoutMs});
  let output=result.stdout+result.stderr;for(const secret of [oracle.password,oracle.apexPassword,oracle.connectString])if(typeof secret==='string'&&secret.length)output=output.split(secret).join('[REDACTED]');
  evidence.sqlcl={exitCode:result.exitCode,timedOut:result.timedOut,spawnError:result.spawnError,outputSha256:sha(output),...compiler};
  if(result.exitCode!==0||result.timedOut||result.spawnError||/ORA-\d|SP2-\d|Error:/i.test(output))reject('Actual SQLcl archive export failed; retain the private failed attempt');
  const exported=await readFile(exportPath);
  if(!exported.length||exported.length>16*1024*1024||!exported.includes(Buffer.from('wwv_flow_imp.import_begin')))reject('Actual SQL export is missing, incomplete or too large');
  files.push({path:`sql/f${request.applicationId}.sql`,sha256:sha(exported),bytes:exported.length});
  const after=await hashApplicationDefinition(original);if(after.definitionHash!==before.definitionHash)reject('Original definition changed during export');
  const observedAfter=await observeArchiveState(db,policy,request);assertArchiveObservation(policy,request,observedAfter);
  for(const file of files)if(sha(await readFile(join(actualDestination,file.path)))!==file.sha256)reject('Archived bytes failed independent hash verification');
  evidence.files=files;evidence.archiveVerified=true;evidence.completedAt=new Date().toISOString();
  const manifest=Buffer.from(JSON.stringify(evidence,null,2)+'\n');await writeFile(join(actualDestination,'archive-manifest.json'),manifest,{flag:'wx'});
  return {archiveVerified:true,cleanupPerformed:false,evidenceDir:actualDestination,manifestSha256:sha(manifest),definitionHash:before.definitionHash,sqlExportSha256:sha(exported)};
 }catch(error){
  if(claimed){evidence.failure=/^(ORA|NJS)-\d+$/.test(error.code||'')?error.code:error instanceof TypeError?error.message:'ARCHIVE_FAILED';await writeFile(join(actualDestination,'archive-failure.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});}
  throw new TypeError('Application archive incomplete; preserve the new private evidence directory');
 }finally{await db?.rollback();await db?.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await archiveApplication(await json(process.argv[2])),null,2));}
 catch(error){console.error(error instanceof TypeError?error.message:'Archive failed; inspect private configuration');process.exitCode=1;}
}
