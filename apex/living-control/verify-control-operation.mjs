// Authorized native role gate: one genuine DRAFT; no enqueue or worker binding.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import oracledb from 'oracledb';
import {chromium} from 'playwright';
import {observeProtectedState} from './install-control.mjs';
import {validateStatus,validateWatch} from './template/shared-components/static-files/control-contract.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),privateRoot=join(root,'.local/order-lab');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const encode=value=>JSON.stringify(value,null,2)+'\n';
const digest=value=>createHash('sha256').update(value).digest('hex');
export function assertControlOperationPolicy(policy){
 const keys=['schemaVersion','operation','applicationId','schema','workspace','workspaceId','capabilityVersion','seed','generations','materializationBudget','paidRequestBudget','principal','label','workerEnabled','workerBinding','enqueue'];
 assert.ok(policy&&Object.getPrototypeOf(policy)===Object.prototype&&Object.keys(policy).length===keys.length&&keys.every(key=>Object.hasOwn(policy,key)));
 assert.equal(policy.schemaVersion,'1.0');assert.equal(policy.operation,'NATIVE_CONTROL_ONE_DRAFT');assert.equal(policy.applicationId,134);
 assert.equal(policy.schema,'APXGEN_ORDER_LAB');assert.equal(policy.workspace,'APXGEN_ORDER_LAB');assert.ok(Number.isSafeInteger(policy.workspaceId)&&policy.workspaceId>0);
 assert.equal(policy.capabilityVersion,'order-lab-queued-feasibility/1.0');assert.equal(policy.seed,50000);assert.equal(policy.generations,1);assert.equal(policy.materializationBudget,2);assert.equal(policy.paidRequestBudget,0);
 assert.equal(policy.principal,'GENESIS_TEST');assert.equal(policy.label,'Native Order Lab queued feasibility');assert.equal(policy.workerEnabled,false);assert.equal(policy.workerBinding,null);assert.equal(policy.enqueue,false);return true;
}
export function assertDisabledControlOperation(policy,state){
 assertControlOperationPolicy(policy);assert.equal(state.enabled,0);assert.equal(state.workerEnabled,0);
 assert.equal(state.schema,policy.schema);assert.equal(state.workspaceId,policy.workspaceId);assert.equal(state.applicationId,134);
 assert.equal(state.binding,null);assert.equal(state.heartbeat,null);for(const key of ['roles','requests','events'])assert.equal(state[key],0);return true;
}
export async function verifyControlOperation({workerConfigPath,policyPath,evidenceDir}={}){
 for(const value of [workerConfigPath,policyPath,evidenceDir])assert.ok(typeof value==='string'&&value&&!/[\x00-\x1f"]/.test(value));
 for(const path of [policyPath,evidenceDir])assert.ok(resolve(path).startsWith(privateRoot+sep));
 const workerPath=resolve(workerConfigPath),worker=await json(workerPath),oracle=await json(resolve(dirname(workerPath),worker.oracleConfigPath)),policyBytes=await readFile(policyPath),policy=JSON.parse(policyBytes.toString('utf8'));assertControlOperationPolicy(policy);
 assert.equal(oracle.user,policy.schema);assert.equal(oracle.workspace,policy.workspace);assert.equal(oracle.apexUser.toUpperCase(),policy.principal);
 const directory=resolve(evidenceDir);await mkdir(directory);
 const db=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});db.callTimeout=10000;
 const rows=async(sql,binds={})=>(await db.execute(sql,binds,{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
 let browser,stage='ADMISSION',before,controlMetadata;const attemptId=randomUUID().replaceAll('-','');
 const result={kind:'native-control-role-and-draft',attemptId,applicationId:134,verified:false,readerStatusVerified:false,readerWatchVerified:false,readerCreateDenied:false,readerStartDenied:false,operatorCreateVerified:false,operatorStartDenied:false,requestId:null,requestState:null,runId:null,enqueued:false,workerEnabled:false,paidRequests:0,imports:0};
 async function state(lock=false){
  const cfg=(await rows('select * from apxgen_app_control_config where config_id=1'+(lock?' for update nowait':'')))[0];assert.ok(cfg);
  assert.equal(cfg.MAX_GENERATIONS,1);assert.equal(cfg.MAX_MATERIALIZATIONS,2);
  return {enabled:cfg.ENABLED,workerEnabled:cfg.WORKER_ENABLED,schema:cfg.SCHEMA_NAME,workspaceId:cfg.WORKSPACE_ID,applicationId:cfg.CONTROL_APPLICATION_ID,binding:cfg.WORKER_BINDING,heartbeat:cfg.WORKER_SEEN_AT,roles:(await rows('select count(*) n from apxgen_app_control_users'))[0].N,requests:(await rows('select count(*) n from apxgen_app_control_requests'))[0].N,events:(await rows('select count(*) n from apxgen_app_control_events'))[0].N};
 }
 async function save(name,value){await writeFile(join(directory,name),encode(value),{flag:'wx',flush:true});}
 try{
  assert.deepEqual((await db.execute("select user,sys_context('USERENV','CURRENT_SCHEMA'),sys_context('USERENV','SESSION_USER') from dual")).rows[0],[policy.schema,policy.schema,policy.schema]);
  assert.equal((await rows('select count(*) n from apex_workspace_schemas where schema=:owner and workspace_name=:workspace and workspace_id=:workspaceId',{owner:policy.schema,workspace:policy.workspace,workspaceId:policy.workspaceId}))[0].N,1);
  assert.deepEqual(await rows('select application_id,workspace,owner,alias from apex_applications where application_id=134'),[{APPLICATION_ID:134,WORKSPACE:policy.workspace,OWNER:policy.schema,ALIAS:'GENESIS-LIVING-CONTROL'}]);
  const original=await state(true);assertDisabledControlOperation(policy,original);
  before=await observeProtectedState(db);controlMetadata=await rows('select * from apex_applications where application_id=134');
  await save('0001-before-private.json',{state:original,protectedState:before,controlMetadata,policy});
  const record={attemptId,kind:'native-control-one-draft-operation',applicationId:134,principal:policy.principal,policySha256:digest(policyBytes),createdAt:new Date().toISOString()};
  await writeFile(join(privateRoot,'control-draft-134-attempt.json'),encode(record),{flag:'wx',flush:true});
  stage='READER_CONFIGURATION';
  const enabled=await db.execute('update apxgen_app_control_config set enabled=1 where config_id=1 and enabled=0 and worker_enabled=0 and schema_name=:owner and workspace_id=:workspaceId and control_application_id=134 and worker_binding is null and worker_seen_at is null',{owner:policy.schema,workspaceId:policy.workspaceId});assert.equal(enabled.rowsAffected,1);
  await db.execute("insert into apxgen_app_control_users(username,control_role,enabled) values(:principal,'READER',1)",{principal:policy.principal});await db.commit();await save('0002-reader-configured.json',{...record,state:await state(),role:'READER'});
  browser=await chromium.launch({headless:true,channel:process.env.APXGEN_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});const context=await browser.newContext(),page=await context.newPage(),runtimeErrors=[];
  page.on('pageerror',error=>runtimeErrors.push({kind:'pageerror',name:error.name}));
  page.on('response',response=>{if(['script','stylesheet'].includes(response.request().resourceType())&&response.status()>=400)runtimeErrors.push({kind:'http',resourceType:response.request().resourceType(),status:response.status()});});
  const base='http://127.0.0.1:8080/ords/r/'+policy.workspace.toLowerCase()+'/genesis-living-control';
  stage='READER_AUTHENTICATION';await page.goto(base+'/create',{waitUntil:'domcontentloaded'});await page.locator('#P9999_USERNAME').fill(oracle.apexUser);await page.locator('#P9999_PASSWORD').fill(oracle.apexPassword);
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'Sign In',exact:true}).click()]);await page.locator('#living-control').waitFor();
  assert.equal(Number(await page.evaluate(()=>apex.env.APP_ID)),134);assert.equal(await page.evaluate(()=>String(apex.env.APP_USER).toUpperCase()),policy.principal);
  async function callback(action,requestId,payload){
   const [response]=await Promise.all([
    page.waitForResponse(response=>['xhr','fetch'].includes(response.request().resourceType())&&response.request().postData()?.includes(action)),
    page.evaluate(async({action,requestId,payload})=>{try{await apex.server.process('LIVING_CONTROL',{x01:action,x02:requestId||'',x03:payload?JSON.stringify(payload):''},{dataType:'json'});}catch{}},{action,requestId,payload})
   ]);return response.json();
  }
  const payload={label:policy.label,seed:policy.seed,generations:policy.generations,materializationBudget:policy.materializationBudget};
  stage='READER_ROLE_BOUNDARIES';const reader=await callback('STATUS');assert.equal(reader.ok,true);validateStatus(reader.data);assert.equal(reader.data.canCreate,false);assert.equal(reader.data.canStart,false);assert.deepEqual(reader.data.requests,[]);result.readerStatusVerified=true;
  await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent.includes('worker is unavailable'));assert.equal(await page.getByRole('button',{name:'Create draft',exact:true}).isDisabled(),true);
  assert.deepEqual(await callback('CREATE',null,payload),{ok:false,error:'CONTROL_UNAVAILABLE'});result.readerCreateDenied=true;
  assert.deepEqual(await callback('START','0'.repeat(32)),{ok:false,error:'CONTROL_UNAVAILABLE'});result.readerStartDenied=true;
  const session=await page.evaluate(()=>String(apex.env.APP_SESSION));await page.goto(base+'/watch?session='+session,{waitUntil:'domcontentloaded'});await page.locator('#living-control').waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent.includes('worker is unavailable'));assert.equal(await page.locator('[data-observation]').textContent(),'');result.readerWatchVerified=true;
  await page.screenshot({path:join(directory,'reader-watch-private.png'),fullPage:true});assert.equal((await state()).requests,0);
  stage='OPERATOR_CONFIGURATION';const changed=await db.execute("update apxgen_app_control_users set control_role='OPERATOR' where username=:principal and enabled=1 and control_role='READER'",{principal:policy.principal});assert.equal(changed.rowsAffected,1);await db.commit();await save('0003-operator-configured.json',{...record,state:await state(),role:'OPERATOR'});
  stage='REAL_DRAFT_CREATE';await page.goto(base+'/create?session='+session,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Create draft',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-action="CREATE"]').disabled);
  const operator=await callback('STATUS');assert.equal(operator.ok,true);validateStatus(operator.data);assert.equal(operator.data.canCreate,true);assert.equal(operator.data.canStart,false);assert.deepEqual(operator.data.requests,[]);
  await page.locator('[name="label"]').fill(policy.label);
  for(const [name,value]of [['seed','50000'],['generations','1'],['materializationBudget','2']])assert.equal(await page.locator('[name="'+name+'"]').inputValue(),value);
  const [createdResponse]=await Promise.all([page.waitForResponse(response=>['xhr','fetch'].includes(response.request().resourceType())&&response.request().postData()?.includes('CREATE')),page.getByRole('button',{name:'Create draft',exact:true}).click()]);
  const created=await createdResponse.json();assert.equal(created.ok,true);validateWatch(created.data);const actual=created.data.request;
  assert.equal(actual.label,policy.label);assert.equal(actual.state,'DRAFT');assert.equal(actual.runId,null);assert.equal(actual.seed,50000);assert.equal(actual.generations,1);assert.equal(actual.materializationBudget,2);
  result.requestId=actual.id;result.requestState='DRAFT';result.operatorCreateVerified=true;await save('0004-genuine-draft.json',created.data);
  await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent==='Oracle request DRAFT');await page.screenshot({path:join(directory,'operator-draft-created-private.png'),fullPage:true});
  stage='WORKER_ABSENT_START_DENIAL';await page.goto(base+'/evolve?session='+session,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent==='Oracle request DRAFT');assert.equal(await page.getByRole('button',{name:'Start Evolution',exact:true}).isDisabled(),true);
  assert.deepEqual(await callback('START',actual.id),{ok:false,error:'CONTROL_UNAVAILABLE'});result.operatorStartDenied=true;
  const watched=await callback('WATCH',actual.id);assert.equal(watched.ok,true);validateWatch(watched.data);assert.deepEqual(watched.data,created.data);
  await page.screenshot({path:join(directory,'operator-start-disabled-private.png'),fullPage:true});assert.deepEqual(runtimeErrors,[]);
  await context.close();await browser.close();browser=null;
  stage='FINAL_PRESERVATION';
  const after=await observeProtectedState(db);assert.deepEqual(after.hashes,before.hashes);assert.deepEqual(await rows('select * from apex_applications where application_id=134'),controlMetadata);
  const final=await state();assert.deepEqual(final,{enabled:1,workerEnabled:0,schema:policy.schema,workspaceId:policy.workspaceId,applicationId:134,binding:null,heartbeat:null,roles:1,requests:1,events:1});
  assert.deepEqual(await rows('select username,control_role,enabled from apxgen_app_control_users'),[{USERNAME:policy.principal,CONTROL_ROLE:'OPERATOR',ENABLED:1}]);
  const drafts=await rows('select * from apxgen_app_control_requests');assert.equal(drafts.length,1);assert.equal(drafts[0].REQUEST_ID,actual.id);assert.equal(drafts[0].CREATED_BY,policy.principal);assert.equal(drafts[0].STATE,'DRAFT');assert.equal(drafts[0].RUN_ID,null);assert.equal(drafts[0].CLAIM_TOKEN,null);
  assert.deepEqual(await rows('select request_id,state,actor from apxgen_app_control_events'),[{REQUEST_ID:actual.id,STATE:'DRAFT',ACTOR:policy.principal}]);
  await save('0005-after-private.json',{state:final,protectedState:after,controlMetadata,drafts,roles:await rows('select * from apxgen_app_control_users'),events:await rows('select * from apxgen_app_control_events')});
  result.existingStateUnchanged=true;result.beforeHashes=before.hashes;result.afterHashes=after.hashes;result.verified=true;
 }catch(error){result.failureStage=stage;result.failure=/^(ORA|NJS)-\d+$/.test(error.code||'')?error.code:'NATIVE_ROLE_DRAFT_INCOMPLETE';}
 finally{
  if(browser)try{await browser.close();}catch{result.verified=false;result.failure='CONTROL_BROWSER_CLOSE_UNCERTAIN';}
  try{await db.rollback();}catch{result.verified=false;result.failure='CONTROL_TRANSACTION_RELEASE_UNCERTAIN';}
  try{await db.close();}catch{result.verified=false;result.failure='CONTROL_CONNECTION_CLOSE_UNCERTAIN';}
  result.observedAt=new Date().toISOString();await save('operation-result.json',result);
 }
 return {...result,evidenceDir:directory};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const [workerConfigPath,policyPath,evidenceDir]=process.argv.slice(2),result=await verifyControlOperation({workerConfigPath,policyPath,evidenceDir});console.log(JSON.stringify({applicationId:result.applicationId,verified:result.verified,requestId:result.requestId,requestState:result.requestState,runId:result.runId,enqueued:result.enqueued,workerEnabled:result.workerEnabled,existingStateUnchanged:result.existingStateUnchanged,evidenceDir:result.evidenceDir}));if(!result.verified)process.exitCode=1;}catch{console.error('Native role/draft operation refused; preserve its private attempt audit. No automatic retry is permitted.');process.exitCode=1;}}
