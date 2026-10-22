// Rollback-only contract. Run only in the explicitly reviewed application sandbox.
// No DDL, imports, provider calls, APEX-session creation, or committed test data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import oracledb from 'oracledb';
const configPath=process.env.APXGEN_CONTROL_TEST_CONFIG;
if(!configPath)console.log(JSON.stringify({suite:'native-control-boundary',skipped:true,reason:'Explicit APXGEN_CONTROL_TEST_CONFIG required; no connection made'}));
else await run();
async function run(){
 const cfg=JSON.parse((await readFile(configPath,'utf8')).replace(/^\uFEFF/,''));
 assert.equal(cfg.user,'APXGEN_ORDER_LAB');assert.equal(cfg.sandbox?.schema,cfg.user);
 assert.equal(cfg.sandbox.enabled,true);assert.ok(Number.isSafeInteger(cfg.sandbox.workspaceId));
 const db=await oracledb.getConnection({user:cfg.user,password:cfg.password,connectString:cfg.connectString});let checks=0;
 try{
  assert.deepEqual((await db.execute("select user,sys_context('USERENV','CURRENT_SCHEMA') from dual")).rows[0],[cfg.user,cfg.user]);
  assert.equal((await db.execute('select count(*) from apex_workspace_schemas where schema=:owner and workspace_name=:workspace and workspace_id=:workspaceId',{owner:cfg.user,workspace:cfg.sandbox.workspace,workspaceId:cfg.sandbox.workspaceId})).rows[0][0],1);checks++;
  const config=(await db.execute('select enabled,worker_enabled,control_application_id,worker_binding from apxgen_app_control_config where config_id=1')).rows[0];
  assert.equal(config[0],0);assert.equal(config[1],0);assert.ok(config[2]===null||config[2]===134);assert.equal(config[3],null);
  if(config[2]===134){
   assert.deepEqual((await db.execute('select schema_name,workspace_id from apxgen_app_control_config where config_id=1')).rows[0],[cfg.user,cfg.sandbox.workspaceId]);
  }checks++;
  const out={dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32767};
  const payload={label:'TEST pure feasibility capability',seed:50000,generations:1,materializationBudget:2};
  const validate=value=>db.execute('begin :value:=apxgen_app_control.validate_payload(:payload);end;',{value:out,payload:typeof value==='string'?value:JSON.stringify(value)});
  assert.deepEqual(JSON.parse((await validate(payload)).outBinds.value),payload);checks++;
  for(const bad of [{...payload,seed:50001},{...payload,seed:'50000'},{...payload,seed:null},{...payload,generations:2,materializationBudget:3},{...payload,materializationBudget:3},{...payload,mode:'HYBRID'},{...payload,label:'TEST\nlabel'},{...payload,label:'TEST\u0000label'},{...payload,label:'TEST\u007flabel'},{...payload,label:'é'.repeat(64)},'{"label":"TEST duplicate seed","seed":50000,"seed":50001,"generations":1,"materializationBudget":2}']){
   await assert.rejects(()=>validate(bad),error=>error.errorNum===20140);checks++;
  }
  const denied=sql=>assert.rejects(()=>db.execute(sql,{value:out}),error=>error.errorNum===20140);
  await denied('begin :value:=apxgen_app_control.status_json;end;');checks++;
  await denied("begin :value:=apxgen_app_control.create_draft('{\"label\":\"TEST\",\"seed\":50000,\"generations\":1,\"materializationBudget\":2}');end;");checks++;
  await denied("begin :value:=apxgen_app_control.worker_claim('TEST',30);end;");checks++;
  await assert.rejects(()=>db.execute("begin apxgen_app_control.worker_heartbeat('TEST');end;"),error=>error.errorNum===20140);checks++;
  const request=randomUUID().replaceAll('-','');
  await db.execute("insert into apxgen_app_control_requests(request_id,created_by,label,seed,generations,materialization_budget) values(:id,'TEST_ONLY','TEST rollback-only queue boundary',50000,1,2)",{id:request});checks++;
  for(const sql of ["update apxgen_app_control_requests set state='CLAIMED' where request_id=:id","update apxgen_app_control_requests set seed=50001 where request_id=:id",'delete from apxgen_app_control_requests where request_id=:id']){
   await assert.rejects(()=>db.execute(sql,{id:request}),error=>error.errorNum===20140);checks++;
  }
  await db.execute("update apxgen_app_control_requests set state='QUEUED',queued_at=systimestamp where request_id=:id",{id:request});checks++;
  await db.execute("update apxgen_app_control_requests set state='CLAIMED',claimed_at=systimestamp,claim_token=:token,claim_binding='TEST_ONLY',lease_until=systimestamp+interval '30' second where request_id=:id",{id:request,token:randomUUID().replaceAll('-','')});checks++;
  for(const sql of ["update apxgen_app_control_requests set state='QUEUED' where request_id=:id","update apxgen_app_control_requests set claim_token=claim_token where request_id=:id"]){await assert.rejects(()=>db.execute(sql,{id:request}),error=>error.errorNum===20140);checks++;}
  await db.execute("update apxgen_app_control_requests set state='UNCERTAIN',completed_at=systimestamp where request_id=:id",{id:request});checks++;
  await assert.rejects(()=>db.execute("update apxgen_app_control_requests set state='QUEUED' where request_id=:id",{id:request}),error=>error.errorNum===20140);checks++;
  await db.execute("insert into apxgen_app_control_events(request_id,state,actor) values(:id,'UNCERTAIN','TEST_ONLY')",{id:request});
  for(const sql of ["update apxgen_app_control_events set state='COMPLETED' where request_id=:id",'delete from apxgen_app_control_events where request_id=:id']){await assert.rejects(()=>db.execute(sql,{id:request}),error=>error.errorNum===20140);checks++;}
  await db.rollback();assert.equal((await db.execute('select count(*) from apxgen_app_control_requests where request_id=:id',{id:request})).rows[0][0],0);checks++;
  console.log(JSON.stringify({suite:'native-control-boundary',passed:true,checks,rolledBack:true,imports:0,paidRequests:0,configuredWorkerVerified:false}));
 }finally{await db.rollback();await db.close();}
}
