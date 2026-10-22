import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import oracledb from 'oracledb';
const configPath=process.env.APXGEN_APPLICATION_TEST_CONFIG;
if(!configPath) console.log(JSON.stringify({skipped:true,reason:'Explicit application sandbox configuration required'}));
else{
 const config=JSON.parse((await readFile(configPath,'utf8')).replace(/^\uFEFF/,''));
 assert.equal(config.user,'APXGEN_ORDER_LAB');assert.equal(config.sandbox.schema,config.user);assert.equal(config.sandbox.enabled,true);
 assert.ok(config.sandbox.applicationIds.includes(132)&&config.sandbox.applicationIds.includes(133),'Explicit unused boundary-test slots132/133 required');
 const db=await oracledb.getConnection({user:config.user,password:config.password,connectString:config.connectString});
 const textOut=()=>({dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32767});let checks=0;
 const runs=[];
 const query=async(sql,binds={})=>(await db.execute(sql,binds)).rows;
 const rejects=async(fn,number)=>{await assert.rejects(fn,error=>error.errorNum===number);checks++;};
 const phase=async(id,state,extra={})=>db.execute('begin apxgen_app_evolution.record_phase(:id,:state,:artifact,:app);end;',{id,state,artifact:extra.hash??null,app:extra.app??null});
 async function create(label,budget=1){
  const id=(await db.execute('begin :id:=apxgen_app_evolution.create_run(:seed,1,:budget,:label);end;',{id:textOut(),seed:50000,budget,label:'TEST '+label})).outBinds.id;
  runs.push(id);return {run:id,id:(await query('select organism_id from apxgen_app_organisms where run_id=:run',{run:id}))[0][0]};
 }
 async function readyForImport(id){await phase(id,'DEFINITION_GENERATED',{hash:'1'.repeat(64)});await phase(id,'VALIDATION_STARTED');await phase(id,'VALIDATED');}
 async function register(app,candidate,{expired=false}={}){
  // Test-only rows and actual API-issued provenance IDs, never published/committed.
  await db.execute("insert into genesis_order_lab_slots(application_id,workspace_id,approved_username,owner_run_id,owner_organism_id,lease_token,lease_until,slot_state) values(:app,:workspace,'GENESIS_TEST',:run,:organism,:token,systimestamp+numtodsinterval(:seconds,'SECOND'),'ACTIVE')",{app,workspace:config.sandbox.workspaceId,run:candidate.run,organism:candidate.id,token:randomUUID().replaceAll('-',''),seconds:expired?-60:600});
 }
 async function testMetrics(id){const hash=(await query('select genome_hash from apxgen_app_organisms where organism_id=:id',{id}))[0][0];return JSON.stringify({fitnessDefinition:'order-lab-task-proxy/2.0.0',protocolVersion:'application-fitness-2.0',genomeFingerprint:hash,compilerValidated:true,importVerified:true,authenticationVerified:true,runtimeVerified:true,fixtureVerified:true,databaseChangeVerified:true,securityVerified:true,tasks:{locateOrder:{success:true,actions:2,navigationSteps:0},filterOrders:{success:true,actions:3,navigationSteps:0},updateOrder:{success:true,actions:4,navigationSteps:1}},viewportsTested:3,criticalViolations:0,seriousViolations:0,unnamedControls:0,focusFailures:0,horizontalOverflow:0,runtimeErrors:0,loadMs:500,componentCount:10});}
 try{
  assert.equal((await db.execute("select sys_context('USERENV','CURRENT_SCHEMA') from dual")).rows[0][0],config.sandbox.schema);
  const created=await db.execute("begin :id:=apxgen_app_evolution.create_run(50000,1,2,'TEST application evolution boundary; no imported application');end;",{id:textOut()});
  const run=created.outBinds.id;assert.match(run,/^[a-f0-9]{32}$/);checks++;
  const row=(await db.execute('select organism_id,state,generation from apxgen_app_organisms where run_id=:run',{run})).rows[0];
  assert.equal(row[1],'GENOME_CREATED');assert.equal(row[2],0);checks++;
  await assert.rejects(()=>db.execute("begin apxgen_app_evolution.record_phase(:id,'IMPORTED');end;",{id:row[0]}));checks++;
  await assert.rejects(()=>db.execute('begin :id:=apxgen_app_evolution.next_candidate(:run);end;',{run,id:textOut()}));checks++;
  await assert.rejects(()=>db.execute('update apxgen_app_organisms set genome_hash=genome_hash where organism_id=:id',{id:row[0]}));checks++;
  await db.execute("begin apxgen_app_evolution.reject(:id,'TEST deliberate static rejection');end;",{id:row[0]});
  assert.equal((await db.execute('select state from apxgen_app_runs where run_id=:run',{run})).rows[0][0],'FAILED');checks++;
  await assert.rejects(()=>db.execute("update apxgen_app_events set detail='altered' where organism_id=:id",{id:row[0]}));checks++;
  const mappings=await query('select workspace_name,workspace_id from apex_workspace_schemas where schema=:schema',{schema:config.user});
  assert.ok(mappings.some(([name,id])=>name===config.sandbox.workspace&&id===config.sandbox.workspaceId));checks++;
  assert.equal((await query('select count(*) from genesis_order_lab_slots where application_id in(132,133)'))[0][0],0,'Boundary-test slots must not already be registered');checks++;
  // Schema and run-boundary errors must not create partial candidate history.
  for(const budget of [0,129,1.5])await rejects(()=>db.execute("begin :id:=apxgen_app_evolution.create_run(50000,1,:budget,'TEST invalid materialization cap');end;",{budget,id:textOut()}),20131);
  const bounded=await create('immutable outcomes and exhausted cap',1);
  const eventCount=(await query('select count(*) from apxgen_app_events where organism_id=:id',{id:bounded.id}))[0][0];
  for(const state of [null,'UNRECOGNIZED','IMPORTED','SELECTED','GENOME_CREATED'])await rejects(()=>phase(bounded.id,state),20132);
  await rejects(()=>phase(bounded.id,'DEFINITION_GENERATED'),20132);
  assert.equal((await query('select count(*) from apxgen_app_events where organism_id=:id',{id:bounded.id}))[0][0],eventCount);checks++;
  await readyForImport(bounded.id);
  for(const app of [120,121,132])await rejects(()=>phase(bounded.id,'IMPORT_STARTED',{app}),20132);
  assert.equal((await query('select materializations from apxgen_app_runs where run_id=:run',{run:bounded.run}))[0][0],0);checks++;
  await register(132,bounded,{expired:true});
  await rejects(()=>phase(bounded.id,'IMPORT_STARTED',{app:132}),20132);
  await db.execute("update genesis_order_lab_slots set lease_until=systimestamp+interval '10' minute where application_id=132");
  await phase(bounded.id,'IMPORT_STARTED',{app:132});
  await rejects(()=>phase(bounded.id,'IMPORT_STARTED',{app:132}),20132);
  assert.equal((await query('select materializations from apxgen_app_runs where run_id=:run',{run:bounded.run}))[0][0],1);checks++;
  for(const state of ['IMPORTED','RUNTIME_VERIFIED','TESTING'])await phase(bounded.id,state);
  await db.execute('begin apxgen_app_evolution.evaluate(:id,:metrics);end;',{id:bounded.id,metrics:await testMetrics(bounded.id)});
  // Literal metrics above are controlled TEST inputs, not real task observations.
  await rejects(()=>db.execute('update apxgen_app_organisms set fitness=0 where organism_id=:id',{id:bounded.id}),20130);
  await rejects(()=>db.execute("update apxgen_app_organisms set metrics_json='{}' where organism_id=:id",{id:bounded.id}),20130);
  await db.execute('begin apxgen_app_evolution.decide(:id);end;',{id:bounded.id});
  assert.deepEqual((await query('select state,eligible,fitness,selected from apxgen_app_organisms where organism_id=:id',{id:bounded.id}))[0],['SELECTED',1,100,1]);checks++;
  for(const sql of ['update apxgen_app_organisms set reason=reason where organism_id=:id','update apxgen_app_organisms set selected=0 where organism_id=:id','update apxgen_app_organisms set application_id=133 where organism_id=:id','delete from apxgen_app_organisms where organism_id=:id'])await rejects(()=>db.execute(sql,{id:bounded.id}),20130);
  await rejects(()=>db.execute('begin apxgen_app_evolution.decide(:id);end;',{id:bounded.id}),20133);
  const child=(await db.execute('begin :id:=apxgen_app_evolution.next_candidate(:run);end;',{run:bounded.run,id:textOut()})).outBinds.id;
  assert.deepEqual((await query('select generation,parent_id,method,state from apxgen_app_organisms where organism_id=:id',{id:child}))[0],[1,bounded.id,'MUTATION','GENOME_CREATED']);checks++;
  await rejects(()=>db.execute('begin :id:=apxgen_app_evolution.next_candidate(:run);end;',{run:bounded.run,id:textOut()}),20131);
  await readyForImport(child);await register(133,{run:bounded.run,id:child});
  await rejects(()=>phase(child,'IMPORT_STARTED',{app:133}),20132);
  assert.equal((await query('select materializations from apxgen_app_runs where run_id=:run',{run:bounded.run}))[0][0],1);
  assert.equal((await query('select state from apxgen_app_organisms where organism_id=:id',{id:child}))[0][0],'VALIDATED');checks++;
  await db.execute("begin apxgen_app_evolution.reject(:id,'TEST exhausted materialization budget retained');end;",{id:child});
  assert.equal((await query('select state from apxgen_app_runs where run_id=:run',{run:bounded.run}))[0][0],'COMPLETE');checks++;
  await rejects(()=>db.execute('update apxgen_app_organisms set fitness=100 where organism_id=:id',{id:child}),20130);
  await rejects(()=>db.execute('begin :id:=apxgen_app_evolution.next_candidate(:run);end;',{run:bounded.run,id:textOut()}),20131);
  await rejects(()=>db.execute('delete from apxgen_app_events where organism_id=:id',{id:child}),20130);

  const cancelled=await create('cancelled runs refuse evaluation');
  await readyForImport(cancelled.id);
  await db.execute("update genesis_order_lab_slots set owner_run_id=:run,owner_organism_id=:organism,lease_token=:token where application_id=132",{run:cancelled.run,organism:cancelled.id,token:randomUUID().replaceAll('-','')});
  await phase(cancelled.id,'IMPORT_STARTED',{app:132});
  for(const state of ['IMPORTED','RUNTIME_VERIFIED','TESTING'])await phase(cancelled.id,state);
  await db.execute("update apxgen_app_runs set state='CANCELLED' where run_id=:run",{run:cancelled.run});
  const cancelledMetrics=await testMetrics(cancelled.id);
  await rejects(()=>db.execute('begin apxgen_app_evolution.evaluate(:id,:metrics);end;',{id:cancelled.id,metrics:cancelledMetrics}),20133);
  assert.deepEqual((await query('select state,metrics_json,fitness from apxgen_app_organisms where organism_id=:id',{id:cancelled.id}))[0],['TESTING',null,null]);checks++;
  await db.rollback();
  for(const run of runs)assert.equal((await query('select count(*) from apxgen_app_runs where run_id=:run',{run}))[0][0],0);
  assert.equal((await query('select count(*) from genesis_order_lab_slots where application_id in(132,133)'))[0][0],0);checks++;
  // All test rows roll back. No fixtures, app imports or paid calls are involved.
  console.log(JSON.stringify({suite:'application-evolution-boundary',checks,passed:true,rolledBack:true,realTaskEvidence:false,imports:0,paidRequests:0}));
 }finally{await db.rollback();await db.close();}
}
