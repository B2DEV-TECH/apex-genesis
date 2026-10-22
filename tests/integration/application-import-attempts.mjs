// Rollback-only audit-ledger checks. No import, application or fixture mutation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import oracledb from 'oracledb';
const configPath=process.env.APXGEN_APPLICATION_TEST_CONFIG;
if(!configPath)console.log(JSON.stringify({skipped:true,reason:'Explicit application sandbox configuration required'}));
else await verifyAttempts();

async function verifyAttempts(){
 let cfg;
 try{cfg=JSON.parse((await readFile(configPath,'utf8')).replace(/^\uFEFF/,''));}
 catch{throw new TypeError('Application sandbox configuration could not be read as JSON');}
 assert.equal(cfg.user,'APXGEN_ORDER_LAB');assert.equal(cfg.sandbox.schema,cfg.user);
 assert.equal(cfg.sandbox.enabled,true);assert.ok(cfg.sandbox.applicationIds.includes(132));
 const args={user:cfg.user,password:cfg.password,connectString:cfg.connectString};
 const parent=await oracledb.getConnection(args);let audit;let checks=0;
 const textOut=()=>({dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32767});
 const id=()=>randomUUID().replaceAll('-','');
 const attempt=id();
 try{
  audit=await oracledb.getConnection(args);audit.callTimeout=5000;
  for(const db of [parent,audit]){
   const identity=(await db.execute("select user,sys_context('USERENV','CURRENT_SCHEMA') from dual")).rows[0];
   assert.deepEqual(identity,[cfg.user,cfg.user]);
   const map=(await db.execute('select workspace_name,workspace_id from apex_workspace_schemas where schema=:schema',{schema:cfg.user})).rows;
   assert.ok(map.some(([workspace,workspaceId])=>workspace===cfg.sandbox.workspace&&workspaceId===cfg.sandbox.workspaceId));
  }checks++;
  const run=(await parent.execute("begin :id:=apxgen_app_evolution.create_run(50000,1,1,'TEST import audit boundary; never imported');end;",{id:textOut()})).outBinds.id;
  const organism=(await parent.execute('select organism_id from apxgen_app_organisms where run_id=:run for update nowait',{run})).rows[0][0];
  await parent.execute('select run_id from apxgen_app_runs where run_id=:run for update nowait',{run});
  // The real importer holds these locks while another connection writes audit.
  await parent.execute('lock table genesis_order_lab_slots in exclusive mode nowait');
  const insert=(values={})=>audit.execute("insert into apxgen_app_import_attempts(attempt_id,organism_id,run_id,application_id,definition_hash,state) values(:attempt,:organism,:run,:app,:hash,'STARTED')",{attempt,organism,run,app:132,hash:'1'.repeat(64),...values},{autoCommit:false});
  await insert();checks++;
  await assert.rejects(()=>insert({attempt:id()}),e=>e.errorNum===1);checks++;
  for(const sql of ["update apxgen_app_import_attempts set application_id=133 where attempt_id=:attempt","update apxgen_app_import_attempts set organism_id=organism_id where attempt_id=:attempt","update apxgen_app_import_attempts set state='STARTED' where attempt_id=:attempt",'delete from apxgen_app_import_attempts where attempt_id=:attempt']){
   await assert.rejects(()=>audit.execute(sql,{attempt}),e=>e.errorNum===20134);checks++;
  }
  await audit.execute("update apxgen_app_import_attempts set state='VERIFIED',completed_at=systimestamp where attempt_id=:attempt",{attempt});checks++;
  await assert.rejects(()=>audit.execute("update apxgen_app_import_attempts set state='FAILED',error_code='IMPORT_FAILED',completed_at=systimestamp where attempt_id=:attempt",{attempt}),e=>e.errorNum===20134);checks++;
  await audit.rollback();
  await assert.rejects(()=>audit.execute("insert into apxgen_app_import_attempts(attempt_id,organism_id,run_id,application_id,definition_hash,state,completed_at) values(:attempt,:organism,:run,132,:hash,'VERIFIED',systimestamp)",{attempt,organism,run,hash:'1'.repeat(64)}),e=>e.errorNum===20134);checks++;
  await insert();
  await audit.execute("update apxgen_app_import_attempts set state='UNCERTAIN',completed_at=systimestamp,error_code='SQLCL_TIMED_OUT' where attempt_id=:attempt",{attempt});checks++;
  await assert.rejects(()=>insert({attempt:id()}),e=>e.errorNum===1);checks++;
  await audit.rollback();await parent.rollback();
  assert.equal((await audit.execute('select count(*) from apxgen_app_import_attempts where attempt_id=:attempt',{attempt})).rows[0][0],0);checks++;
  console.log(JSON.stringify({suite:'application-import-attempts',checks,passed:true,rolledBack:true,parentLocksHeldDuringAudit:true,imports:0,paidRequests:0}));
 }finally{await audit?.rollback();await audit?.close();await parent.rollback();await parent.close();}
}
