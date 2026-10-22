// Genuine native login/read-only UI verification. Never submits Create or Start.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import oracledb from 'oracledb';
import {chromium} from 'playwright';
import {assertControlImportPolicy} from './import-control.mjs';
import {observeProtectedState} from './install-control.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),privateRoot=join(root,'.local/order-lab');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const encode=value=>JSON.stringify(value,null,2)+'\n';
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function verifyNativeControl({workerConfigPath,policyPath,importEvidenceDir,evidenceDir}={}){
 for(const value of [workerConfigPath,policyPath,importEvidenceDir,evidenceDir])assert.ok(typeof value==='string'&&value&&!/[\x00-\x1f"]/.test(value));
 for(const path of [policyPath,importEvidenceDir,evidenceDir])assert.ok(resolve(path).startsWith(privateRoot+sep));
 const workerPath=resolve(workerConfigPath),worker=await json(workerPath),oracle=await json(resolve(dirname(workerPath),worker.oracleConfigPath));
 const policy=await json(policyPath);assertControlImportPolicy(policy);assert.equal(oracle.user,policy.schema);assert.equal(oracle.workspace,policy.workspace);
 const imported=await json(join(importEvidenceDir,'0003-result.json'));assert.equal(imported.importVerified,true);assert.equal(imported.applicationId,134);
 const originalAttempt=await json(join(privateRoot,'control-import-134-attempt.json'));assert.equal(imported.attemptId,originalAttempt.attemptId);assert.equal(originalAttempt.definitionHash,policy.definitionHash);
 assert.equal(digest(await readFile(join(importEvidenceDir,'import-output.txt'))),imported.outputSha256);
 const directory=resolve(evidenceDir);await mkdir(directory);
 const db=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});db.callTimeout=10000;
 const rows=async(sql,binds={})=>(await db.execute(sql,binds,{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
 let browser,stage='OWNER_AND_PRESERVATION';
 const result={kind:'native-control-disabled-runtime',applicationId:134,anonymousRedirectVerified:false,authenticatedSyntheticPrincipalVerified:false,disabledCreateVerified:false,disabledStartVerified:false,readOnlyCallbackRefused:false,workerEnabled:false,configEnabled:false,roles:0,queueRequests:0,paidRequests:0,imports:0,experimentLineage:false};
 async function guard(){
  assert.deepEqual((await db.execute("select user,sys_context('USERENV','CURRENT_SCHEMA') from dual")).rows[0],[policy.schema,policy.schema]);
  assert.deepEqual(await rows('select application_id,workspace,owner,alias from apex_applications where application_id=134'),[{APPLICATION_ID:134,WORKSPACE:policy.workspace,OWNER:policy.schema,ALIAS:policy.alias}]);
  const cfg=(await rows('select enabled,schema_name,workspace_id,control_application_id,worker_enabled,worker_binding,worker_seen_at from apxgen_app_control_config where config_id=1'))[0];
  assert.deepEqual(cfg,{ENABLED:0,SCHEMA_NAME:policy.schema,WORKSPACE_ID:policy.workspaceId,CONTROL_APPLICATION_ID:134,WORKER_ENABLED:0,WORKER_BINDING:null,WORKER_SEEN_AT:null});
  for(const table of ['apxgen_app_control_users','apxgen_app_control_requests','apxgen_app_control_events'])assert.equal((await rows('select count(*) n from '+table))[0].N,0);
 }
 try{
  await guard();const before=await observeProtectedState(db);assert.deepEqual(before.hashes,imported.afterHashes);await writeFile(join(directory,'before-private.json'),encode(before),{flag:'wx'});await db.rollback();
  browser=await chromium.launch({headless:true,channel:process.env.APXGEN_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
  const context=await browser.newContext(),page=await context.newPage(),runtimeErrors=[];
  page.on('pageerror',error=>runtimeErrors.push({kind:'pageerror',name:error.name}));
  page.on('response',response=>{if(['script','stylesheet'].includes(response.request().resourceType())&&response.status()>=400)runtimeErrors.push({kind:'http',resourceType:response.request().resourceType(),status:response.status()});});
  const base='http://127.0.0.1:8080/ords/r/'+policy.workspace.toLowerCase()+'/'+policy.alias.toLowerCase();
  stage='ANONYMOUS_LOGIN_REDIRECT';await page.goto(base+'/create',{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('#P9999_PASSWORD').isVisible(),true);assert.equal(await page.locator('#living-control').count(),0);result.anonymousRedirectVerified=true;
  stage='SYNTHETIC_LOGIN';await page.locator('#P9999_USERNAME').fill(oracle.apexUser);await page.locator('#P9999_PASSWORD').fill(oracle.apexPassword);
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'Sign In',exact:true}).click()]);
  await page.locator('#living-control').waitFor();assert.equal(Number(await page.evaluate(()=>apex.env.APP_ID)),134);
  assert.equal(await page.evaluate(()=>String(apex.env.APP_USER).toUpperCase()),oracle.apexUser.toUpperCase());result.authenticatedSyntheticPrincipalVerified=true;
  stage='DISABLED_CREATE';await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent.includes('An owner must bind'));
  assert.equal(await page.getByRole('button',{name:'Create draft',exact:true}).isDisabled(),true);result.disabledCreateVerified=true;
  const seed=page.locator('[name="seed"]');assert.equal(await seed.inputValue(),'50000');assert.equal(await seed.evaluate(node=>node.readOnly),true);
  stage='DISABLED_READONLY_CALLBACK';
  // APEX rejects its Promise when a valid JSON response contains "error".
  // Verify the actual HTTP response instead of treating that refusal as a fault.
  const [callbackResponse]=await Promise.all([
   page.waitForResponse(response=>['xhr','fetch'].includes(response.request().resourceType())&&response.request().postData()?.includes('STATUS')),
   page.evaluate(async()=>{try{await apex.server.process('LIVING_CONTROL',{x01:'STATUS'},{dataType:'json'});}catch{}})
  ]);
  const denied=await callbackResponse.json();assert.deepEqual(denied,{ok:false,error:'CONTROL_UNAVAILABLE'});result.readOnlyCallbackRefused=true;
  await page.screenshot({path:join(directory,'create-disabled-private.png'),fullPage:true});
  const session=await page.evaluate(()=>String(apex.env.APP_SESSION));
  stage='DISABLED_EVOLVE';await page.goto(base+'/evolve?session='+session,{waitUntil:'domcontentloaded'});assert.equal(Number(await page.evaluate(()=>apex.env.APP_ID)),134);
  await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent.includes('An owner must bind'));
  assert.equal(await page.getByRole('button',{name:'Start Evolution',exact:true}).isDisabled(),true);result.disabledStartVerified=true;
  await page.screenshot({path:join(directory,'evolve-disabled-private.png'),fullPage:true});
  stage='DISABLED_WATCH';await page.goto(base+'/watch?session='+session,{waitUntil:'domcontentloaded'});assert.equal(Number(await page.evaluate(()=>apex.env.APP_ID)),134);
  await page.waitForFunction(()=>document.querySelector('[data-status]')?.textContent.includes('An owner must bind'));
  assert.equal(await page.locator('[data-observation]').textContent(),'');assert.equal(await page.locator('[data-requests] option').count(),0);
  await page.screenshot({path:join(directory,'watch-disabled-private.png'),fullPage:true});
  assert.deepEqual(runtimeErrors,[]);result.runtimeErrors=0;
  await context.close();await browser.close();browser=null;
  stage='FINAL_PRESERVATION';await db.rollback();await guard();const after=await observeProtectedState(db);assert.deepEqual(after.hashes,before.hashes);await writeFile(join(directory,'after-private.json'),encode(after),{flag:'wx'});
  result.existingStateUnchanged=true;result.beforeHashes=before.hashes;result.afterHashes=after.hashes;result.verified=true;
 }catch(error){result.verified=false;result.failureStage=stage;result.failure=/^(ORA|NJS)-\d+$/.test(error.code||'')?error.code:'NATIVE_CONTROL_RUNTIME_INCOMPLETE';}
 finally{
  if(browser)try{await browser.close();}catch{result.verified=false;result.failure='CONTROL_BROWSER_CLOSE_UNCERTAIN';}
  try{await db.rollback();}catch{result.verified=false;result.failure='CONTROL_GUARD_RELEASE_UNCERTAIN';}
  try{await db.close();}catch{result.verified=false;result.failure='CONTROL_CONNECTION_CLOSE_UNCERTAIN';}
  result.observedAt=new Date().toISOString();await writeFile(join(directory,'verification-result.json'),encode(result),{flag:'wx'});
 }
 return {...result,evidenceDir:directory};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const [workerConfigPath,policyPath,importEvidenceDir,evidenceDir]=process.argv.slice(2),result=await verifyNativeControl({workerConfigPath,policyPath,importEvidenceDir,evidenceDir});console.log(JSON.stringify({applicationId:result.applicationId,verified:result.verified,anonymousRedirectVerified:result.anonymousRedirectVerified,authenticatedSyntheticPrincipalVerified:result.authenticatedSyntheticPrincipalVerified,disabledCreateVerified:result.disabledCreateVerified,disabledStartVerified:result.disabledStartVerified,existingStateUnchanged:result.existingStateUnchanged,evidenceDir:result.evidenceDir}));if(!result.verified)process.exitCode=1;}catch{console.error('Disabled native control verification refused; inspect private evidence without copying account or session details.');process.exitCode=1;}}
