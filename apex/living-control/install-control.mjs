// Owner-authorized infrastructure installation only; never imports or allocates an app.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import oracledb from 'oracledb';
import {validateSandboxPolicy,assertSandboxIdentity} from '../../runtime/application/sandbox.mjs';
import {executeSqlcl,fingerprintSqlcl} from '../../scripts/application/validate-definition.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const privateRoot=join(root,'.local/order-lab');
const objects=['APXGEN_APP_CONTROL_CONFIG','APXGEN_APP_CONTROL_USERS','APXGEN_APP_CONTROL_REQUESTS','APXGEN_APP_CONTROL_EVENTS','APXGEN_APP_CONTROL','APXGEN_CONTROL_REQ_IMMUTABLE','APXGEN_CONTROL_EVT_IMMUTABLE'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const encode=value=>JSON.stringify(value,null,2)+'\n';
export function assertControlInstallation(policy,oracle,mode){
 validateSandboxPolicy(policy);
 assert.ok(['INSTALL_DISABLED_CONTROL','COMPLETE_PARTIAL_DISABLED_CONTROL','RECOMPILE_DISABLED_CONTROL'].includes(mode));
 assert.equal(oracle.user,'APXGEN_ORDER_LAB');assert.equal(oracle.workspace,'APXGEN_ORDER_LAB');
 assert.equal(oracle.connectString,'localhost:1521/FREEPDB1');assert.equal(policy.schema,oracle.user);assert.equal(policy.workspace,oracle.workspace);
 assert.deepEqual(policy.applicationIds,[130,131,132,133]);assert.deepEqual(policy.protectedApplicationIds,[120,121]);
 assert.ok(typeof oracle.password==='string'&&oracle.password&&!/[\r\n"]/.test(oracle.password));
 return true;
}
async function rows(db,sql,binds={}){return (await db.execute(sql,binds,{outFormat:oracledb.OUT_FORMAT_OBJECT,fetchTypeHandler:metadata=>metadata.dbType===oracledb.DB_TYPE_CLOB?{type:oracledb.STRING}:undefined})).rows;}
async function identity(db,policy){
 const observed=(await rows(db,"select user owner_name,sys_context('USERENV','SESSION_USER') session_user,sys_context('USERENV','CURRENT_SCHEMA') schema_name from dual"))[0];
 assert.equal(observed.OWNER_NAME,policy.schema);assert.equal(observed.SESSION_USER,policy.schema);
 const mapping=await rows(db,'select workspace_name,workspace_id from apex_workspace_schemas where schema=:owner and workspace_name=:workspace',{owner:policy.schema,workspace:policy.workspace});assert.equal(mapping.length,1);
 assertSandboxIdentity(policy,{schema:observed.SCHEMA_NAME,workspace:mapping[0].WORKSPACE_NAME,workspaceId:mapping[0].WORKSPACE_ID});
}
async function protectedApplications(){
 // These pre-existing project connections are read-only metadata observers.
 // No DDL, session attach or query of historical experiment tables is issued.
 const applications=[];
 for(const [file,owner,app] of [['oracle.json','APXGEN_LAB',120],['verify-oracle.json','APXGEN_VERIFY',121]]){
  const oracle=await json(resolve(root,'../../.local',file));assert.equal(oracle.user,owner);
  const observer=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});
  try{
   assert.deepEqual((await observer.execute("select user,sys_context('USERENV','CURRENT_SCHEMA') from dual")).rows[0],[owner,owner]);
   await observer.rollback();await observer.execute('set transaction read only');
   const found=await rows(observer,'select * from apex_applications where application_id=:app',{app});
   assert.equal(found.length,1);assert.equal(found[0].OWNER,owner);applications.push(found[0]);
  }finally{await observer.rollback();await observer.close();}
 }
 return applications;
}
async function snapshot(db){
 const applications=[...await protectedApplications(),...await rows(db,'select * from apex_applications where application_id in(130,131,132,133) order by application_id')];
 assert.deepEqual(applications.map(row=>row.APPLICATION_ID),[120,121,130,131,132,133],'All six existing app metadata records must be visible');
 const data={applications,
  orders:await rows(db,`select o.*,to_char(sys_extract_utc(updated_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') updated_at_exact from genesis_orders o order by application_id,order_id`),
  slots:await rows(db,`select s.*,to_char(sys_extract_utc(lease_until),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') lease_until_exact,to_char(sys_extract_utc(registered_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') registered_at_exact from genesis_order_lab_slots s order by application_id`),
  runs:await rows(db,`select r.*,to_char(sys_extract_utc(created_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') created_at_exact from apxgen_app_runs r order by run_id`),
  organisms:await rows(db,`select o.*,to_char(sys_extract_utc(created_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') created_at_exact from apxgen_app_organisms o order by organism_id`),
  events:await rows(db,`select e.*,to_char(sys_extract_utc(recorded_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') recorded_at_exact from apxgen_app_events e order by event_id`),
  attempts:await rows(db,`select a.*,to_char(sys_extract_utc(created_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') created_at_exact,to_char(sys_extract_utc(completed_at),'YYYY-MM-DD"T"HH24:MI:SS.FF9"Z"') completed_at_exact from apxgen_app_import_attempts a order by attempt_id`)};
 return {data,hashes:Object.fromEntries(Object.entries(data).map(([name,value])=>[name,digest(encode(value))]))};
}
export {snapshot as observeProtectedState};
async function disabled(db,partial=false){
 const config=await rows(db,'select * from apxgen_app_control_config');assert.equal(config.length,1);
 assert.equal(config[0].ENABLED,0);assert.equal(config[0].WORKER_ENABLED,0);
 for(const key of ['SCHEMA_NAME','WORKSPACE_ID','CONTROL_APPLICATION_ID','WORKER_BINDING','WORKER_SEEN_AT'])assert.equal(config[0][key],null);
 for(const table of partial?['apxgen_app_control_users']:['apxgen_app_control_users','apxgen_app_control_requests','apxgen_app_control_events'])assert.equal((await rows(db,'select count(*) n from '+table))[0].N,0);
 return {enabled:false,workerEnabled:false,roles:0,requests:0,events:0,applicationId:null};
}
export async function installControl({configPath,evidenceDir,mode}){
 assert.ok(typeof configPath==='string'&&typeof evidenceDir==='string');
 const workerPath=resolve(configPath),worker=await json(workerPath);
 assert.deepEqual(Object.keys(worker).sort(),['oracleConfigPath','sandboxPolicyPath','sqlclPath']);
 const policy=await json(resolve(dirname(workerPath),worker.sandboxPolicyPath)),oracle=await json(resolve(dirname(workerPath),worker.oracleConfigPath));
 assertControlInstallation(policy,oracle,mode);
 const evidence=resolve(evidenceDir);assert.ok(evidence.startsWith(privateRoot+sep),'Installation snapshots must stay in ignored private evidence');await mkdir(evidence);
 const sqlclPath=resolve(dirname(workerPath),worker.sqlclPath);assert.equal(sqlclPath.toLowerCase(),'c:\\sqlcl\\bin\\sql.exe');
 const compiler=await fingerprintSqlcl(sqlclPath);
 const db=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});
 try{
  await identity(db,policy);await db.rollback();await db.execute('set transaction read only');
  const before=await snapshot(db);await writeFile(join(evidence,'before-private.json'),encode(before),{flag:'wx'});
  const present=await rows(db,"select object_name,object_type,status from user_objects where object_name in ('"+objects.join("','")+"') order by object_name,object_type");
  if(mode==='INSTALL_DISABLED_CONTROL')assert.equal(present.length,0,'Same-name control objects already exist');
  else if(mode==='COMPLETE_PARTIAL_DISABLED_CONTROL'){
   assert.deepEqual(present,[{OBJECT_NAME:'APXGEN_APP_CONTROL_CONFIG',OBJECT_TYPE:'TABLE',STATUS:'VALID'},{OBJECT_NAME:'APXGEN_APP_CONTROL_USERS',OBJECT_TYPE:'TABLE',STATUS:'VALID'}]);await disabled(db,true);
  }else{assert.ok(present.length>=7);await disabled(db);}
  await db.rollback();
  const sqlPath=relative=>{const path=join(root,'apex/living-control',relative);assert.ok(!/[\x00-\x1f"]/.test(path));return '@"'+path+'"';};
  const commands=['prompt','set echo off verify off feedback off pagesize 100 linesize 200','whenever sqlerror exit failure rollback',
   'connect '+oracle.user+'/"'+oracle.password+'"@'+oracle.connectString,'set define off',
   'declare n number;begin',
   "if user<>'APXGEN_ORDER_LAB' or sys_context('USERENV','SESSION_USER')<>'APXGEN_ORDER_LAB' or sys_context('USERENV','CURRENT_SCHEMA')<>'APXGEN_ORDER_LAB' then raise_application_error(-20140,'Control installer owner rejected');end if;",
   "select count(*) into n from apex_workspace_schemas where schema='APXGEN_ORDER_LAB' and workspace_name='APXGEN_ORDER_LAB' and workspace_id="+policy.workspaceId+';',
   "if n<>1 then raise_application_error(-20140,'Control installer workspace rejected');end if;end;",'/'];
  if(mode==='INSTALL_DISABLED_CONTROL')commands.push(sqlPath('sql/010_control_queue.sql'));
  if(mode==='COMPLETE_PARTIAL_DISABLED_CONTROL'){
   commands.push('declare n number;begin',
    "select count(*) into n from user_objects where object_name in ('"+objects.join("','")+"');if n<>2 then raise_application_error(-20140,'Partial control object set changed');end if;",
    "select count(*) into n from apxgen_app_control_config where config_id=1 and enabled=0 and worker_enabled=0 and schema_name is null and workspace_id is null and control_application_id is null and worker_binding is null and worker_seen_at is null;if n<>1 then raise_application_error(-20140,'Partial control config changed');end if;",
    "select count(*) into n from apxgen_app_control_users;if n<>0 then raise_application_error(-20140,'Partial control users changed');end if;end;",'/');
   const source=await readFile(join(root,'apex/living-control/sql/010_control_queue.sql'),'utf8');
   const position=source.indexOf('create table apxgen_app_control_requests (');assert.ok(position>0);commands.push(source.slice(position));
  }
  commands.push(sqlPath('sql/apxgen_app_control.sql'),"select name,type,line,position,text from user_errors where name in('APXGEN_APP_CONTROL','APXGEN_CONTROL_REQ_IMMUTABLE','APXGEN_CONTROL_EVT_IMMUTABLE') order by name,sequence;",'exit');
  const result=await executeSqlcl(sqlclPath,['-thin','-nohistory','-noupdates','-S','/nolog'],{input:commands.join('\n')+'\n',timeoutMs:120000});
  let safeOutput=result.stdout+result.stderr;for(const value of [oracle.password,oracle.apexPassword])if(typeof value==='string'&&value)safeOutput=safeOutput.replaceAll(value,'[REDACTED]');
  await writeFile(join(evidence,'sqlcl-sanitized.log'),safeOutput,{flag:'wx'});
  const errors=await rows(db,"select name,type,line,position,text from user_errors where name in('APXGEN_APP_CONTROL','APXGEN_CONTROL_REQ_IMMUTABLE','APXGEN_CONTROL_EVT_IMMUTABLE') order by name,sequence");
  await writeFile(join(evidence,'user-errors.json'),encode(errors),{flag:'wx'});
  const after=await snapshot(db);await writeFile(join(evidence,'after-private.json'),encode(after),{flag:'wx'});assert.deepEqual(after.hashes,before.hashes,'Existing app metadata, fixture, ownership or history changed');
  assert.equal(result.spawnError,null);assert.equal(result.timedOut,false);assert.equal(result.exitCode,0);
  assert.ok(!/ORA-\d|SP2-\d|Unknown Command/i.test(safeOutput),'SQLcl installation failed; inspect sanitized private evidence');assert.equal(errors.length,0,'Control compilation errors; inspect USER_ERRORS');
  const state=await disabled(db);await writeFile(join(evidence,'disabled-config.json'),encode(state),{flag:'wx'});
  const installed=await rows(db,"select object_name,object_type,status from user_objects where object_name in ('"+objects.join("','")+"') order by object_name,object_type");assert.ok(installed.length>=8);assert.ok(installed.every(value=>value.STATUS==='VALID'));
  const report={mode,installed:true,enabled:false,workerBound:false,roles:0,applicationAllocated:false,appImports:0,paidRequests:0,compileErrors:0,existingStateUnchanged:true,beforeHashes:before.hashes,afterHashes:after.hashes,objects:installed,compiler,observedAt:new Date().toISOString()};
  await writeFile(join(evidence,'installation-result.json'),encode(report),{flag:'wx'});return report;
 }finally{await db.rollback();await db.close();}
}
export async function verifyControlPreservation({configPath,baselinePath,evidencePath}){
 const workerPath=resolve(configPath),worker=await json(workerPath);
 const policy=await json(resolve(dirname(workerPath),worker.sandboxPolicyPath)),oracle=await json(resolve(dirname(workerPath),worker.oracleConfigPath));
 assertControlInstallation(policy,oracle,'RECOMPILE_DISABLED_CONTROL');
 for(const file of [baselinePath,evidencePath])assert.ok(resolve(file).startsWith(privateRoot+sep));
 const baseline=await json(baselinePath),db=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});
 try{
  await identity(db,policy);await db.rollback();await db.execute('set transaction read only');
  const current=await snapshot(db);assert.deepEqual(current.hashes,baseline.hashes);
  const state=await disabled(db);
  const errors=await rows(db,"select name,type,line,position,text from user_errors where name in('APXGEN_APP_CONTROL','APXGEN_CONTROL_REQ_IMMUTABLE','APXGEN_CONTROL_EVT_IMMUTABLE') order by name,sequence");assert.equal(errors.length,0);
  const report={existingStateUnchanged:true,compileErrors:0,...state,beforeHashes:baseline.hashes,afterHashes:current.hashes,observedAt:new Date().toISOString()};
  await writeFile(evidencePath,encode(report),{flag:'wx'});return report;
 }finally{await db.rollback();await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const [mode,configPath,evidenceDir]=process.argv.slice(2);const result=await installControl({mode,configPath,evidenceDir});console.log(JSON.stringify({installed:result.installed,enabled:result.enabled,workerBound:result.workerBound,compileErrors:result.compileErrors,existingStateUnchanged:result.existingStateUnchanged,evidenceDir:resolve(evidenceDir)}));}catch{console.error('Control installation failed; preserve its private sanitized evidence. No automatic retry or app import was performed.');process.exitCode=1;}}
