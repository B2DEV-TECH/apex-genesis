// Pure Oracle contract checks. This file never installs packages or edits apps.
// An explicit, owner-authorized sandbox is required even for these pure calls.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import oracledb from 'oracledb';

const configPath=process.env.APXGEN_APPLICATION_TEST_CONFIG;
if(!configPath){
 console.log(JSON.stringify({skipped:true,reason:'Set APXGEN_APPLICATION_TEST_CONFIG to an explicitly authorized sandbox configuration.'}));
}else{
 await runContract();
}

async function runContract(){
 let cfg;
 try{cfg=JSON.parse((await readFile(configPath,'utf8')).replace(/^\uFEFF/,''));}
 catch{throw new TypeError('Application sandbox configuration could not be read as JSON');}
 const sandbox=cfg.sandbox;
 assert.ok(sandbox&&typeof sandbox==='object','Explicit sandbox policy required');
 assert.match(sandbox.schema??'',/^[A-Z][A-Z0-9_]{0,127}$/,'Explicit parsing schema required');
 assert.ok(!['SYS','SYSTEM','INTERNAL','PUBLIC','APEX_PUBLIC_USER','ORDS_PUBLIC_USER'].includes(sandbox.schema),'Administrative schemas are excluded');
 assert.notEqual(sandbox.schema,'APXGEN_LAB','The active LAB is excluded');
 assert.equal(cfg.user,sandbox.schema,'Connection owner must match the sandbox schema');
 assert.ok(typeof cfg.password==='string'&&cfg.password.length>0,'Local connection password required');
 assert.ok(typeof cfg.connectString==='string'&&cfg.connectString.length>0,'Explicit connection string required');
 assert.ok(typeof sandbox.workspace==='string'&&sandbox.workspace.length>0,'Explicit workspace required');
 assert.ok(Number.isSafeInteger(sandbox.workspaceId)&&sandbox.workspaceId>0,'Explicit workspace ID required');
 assert.ok(Array.isArray(sandbox.applicationIds)&&sandbox.applicationIds.length>0&&sandbox.applicationIds.every(id=>Number.isSafeInteger(id)&&id>0),'Explicit disposable application IDs required');
 assert.ok(sandbox.applicationIds.every(id=>![120,121].includes(id)),'Existing Genesis applications are protected');

 const db=await oracledb.getConnection({user:cfg.user,password:cfg.password,connectString:cfg.connectString});
 let checks=0;
 const canonical='{"schemaVersion":"2.0","application":"GENESIS_ORDER_LAB","dataSource":"GENESIS_ORDERS_SAFE_V","tasks":["locateOrder","filterOrders","updateOrder"],"traits":{"report":"classicReport","edit":"page","filters":"above","summary":"before","navigation":"side","density":"comfortable"}}';
 const base=JSON.parse(canonical);
 const alternate={...base,traits:{report:'interactiveReport',edit:'modal',filters:'beside',summary:'after',navigation:'top',density:'compact'}};
 const fingerprint=createHash('sha256').update(canonical).digest('hex');
 const numberOut=()=>({dir:oracledb.BIND_OUT,type:oracledb.NUMBER});
 const textOut=()=>({dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32767});
 async function canonicalize(value){return (await db.execute('begin :result:=apxgen_app_genome.canonical(:genome);end;',{genome:typeof value==='string'?value:JSON.stringify(value),result:textOut()})).outBinds.result;}
 async function rejectGenome(value){await assert.rejects(()=>canonicalize(value),e=>e.errorNum===20110);checks++;}
 async function rngCall(name,parent=null,other=null,seed=42){
  const binds={state:{dir:oracledb.BIND_INOUT,type:oracledb.NUMBER,val:seed},result:textOut()};
  if(parent!==null)binds.parent=typeof parent==='string'?parent:JSON.stringify(parent);
  if(other!==null)binds.other=JSON.stringify(other);
  const args=name==='random_genome'?':state':name==='mutate'?':parent,:state':':parent,:other,:state';
  return (await db.execute(`begin :result:=apxgen_app_genome.${name}(${args});end;`,binds)).outBinds;
 }
 async function proposal(value,parent=base){return (await db.execute('begin :result:=apxgen_app_genome.apply_proposal(:parent,:proposal);end;',{parent:JSON.stringify(parent),proposal:typeof value==='string'?value:JSON.stringify(value),result:textOut()})).outBinds.result;}
 function evidence(){return {fitnessDefinition:'order-lab-task-proxy/2.0.0',protocolVersion:'application-fitness-2.0',genomeFingerprint:fingerprint,compilerValidated:true,importVerified:true,authenticationVerified:true,runtimeVerified:true,fixtureVerified:true,databaseChangeVerified:true,securityVerified:true,tasks:{locateOrder:{success:true,actions:2,navigationSteps:0},filterOrders:{success:true,actions:3,navigationSteps:0},updateOrder:{success:true,actions:4,navigationSteps:1}},viewportsTested:3,criticalViolations:0,seriousViolations:0,unnamedControls:0,focusFailures:0,horizontalOverflow:0,runtimeErrors:0,loadMs:500,componentCount:10};}
 async function score(value){const r=await db.execute('begin apxgen_app_fitness.score(:genome,:metrics,:eligible,:fitness,:taskEffort,:navigation,:accessibility,:performance,:simplicity);end;',{genome:canonical,metrics:typeof value==='string'?value:JSON.stringify(value),eligible:numberOut(),fitness:numberOut(),taskEffort:numberOut(),navigation:numberOut(),accessibility:numberOut(),performance:numberOut(),simplicity:numberOut()});return r.outBinds;}
 try{
  const identity=(await db.execute("select user owner,sys_context('USERENV','CURRENT_SCHEMA') current_schema from dual",{}, {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0];
  assert.equal(identity.OWNER,sandbox.schema);assert.equal(identity.CURRENT_SCHEMA,sandbox.schema);
  const mapping=(await db.execute('select workspace_name,workspace_id from apex_workspace_schemas where schema=:schema',{schema:sandbox.schema},{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
  assert.ok(mapping.some(row=>row.WORKSPACE_NAME===sandbox.workspace&&row.WORKSPACE_ID===sandbox.workspaceId),'Connected schema must map to the authorized workspace ID');checks++;

  // Canonical bytes and fingerprints must agree across Oracle and the JS boundary.
  assert.equal(await canonicalize(base),canonical);
  assert.equal(await canonicalize({...base,traits:{...base.traits},tasks:[...base.tasks]}),canonical);
  const reordered={traits:{density:'comfortable',navigation:'side',summary:'before',filters:'above',edit:'page',report:'classicReport'},tasks:base.tasks,dataSource:base.dataSource,application:base.application,schemaVersion:base.schemaVersion};
  assert.equal(await canonicalize(reordered),canonical);
  const hashed=(await db.execute('begin :result:=apxgen_app_genome.fingerprint(:genome);end;',{genome:JSON.stringify(reordered),result:textOut()})).outBinds.result;
  assert.equal(hashed,fingerprint);checks++;
  await db.execute('begin apxgen_app_genome.validate(:genome);end;',{genome:canonical});checks++;

  const alleles={report:['classicReport','interactiveReport'],edit:['page','modal'],filters:['above','beside'],summary:['before','after'],navigation:['side','top'],density:['comfortable','compact']};
  for(let bits=0;bits<64;bits++){
   const traits=Object.fromEntries(Object.entries(alleles).map(([key,values],i)=>[key,values[(bits>>i)&1]]));
   assert.deepEqual(JSON.parse(await canonicalize({...base,traits})),{...base,traits});
  }checks++;
  for(const invalid of [null,[],{}, {...base,sql:'select * from orders'}, {...base,application:'OTHER'}, {...base,dataSource:'ORDERS'}, {...base,tasks:[...base.tasks].reverse()}, {...base,tasks:[...base.tasks,'deleteOrder']}, {...base,traits:{...base.traits,sql:'delete from orders'}}, {...base,traits:{...base.traits,report:'<script>alert(1)</script>'}}, {...base,traits:{...base.traits,density:null}}, {...base,traits:{...base.traits,edit:true}}, {...base,schemaVersion:2}])await rejectGenome(JSON.stringify(invalid));
  await rejectGenome(canonical.replace('"schemaVersion":"2.0"','"schemaVersion":"2.0","schemaVersion":"2.0"'));
  await rejectGenome(canonical.replace('"edit":"page"','"edit":"page","edit":"modal"'));

  // Golden Park-Miller sequence from seed 42, six draws; no JS genetic algorithm.
  const generated=await rngCall('random_genome');
  assert.deepEqual(JSON.parse(generated.result),{...base,traits:{...base.traits,edit:'modal',filters:'beside'}});
  assert.equal(generated.state,421520601);
  assert.deepEqual(await rngCall('random_genome'),generated);checks++;
  const mutated=await rngCall('mutate',base);
  assert.deepEqual(JSON.parse(mutated.result),{...base,traits:{...base.traits,report:'interactiveReport'}});
  assert.equal(mutated.state,705894);checks++;
  for(const [index,seed] of [42,30000,50000,70000,90000,110000].entries()){
   const trait=Object.keys(alleles)[index];
   const child=JSON.parse((await rngCall('mutate',base,null,seed)).result);
   assert.deepEqual(child,{...base,traits:{...base.traits,[trait]:alleles[trait][1]}});
  }checks++;
  const crossed=await rngCall('crossover',base,alternate);
  assert.deepEqual(JSON.parse(crossed.result),{...base,traits:{...base.traits,edit:'modal',filters:'beside'}});
  assert.equal(crossed.state,421520601);checks++;
  for(const seed of [null,0,-1,1.5,2147483647])await assert.rejects(()=>rngCall('random_genome',null,null,seed),e=>e.errorNum===20110);checks++;

  assert.deepEqual(JSON.parse(await proposal({operations:[{trait:'report',value:'interactiveReport'},{trait:'edit',value:'modal'},{trait:'density',value:'compact'}]})),{...base,traits:{...base.traits,report:'interactiveReport',edit:'modal',density:'compact'}});checks++;
  for(const invalid of [{operations:[]},{operations:[{trait:'report',value:'interactiveReport'},{trait:'edit',value:'modal'},{trait:'density',value:'compact'},{trait:'summary',value:'after'}]},{operations:[{trait:'edit',value:'page'},{trait:'edit',value:'modal'}]},{operations:[{trait:'sql',value:'select 1'}]},{operations:[{trait:'edit',value:'javascript:alert(1)'}]},{operations:[{trait:'edit',value:'modal',code:'evil'}]},{operations:[{trait:'edit',value:null}]},{operations:[{trait:'edit',value:'modal'}],extra:true}]){await assert.rejects(()=>proposal(invalid),e=>e.errorNum===20111);checks++;}
  await assert.rejects(()=>proposal('{"operations":[{"trait":"edit","value":"page","value":"modal"}]}'),e=>e.errorNum===20111);checks++;

  assert.deepEqual(await score(evidence()),{eligible:1,fitness:100,taskEffort:100,navigation:100,accessibility:100,performance:100,simplicity:100});checks++;
  const halfway=evidence();halfway.tasks.locateOrder.actions=7;halfway.tasks.filterOrders.actions=9;halfway.tasks.updateOrder.actions=12;halfway.tasks.locateOrder.navigationSteps=2;halfway.tasks.filterOrders.navigationSteps=2;halfway.tasks.updateOrder.navigationSteps=3.5;
  await assert.rejects(()=>score(halfway),e=>e.errorNum===20120);checks++;
  halfway.tasks.updateOrder.navigationSteps=1;halfway.loadMs=2750;halfway.componentCount=35;
  const measured=await score(halfway);
  assert.equal(measured.taskEffort,50);assert.equal(measured.navigation,66.666667);assert.equal(measured.performance,50);assert.equal(measured.simplicity,50);assert.equal(measured.fitness,64.166667);checks++;
  for(const gate of ['compilerValidated','importVerified','authenticationVerified','runtimeVerified','fixtureVerified','databaseChangeVerified','securityVerified']){const m=evidence();m[gate]=false;assert.equal((await score(m)).eligible,0);assert.equal((await score(m)).fitness,0);checks++;}
  for(const gate of ['criticalViolations','seriousViolations','unnamedControls','focusFailures','horizontalOverflow','runtimeErrors']){const m=evidence();m[gate]=1;assert.equal((await score(m)).eligible,0);assert.equal((await score(m)).fitness,0);checks++;}
  const failedTask=evidence();failedTask.tasks.updateOrder.success=false;assert.equal((await score(failedTask)).fitness,0);checks++;
  const wrongViewport=evidence();wrongViewport.viewportsTested=2;assert.equal((await score(wrongViewport)).eligible,0);checks++;
  for(const change of [m=>{delete m.runtimeVerified;},m=>{m.runtimeVerified=1;},m=>{m.runtimeErrors='0';},m=>{m.componentCount=10.5;},m=>{m.loadMs=null;},m=>{m.unknown=true;},m=>{m.genomeFingerprint='0'.repeat(64);},m=>{m.genomeFingerprint='';},m=>{m.fitnessDefinition='';},m=>{m.fitnessDefinition='other';},m=>{m.tasks.locateOrder.extra=1;},m=>{m.tasks.locateOrder.navigationSteps=3;},m=>{m.tasks.locateOrder.actions=0;},m=>{m.tasks.deleteOrder={success:true,actions:1,navigationSteps:0};}]){const m=evidence();change(m);await assert.rejects(()=>score(m),e=>e.errorNum===20120);checks++;}
  await assert.rejects(()=>score(JSON.stringify(evidence()).replace('"runtimeErrors":0','"runtimeErrors":0,"runtimeErrors":0')),e=>e.errorNum===20120);checks++;
  const malformedAfterFailure=evidence();malformedAfterFailure.compilerValidated=false;malformedAfterFailure.securityVerified='false';
  await assert.rejects(()=>score(malformedAfterFailure),e=>e.errorNum===20120);checks++;
  const extremes=evidence();for(const task of Object.values(extremes.tasks)){task.actions=100000;task.navigationSteps=100000;}extremes.loadMs=3600000;extremes.componentCount=100000;
  assert.deepEqual(await score(extremes),{eligible:1,fitness:20,taskEffort:0,navigation:0,accessibility:100,performance:0,simplicity:0});checks++;
  console.log(JSON.stringify({checks,passed:true,fitnessDefinition:'order-lab-task-proxy/2.0.0',schema:sandbox.schema,workspace:sandbox.workspace}));
 }finally{await db.rollback();await db.close();}
}
