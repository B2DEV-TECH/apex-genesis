// Create-only native infrastructure import, separate from organism materialization.
// No SYS import, experiment lineage, slot registry row, role or worker is created.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import oracledb from 'oracledb';
import {hashApplicationDefinition} from '../../scripts/application/build-definition.mjs';
import {assertCompilerBinding,sanitizeImportOutput} from '../../scripts/application/import-definition.mjs';
import {executeSqlcl,fingerprintSqlcl} from '../../scripts/application/validate-definition.mjs';
import {observeProtectedState} from './install-control.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),privateRoot=join(root,'.local/order-lab');
const protectedIds=[120,121,130,131,132,133],sha=/^[a-f0-9]{64}$/;
const digest=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>JSON.stringify(value,null,2)+'\n';
const readJson=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const exact=(value,keys)=>assert.ok(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),'Exact control-only policy required');
export function assertControlImportPolicy(policy){
 exact(policy,['schemaVersion','purpose','enabled','schema','workspace','workspaceId','applicationId','alias','protectedApplicationIds','expectedDatabase','definitionHash','compilerEvidenceSha256','configEnabled','workerEnabled']);
 assert.equal(policy.schemaVersion,'1.0');assert.equal(policy.purpose,'NATIVE_CONTROL_CREATE_ONLY');assert.equal(policy.enabled,true);
 assert.equal(policy.schema,'APXGEN_ORDER_LAB');assert.equal(policy.workspace,'APXGEN_ORDER_LAB');
 assert.ok(Number.isSafeInteger(policy.workspaceId)&&policy.workspaceId>0);assert.equal(policy.applicationId,134);assert.equal(policy.alias,'GENESIS-LIVING-CONTROL');
 assert.deepEqual(policy.protectedApplicationIds,protectedIds);assert.equal(policy.configEnabled,false);assert.equal(policy.workerEnabled,false);
 exact(policy.expectedDatabase,['databaseName','containerName']);assert.equal(policy.expectedDatabase.databaseName,'FREEPDB1');assert.equal(policy.expectedDatabase.containerName,'FREEPDB1');
 assert.match(policy.definitionHash,sha);assert.match(policy.compilerEvidenceSha256,sha);return true;
}
export function parseGlobalControlObservation(result,policy){
 assertControlImportPolicy(policy);assert.equal(result.exitCode,0);assert.equal(result.timedOut,false);assert.equal(result.spawnError,null);
 const output=result.stdout+result.stderr;assert.ok(!/ORA-\d|SP2-\d|Error:|Unknown Command/i.test(output),'Global read-only preflight failed');
 const read=(name)=>{const matches=[...output.matchAll(new RegExp('^'+name+'=([^\\r\\n]+)\\s*$','gm'))];assert.equal(matches.length,1,'Exact global preflight result required');return matches[0][1].trim();};
 assert.equal(read('CONTROL_ID_134_COUNT'),'0','Create-only control target is already used globally');
 assert.equal(read('CONTROL_DB'),policy.expectedDatabase.databaseName);assert.equal(read('CONTROL_CONTAINER'),policy.expectedDatabase.containerName);
 return {count:0,databaseName:policy.expectedDatabase.databaseName,containerName:policy.expectedDatabase.containerName,readOnly:true,observedAt:new Date().toISOString(),outputSha256:digest(output)};
}
export function assertControlImportState(policy,state){
 assertControlImportPolicy(policy);
 for(const key of ['schema','workspace','workspaceId'])assert.equal(state[key],policy[key]);
 for(const key of ['databaseName','containerName'])assert.equal(state[key],policy.expectedDatabase[key]);
 assert.equal(state.applicationExists,false);assert.equal(state.enabled,false);assert.equal(state.workerEnabled,false);
 for(const key of ['roles','requests','events'])assert.equal(state[key],0);
 for(const key of ['registeredSchema','registeredWorkspaceId','registeredApplicationId','workerBinding'])assert.equal(state[key],null,'Existing configuration cannot be adopted');
 return true;
}
export async function claimControlImportAttempt(path,record){await writeFile(path,encode(record),{flag:'wx',flush:true});}
async function rows(db,sql,binds={}){return (await db.execute(sql,binds,{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;}
async function observe(db,policy,{lock=false}={}){
 const context=(await rows(db,"select user owner_name,sys_context('USERENV','SESSION_USER') session_user,sys_context('USERENV','CURRENT_SCHEMA') schema_name,sys_context('USERENV','DB_NAME') database_name,sys_context('USERENV','CON_NAME') container_name from dual"))[0];
 assert.equal(context.OWNER_NAME,policy.schema);assert.equal(context.SESSION_USER,policy.schema);assert.equal(context.SCHEMA_NAME,policy.schema);
 const mapping=await rows(db,'select workspace_name,workspace_id from apex_workspace_schemas where schema=:owner and workspace_name=:workspace',{owner:policy.schema,workspace:policy.workspace});assert.equal(mapping.length,1);
 const config=(await rows(db,'select * from apxgen_app_control_config where config_id=1'+(lock?' for update nowait':'')))[0];assert.ok(config);
 const state={schema:context.SCHEMA_NAME,workspace:mapping[0].WORKSPACE_NAME,workspaceId:mapping[0].WORKSPACE_ID,databaseName:context.DATABASE_NAME,containerName:context.CONTAINER_NAME,
  applicationExists:(await rows(db,'select application_id from apex_applications where application_id=134')).length!==0,
  enabled:config.ENABLED!==0,workerEnabled:config.WORKER_ENABLED!==0,registeredSchema:config.SCHEMA_NAME,registeredWorkspaceId:config.WORKSPACE_ID,registeredApplicationId:config.CONTROL_APPLICATION_ID,workerBinding:config.WORKER_BINDING,
  roles:(await rows(db,'select count(*) n from apxgen_app_control_users'))[0].N,requests:(await rows(db,'select count(*) n from apxgen_app_control_requests'))[0].N,events:(await rows(db,'select count(*) n from apxgen_app_control_events'))[0].N};
 assert.equal(config.WORKER_SEEN_AT,null);assert.equal(config.MAX_GENERATIONS,1);assert.equal(config.MAX_MATERIALIZATIONS,2);return state;
}
function reserved(policy,state,{applicationExists=false}={}){
 assert.equal(state.registeredSchema,policy.schema);assert.equal(state.registeredWorkspaceId,policy.workspaceId);assert.equal(state.registeredApplicationId,134);
 assertControlImportState(policy,{...state,applicationExists:false,registeredSchema:null,registeredWorkspaceId:null,registeredApplicationId:null});
 assert.equal(state.applicationExists,applicationExists);
}
async function globalPreflight(policy,path){
 // This fixed SYS script only switches this session's container and reads IDs.
 // Owner SQLcl below performs the import; no SYS DDL/API is present here.
 const input="set echo off verify off feedback off heading off pagesize 0 linesize 200\nwhenever sqlerror exit failure rollback\nalter session set container=FREEPDB1;\nset transaction read only;\nselect 'CONTROL_ID_134_COUNT='||count(*) from apex_applications where application_id=134;\nselect 'CONTROL_DB='||sys_context('USERENV','DB_NAME') from dual;\nselect 'CONTROL_CONTAINER='||sys_context('USERENV','CON_NAME') from dual;\nrollback;\nexit\n";
 const result=await executeSqlcl('sqlplus',['-L','-S','/ as sysdba'],{input,timeoutMs:30000});
 await writeFile(path,result.stdout+result.stderr,{flag:'wx'});return parseGlobalControlObservation(result,policy);
}
async function compilerAdmission(source,evidencePath,sqlclPath,policy){
 const bytes=await readFile(evidencePath),evidence=JSON.parse(bytes.toString('utf8')),current=await hashApplicationDefinition(source),output=await readFile(join(dirname(evidencePath),'compiler-output.txt'),'utf8'),fingerprint=await fingerprintSqlcl(sqlclPath);
 assert.equal(digest(bytes),policy.compilerEvidenceSha256);assert.equal(current.definitionHash,policy.definitionHash);
 assertCompilerBinding(evidence,current,{fingerprint,sqlclPath,output});return {current,fingerprint,compilerEvidenceSha256:digest(bytes),output};
}
export async function importNativeControl({workerConfigPath,policyPath,compilerEvidencePath,evidenceDir}={}){
 for(const value of [workerConfigPath,policyPath,compilerEvidencePath,evidenceDir])assert.ok(typeof value==='string'&&value&&!/[\x00-\x1f"]/.test(value));
 for(const path of [policyPath,compilerEvidencePath,evidenceDir])assert.ok(resolve(path).startsWith(privateRoot+sep),'Control evidence and policy must remain private');
 const workerPath=resolve(workerConfigPath),worker=await readJson(workerPath);exact(worker,['oracleConfigPath','sandboxPolicyPath','sqlclPath']);
 const policyBytes=await readFile(policyPath),policy=JSON.parse(policyBytes.toString('utf8'));assertControlImportPolicy(policy);
 const oracle=await readJson(resolve(dirname(workerPath),worker.oracleConfigPath));assert.equal(oracle.user,policy.schema);assert.equal(oracle.workspace,policy.workspace);assert.equal(oracle.connectString,'localhost:1521/FREEPDB1');
 assert.ok(typeof oracle.password==='string'&&oracle.password&&!/[\x00-\x1f"]/.test(oracle.password));
 const sqlclPath=resolve(dirname(workerPath),worker.sqlclPath),source=join(root,'apex/living-control/template');assert.equal(sqlclPath.toLowerCase(),'c:\\sqlcl\\bin\\sql.exe');
 const admitted=await compilerAdmission(source,resolve(compilerEvidencePath),sqlclPath,policy);
 const directory=resolve(evidenceDir);await mkdir(directory);const attemptId=randomUUID().replaceAll('-','');
 const record={kind:'native-control-import-attempt',attemptId,applicationId:134,schema:policy.schema,workspace:policy.workspace,workspaceId:policy.workspaceId,definitionHash:policy.definitionHash,compilerEvidenceSha256:policy.compilerEvidenceSha256,policySha256:digest(policyBytes),state:'RESERVED',createdAt:new Date().toISOString()};
 const result={kind:'native-control-infrastructure-import',attemptId,applicationId:134,importAttempted:false,importVerified:false,configEnabled:false,workerEnabled:false,roles:0,paidRequests:0,experimentLineage:false};
 const db=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});db.callTimeout=10000;let before,attemptRecorded=false,output='';
 try{
  assertControlImportState(policy,await observe(db,policy,{lock:true}));
  before=await observeProtectedState(db);await writeFile(join(directory,'before-private.json'),encode(before),{flag:'wx'});
  await globalPreflight(policy,join(directory,'global-preflight-initial.log'));
  const importedSource=join(directory,'application');await cp(source,importedSource,{recursive:true,force:false,errorOnExist:true});
  assert.equal((await hashApplicationDefinition(importedSource)).definitionHash,policy.definitionHash);
  await writeFile(join(directory,'compiler-validation.json'),await readFile(compilerEvidencePath),{flag:'wx'});await writeFile(join(directory,'compiler-output.txt'),admitted.output,{flag:'wx'});await writeFile(join(directory,'policy.json'),policyBytes,{flag:'wx'});
  await claimControlImportAttempt(join(privateRoot,'control-import-134-attempt.json'),record);attemptRecorded=true;
  await writeFile(join(directory,'0001-reserved.json'),encode(record),{flag:'wx',flush:true});
  const reservation=await db.execute("update apxgen_app_control_config set schema_name=:owner,workspace_id=:workspaceId,control_application_id=134 where config_id=1 and enabled=0 and worker_enabled=0 and schema_name is null and workspace_id is null and control_application_id is null and worker_binding is null and worker_seen_at is null",{owner:policy.schema,workspaceId:policy.workspaceId});assert.equal(reservation.rowsAffected,1);await db.commit();
  reserved(policy,await observe(db,policy,{lock:true}));
  await compilerAdmission(source,resolve(compilerEvidencePath),sqlclPath,policy);assert.equal((await hashApplicationDefinition(importedSource)).definitionHash,policy.definitionHash);
  await writeFile(join(directory,'0002-launch-started.json'),encode({...record,state:'STARTED',recordedAt:new Date().toISOString()}),{flag:'wx',flush:true});
  await globalPreflight(policy,join(directory,'global-preflight-immediate.log'));
  result.importAttempted=true;
  const launched=await executeSqlcl(sqlclPath,['-thin','-nohistory','-noupdates','-S','/nolog'],{timeoutMs:120000,input:
   `prompt\nset echo off verify off\nset define off\nwhenever sqlerror exit failure rollback\nconnect ${oracle.user}/"${oracle.password}"@${oracle.connectString}\ndeclare n number;begin\nif user<>'APXGEN_ORDER_LAB' or sys_context('USERENV','SESSION_USER')<>'APXGEN_ORDER_LAB' or sys_context('USERENV','CURRENT_SCHEMA')<>'APXGEN_ORDER_LAB' or sys_context('USERENV','CON_NAME')<>'FREEPDB1' then raise_application_error(-20140,'Control import owner rejected');end if;\nselect count(*) into n from apex_workspace_schemas where schema='APXGEN_ORDER_LAB' and workspace_name='APXGEN_ORDER_LAB' and workspace_id=${policy.workspaceId};if n<>1 then raise_application_error(-20140,'Control workspace rejected');end if;\nselect count(*) into n from apex_applications where application_id=134;if n<>0 then raise_application_error(-20140,'Control target already exists');end if;\nselect count(*) into n from apxgen_app_control_config where config_id=1 and enabled=0 and worker_enabled=0 and schema_name='APXGEN_ORDER_LAB' and workspace_id=${policy.workspaceId} and control_application_id=134 and worker_binding is null and worker_seen_at is null;if n<>1 then raise_application_error(-20140,'Disabled control reservation rejected');end if;end;\n/\napex import -input "${importedSource.replaceAll('\\','/')}" -workspace APXGEN_ORDER_LAB -schema APXGEN_ORDER_LAB -id 134 -alias GENESIS-LIVING-CONTROL\nexit\n`});
  output=sanitizeImportOutput(launched.stdout+launched.stderr,{password:oracle.password,apexPassword:oracle.apexPassword,connectString:oracle.connectString});
  await writeFile(join(directory,'import-output.txt'),output,{flag:'wx'});
  result.processExitCode=launched.exitCode;result.processTimedOut=launched.timedOut;
  const metadata=await rows(db,'select application_id,workspace,owner,alias from apex_applications where application_id=134');
  assert.deepEqual(metadata,[{APPLICATION_ID:134,WORKSPACE:policy.workspace,OWNER:policy.schema,ALIAS:policy.alias}]);
  reserved(policy,await observe(db,policy),{applicationExists:true});
  const after=await observeProtectedState(db);await writeFile(join(directory,'after-private.json'),encode(after),{flag:'wx'});assert.deepEqual(after.hashes,before.hashes,'Protected app metadata, fixture or history changed');
  assert.equal((await hashApplicationDefinition(importedSource)).definitionHash,policy.definitionHash);await compilerAdmission(source,resolve(compilerEvidencePath),sqlclPath,policy);
  const target=output.match(/Importing application ID:\s*(\d+)\s+into workspace:\s*(\S+)/i);
  assert.equal(launched.spawnError,null);assert.equal(launched.timedOut,false);assert.equal(launched.exitCode,0);assert.match(output,/^\s*Import successful\.\s*$/m);assert.ok(!/Compile Errors|Error:|ORA-\d|SP2-\d/i.test(output));assert.equal(Number(target?.[1]),134);assert.equal(target?.[2],policy.workspace);
  result.importVerified=true;result.existingStateUnchanged=true;result.metadata=metadata[0];result.beforeHashes=before.hashes;result.afterHashes=after.hashes;
 }catch(error){result.failure=/^(ORA|NJS)-\d+$/.test(error.code||'')?error.code:'CONTROL_IMPORT_UNCERTAIN';}
 finally{
  try{await db.rollback();}catch{result.importVerified=false;result.failure='CONTROL_GUARD_RELEASE_UNCERTAIN';}
  try{await db.close();}catch{result.importVerified=false;result.failure='CONTROL_CONNECTION_CLOSE_UNCERTAIN';}
  result.outputSha256=digest(output);result.state=result.importVerified?'VERIFIED':attemptRecorded?'UNCERTAIN':'ADMISSION_REJECTED';result.observedAt=new Date().toISOString();
  await writeFile(join(directory,'0003-result.json'),encode(result),{flag:'wx',flush:true});
 }
 return {...result,evidenceDir:directory};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const [workerConfigPath,policyPath,compilerEvidencePath,evidenceDir]=process.argv.slice(2);const result=await importNativeControl({workerConfigPath,policyPath,compilerEvidencePath,evidenceDir});console.log(JSON.stringify({applicationId:result.applicationId,importAttempted:result.importAttempted,importVerified:result.importVerified,configEnabled:result.configEnabled,workerEnabled:result.workerEnabled,existingStateUnchanged:result.existingStateUnchanged,evidenceDir:result.evidenceDir}));if(!result.importVerified)process.exitCode=1;}catch{console.error('Native control import refused; preserve private attempt evidence. Automatic retry is prohibited.');process.exitCode=1;}}
