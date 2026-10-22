// TEST_ONLY: real Oracle query semantics using rollback-only synthetic rows.
// This is not an authenticated worker, browser, import or evolution experiment.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import oracledb from 'oracledb';
import {verifyQueuedImportLease} from '../../../runtime/application/queue-import-guard.mjs';
const configPath=process.env.APXGEN_CONTROL_TEST_CONFIG;
if(!configPath)console.log(JSON.stringify({suite:'native-queue-import-query',testOnly:true,skipped:true,reason:'Explicit APXGEN_CONTROL_TEST_CONFIG required; no connection made'}));
else await run();
async function run(){
 const cfg=JSON.parse((await readFile(configPath,'utf8')).replace(/^\uFEFF/,''));
 assert.equal(cfg.user,'APXGEN_ORDER_LAB');assert.equal(cfg.sandbox?.schema,cfg.user);assert.equal(cfg.sandbox.enabled,true);
 const db=await oracledb.getConnection({user:cfg.user,password:cfg.password,connectString:cfg.connectString});let checks=0;
 const requestId=randomUUID().replaceAll('-',''),token=randomUUID().replaceAll('-','');let runId;
 try{
  assert.deepEqual((await db.execute("select user,sys_context('USERENV','CURRENT_SCHEMA') from dual")).rows[0],[cfg.user,cfg.user]);
  assert.equal((await db.execute('select count(*) from apex_workspace_schemas where schema=:owner and workspace_name=:workspace and workspace_id=:workspaceId',{owner:cfg.user,workspace:cfg.sandbox.workspace,workspaceId:cfg.sandbox.workspaceId})).rows[0][0],1);checks++;
  const original=(await db.execute('select enabled,worker_enabled,control_application_id,worker_binding from apxgen_app_control_config where config_id=1 for update nowait')).rows[0];
  assert.equal(original[0],0);assert.equal(original[1],0);assert.ok(original[2]===null||original[2]===134);assert.equal(original[3],null);checks++;
  const legacy='61baf73fb822430bb27310d22c0744e8';
  assert.equal((await db.execute('select count(*) from apxgen_app_runs where run_id=:run',{run:legacy})).rows[0][0],1);
  assert.equal(await verifyQueuedImportLease(db,{runId:legacy,policy:cfg.sandbox,timeoutMs:120000}),null);checks++;
  await assert.rejects(()=>verifyQueuedImportLease(db,{runId:legacy,requestId,policy:cfg.sandbox,timeoutMs:120000}));checks++;
  runId=(await db.execute("begin :id:=apxgen_app_evolution.create_run(50000,1,2,'TEST_ONLY queue query boundary; never imported');end;",{id:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32}})).outBinds.id;
  await db.execute("insert into apxgen_app_control_requests(request_id,created_by,label,seed,generations,materialization_budget) values(:id,'TEST_ONLY','TEST_ONLY queue query boundary; never imported',50000,1,2)",{id:requestId});
  await db.execute("update apxgen_app_control_requests set state='QUEUED',queued_at=systimestamp where request_id=:id",{id:requestId});
  await db.execute("update apxgen_app_control_requests set state='CLAIMED',claim_token=:token,claim_binding='QUERY_TEST_ONLY',claimed_at=systimestamp,lease_until=systimestamp+interval '300' second where request_id=:id",{id:requestId,token});
  await db.execute('update apxgen_app_control_requests set run_id=:run where request_id=:id',{run:runId,id:requestId});
  // Synthetic config row only; application134 is neither allocated nor imported.
  await db.execute("update apxgen_app_control_config set enabled=1,schema_name=:owner,workspace_id=:workspaceId,control_application_id=134,max_generations=1,max_materializations=2,worker_enabled=1,worker_binding='QUERY_TEST_ONLY',worker_seen_at=systimestamp where config_id=1",{owner:cfg.user,workspaceId:cfg.sandbox.workspaceId});
  const options={runId,requestId,policy:cfg.sandbox,timeoutMs:120000};
  const observed=await verifyQueuedImportLease(db,options);
  assert.equal(observed.requestId,requestId);assert.equal(observed.runId,runId);assert.equal(observed.workspaceId,cfg.sandbox.workspaceId);
  for(const name of ['enabled','workerEnabled','bindingMatches','leaseCoversImport','heartbeatCurrent'])assert.equal(observed[name],true);checks++;
  await assert.rejects(()=>verifyQueuedImportLease(db,{...options,requestId:undefined}));checks++;
  await assert.rejects(()=>verifyQueuedImportLease(db,{...options,requestId:randomUUID().replaceAll('-','')}));checks++;
  for(const sql of [
   "update apxgen_app_control_requests set lease_until=systimestamp+interval '120' second where request_id=:id",
   "update apxgen_app_control_requests set state='UNCERTAIN',completed_at=systimestamp where request_id=:id",
   "update apxgen_app_control_config set worker_binding='WRONG_TEST_BINDING' where config_id=1",
   'update apxgen_app_control_config set enabled=0 where config_id=1',
   'update apxgen_app_control_config set worker_enabled=0 where config_id=1',
   "update apxgen_app_control_config set worker_seen_at=systimestamp-interval '61' second where config_id=1",
   "update apxgen_app_control_config set worker_seen_at=systimestamp+interval '1' day where config_id=1",
   "update apxgen_app_control_config set schema_name='APXGEN_LAB' where config_id=1",
   'update apxgen_app_control_config set workspace_id=workspace_id+1 where config_id=1'
  ]){
   await db.execute('savepoint query_case');await db.execute(sql,sql.includes(':id')?{id:requestId}:{});
   await assert.rejects(()=>verifyQueuedImportLease(db,options));await db.execute('rollback to query_case');checks++;
  }
  await db.rollback();
  assert.deepEqual((await db.execute('select enabled,worker_enabled,control_application_id,worker_binding from apxgen_app_control_config where config_id=1')).rows[0],original);
  assert.equal((await db.execute('select count(*) from apxgen_app_control_requests where request_id=:id',{id:requestId})).rows[0][0],0);
  assert.equal((await db.execute('select count(*) from apxgen_app_runs where run_id=:run',{run:runId})).rows[0][0],0);checks++;
  console.log(JSON.stringify({suite:'native-queue-import-query',testOnly:true,passed:true,checks,rolledBack:true,imports:0,paidRequests:0,authenticatedWorkerVerified:false}));
 }finally{await db.rollback();await db.close();}
}
