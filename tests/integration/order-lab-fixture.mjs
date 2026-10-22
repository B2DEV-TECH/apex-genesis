// Destructive only within two explicitly registered disposable fixture slots.
// No installation, slot registration, app import or browser-success claim.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import oracledb from 'oracledb';

const configPath=process.env.APXGEN_APPLICATION_TEST_CONFIG;
if(!configPath){
 console.log(JSON.stringify({skipped:true,reason:'Explicit application sandbox configuration and registered fixture leases required.'}));
}else{
 await verifyFixture();
}

async function verifyFixture(){
 let cfg;
 try{cfg=JSON.parse((await readFile(configPath,'utf8')).replace(/^\uFEFF/,''));}
 catch{throw new TypeError('Application fixture configuration could not be read as JSON');}
 const {sandbox,fixture}=cfg;
 assert.ok(sandbox&&sandbox.fixtureWritesAuthorized===true,'Explicit fixture-write authorization required');
 assert.match(sandbox.schema??'',/^[A-Z][A-Z0-9_]{0,127}$/);
 assert.ok(!['SYS','SYSTEM','APXGEN_LAB','APXGEN_VERIFY','APEX_PUBLIC_USER','ORDS_PUBLIC_USER'].includes(sandbox.schema),'Existing and administrative owners are excluded');
 assert.equal(cfg.user,sandbox.schema);
 assert.ok(Number.isSafeInteger(sandbox.workspaceId)&&sandbox.workspaceId>0);
 assert.ok(typeof sandbox.workspace==='string'&&sandbox.workspace.length>0);
 assert.ok(Array.isArray(sandbox.applicationIds)&&sandbox.applicationIds.length>=2&&sandbox.applicationIds.every(id=>Number.isSafeInteger(id)&&id>0&&![120,121].includes(id)));
 assert.ok(fixture&&fixture.applicationId!==fixture.otherApplicationId,'Two separately registered fixture slots required');
 for(const [id,token]of [[fixture.applicationId,fixture.leaseToken],[fixture.otherApplicationId,fixture.otherLeaseToken]]){
  assert.ok(sandbox.applicationIds.includes(id),'Fixture slot must be allowlisted');
  assert.match(token??'',/^[a-f0-9]{32}$/,'Explicit registered lease token required');
 }
 assert.ok(typeof fixture.approvedUsername==='string'&&fixture.approvedUsername.length>0);
 assert.ok(typeof cfg.password==='string'&&cfg.password.length>0&&typeof cfg.connectString==='string'&&cfg.connectString.length>0);
 const db=await oracledb.getConnection({user:cfg.user,password:cfg.password,connectString:cfg.connectString});
 let checks=0;
 const rows=async(sql,binds={})=>(await db.execute(sql,binds,{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
 const textOut=()=>({dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32767});
 async function reset(id,token){await db.execute('begin genesis_order_lab.reset_fixture(:id,:token);end;',{id,token});}
 async function hash(id,token){return(await db.execute('begin :result:=genesis_order_lab.fixture_hash(:id,:token);end;',{id,token,result:textOut()})).outBinds.result;}
 try{
  const identity=(await rows("select user owner,sys_context('USERENV','CURRENT_SCHEMA') current_schema from dual"))[0];
  assert.equal(identity.OWNER,sandbox.schema);assert.equal(identity.CURRENT_SCHEMA,sandbox.schema);
  const mappings=await rows('select workspace_name,workspace_id from apex_workspace_schemas where schema=:schema',{schema:sandbox.schema});
  assert.ok(mappings.some(row=>row.WORKSPACE_NAME===sandbox.workspace&&row.WORKSPACE_ID===sandbox.workspaceId));checks++;
  // These rows must already exist through the trusted slot allocator/operator.
  for(const [id,token]of [[fixture.applicationId,fixture.leaseToken],[fixture.otherApplicationId,fixture.otherLeaseToken]]){
   const registered=await rows("select workspace_id,approved_username,owner_run_id,owner_organism_id,slot_state,case when lease_until>systimestamp then 1 else 0 end live from genesis_order_lab_slots where application_id=:id and lease_token=:token",{id,token});
   assert.equal(registered.length,1,'An exact registered lease is required');
   assert.equal(registered[0].WORKSPACE_ID,sandbox.workspaceId);assert.equal(registered[0].APPROVED_USERNAME,fixture.approvedUsername);
   assert.equal(registered[0].SLOT_STATE,'ACTIVE');assert.equal(registered[0].LIVE,1);
   assert.match(registered[0].OWNER_RUN_ID,/^[a-f0-9]{32}$/);assert.match(registered[0].OWNER_ORGANISM_ID,/^[a-f0-9]{32}$/);
  }checks++;

  await reset(fixture.applicationId,fixture.leaseToken);
  await reset(fixture.otherApplicationId,fixture.otherLeaseToken);
  const expectedStatuses=['PROCESSING','DELAYED','SHIPPED','COMPLETED','NEW'];
  const actual=await rows('select order_id,customer_name,status,order_total,row_version from genesis_orders where application_id=:id order by order_id',{id:fixture.applicationId});
  assert.equal(actual.length,40);
  for(let i=1;i<=40;i++)assert.deepEqual(actual[i-1],{ORDER_ID:1000+i,CUSTOMER_NAME:'Synthetic Customer '+String(i).padStart(2,'0'),STATUS:expectedStatuses[(i-1)%5],ORDER_TOTAL:100+i*17.25,ROW_VERSION:0});checks++;
  const baseline=await hash(fixture.applicationId,fixture.leaseToken);
  assert.match(baseline,/^[a-f0-9]{64}$/);
  assert.equal(await hash(fixture.otherApplicationId,fixture.otherLeaseToken),baseline);checks++;
  assert.deepEqual(await rows('select * from genesis_orders_safe_v'),[],'No APEX session must expose no fixture rows');checks++;
  await assert.rejects(()=>db.execute("begin genesis_order_lab.update_status(1002,'SHIPPED');end;"),e=>e.errorNum===20131);checks++;
  const wrongToken=fixture.leaseToken[0]==='0'?'1'+fixture.leaseToken.slice(1):'0'+fixture.leaseToken.slice(1);
  await assert.rejects(()=>reset(fixture.applicationId,wrongToken),e=>e.errorNum===20130);
  await assert.rejects(()=>hash(fixture.applicationId,wrongToken),e=>e.errorNum===20130);
  await assert.rejects(()=>reset(120,fixture.leaseToken),e=>e.errorNum===20130);checks++;

  // Alter one authorized partition through a bound trusted-worker SQL statement.
  // This is a fixture/hash isolation test, not successful runtime task evidence.
  await db.execute("update genesis_orders set status='SHIPPED',row_version=row_version+1 where application_id=:id and order_id=:orderId",{id:fixture.applicationId,orderId:1002});
  assert.notEqual(await hash(fixture.applicationId,fixture.leaseToken),baseline);
  assert.equal(await hash(fixture.otherApplicationId,fixture.otherLeaseToken),baseline);
  await reset(fixture.applicationId,fixture.leaseToken);
  assert.equal(await hash(fixture.applicationId,fixture.leaseToken),baseline);checks++;
  console.log(JSON.stringify({checks,passed:true,fixtureVersion:'order-lab/1.0',runtimeUpdateVerified:false,browserTasksVerified:false}));
 }finally{
  // No commits or APEX session creation: restore every test change by rollback.
  await db.rollback();await db.close();
 }
}
