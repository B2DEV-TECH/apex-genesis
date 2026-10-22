import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import oracledb from 'oracledb';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { buildApplicationDefinition } from './build-definition.mjs';
import { validateApplicationDefinition } from './validate-definition.mjs';
import { importApplicationDefinition } from './import-definition.mjs';
import { validateSandboxPolicy, assertSandboxIdentity } from '../../runtime/application/sandbox.mjs';
import { canonicalApplicationGenome } from '../../evolution/application/genome.mjs';
import { runOrderLabTasks } from '../../runtime/application/tasks.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const booleans = ['compilerValidated','importVerified','authenticationVerified','runtimeVerified','fixtureVerified','databaseChangeVerified','securityVerified'];
const counters = ['viewportsTested','criticalViolations','seriousViolations','unnamedControls','focusFailures','horizontalOverflow','runtimeErrors','loadMs','componentCount'];

export function oracleMetricsFromObservations(genomeFingerprint, observations) {
  assert.match(genomeFingerprint, /^[a-f0-9]{64}$/);
  const result = { fitnessDefinition:'order-lab-task-proxy/2.0.0',protocolVersion:'application-fitness-2.0',genomeFingerprint };
  for (const name of booleans) { assert.equal(typeof observations[name], 'boolean', `Unobserved gate ${name}`); result[name] = observations[name]; }
  result.tasks = {};
  for (const name of ['locateOrder','filterOrders','updateOrder']) {
    const observed = observations.tasks?.[name];
    assert.equal(typeof observed?.success, 'boolean', `Unobserved task ${name}`);
    for (const field of ['actions','navigationSteps']) assert.ok(Number.isSafeInteger(observed[field]) && observed[field] >= 0);
    result.tasks[name] = { success:observed.success,actions:observed.actions,navigationSteps:observed.navigationSteps };
  }
  for (const name of counters) { assert.ok(Number.isSafeInteger(observations[name]) && observations[name] >= 0, `Unobserved counter ${name}`); result[name] = observations[name]; }
  return result;
}

function safeFailure(error) {
  if (/^(ORA|NJS)-\d+$/.test(error.code || '')) return error.code;
  return { name:error.name || 'Error',message:String(error.message || 'Evaluator failed').split('\n')[0].replace(/https?:\/\/\S+/g,'[PRIVATE_URL]').replace(/session[=:]\d+/gi,'session=[REDACTED]').slice(0,220) };
}

async function save(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + '\n'); }

async function sourceFiles(directory, prefix='') {
  const files=[];
  for(const entry of await readdir(join(directory,prefix),{withFileTypes:true})) {
    const path=prefix?prefix+'/'+entry.name:entry.name;
    if(entry.isDirectory())files.push(...await sourceFiles(directory,path));else if(entry.isFile())files.push(path);
  }
  return files.sort();
}

function assertResetFixture(rows,audit) {
  const statuses=['NEW','PROCESSING','DELAYED','SHIPPED','COMPLETED'];
  const expected=Array.from({length:40},(_,index)=>{const i=index+1;return {orderId:1000+i,customerName:'Synthetic Customer '+String(i).padStart(2,'0'),status:statuses[i%5],orderTotal:100+i*17.25};});
  assert.deepEqual(rows,expected,'Exact fixed synthetic fixture differs');
  assert.equal(audit.length,40);
  for(let index=0;index<audit.length;index++){assert.equal(audit[index].orderId,expected[index].orderId);assert.equal(audit[index].status,expected[index].status);assert.equal(audit[index].rowVersion,0);assert.equal(audit[index].updatedBy,'FIXTURE_RESET');assert.ok(Number.isFinite(Date.parse(audit[index].updatedAt)));}
  return true;
}

async function browserMeasurements({page, home, fixture, directory}) {
  const samples = [], scans = [], screenshots = [];
  const counters = { viewportsTested:0,criticalViolations:0,seriousViolations:0,unnamedControls:0,focusFailures:0,horizontalOverflow:0 };
  await fixture.reset(); await home();
  await page.getByLabel('Order ID',{exact:true}).fill('');
  await page.getByLabel('Status',{exact:true}).selectOption('');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'Apply filters',exact:true}).click()]);
  await home(); // Warm-up is excluded from the three recorded navigation timings.
  for (let i=0;i<3;i++) { await fixture.reset(); const start=performance.now(); await home(); samples.push(Math.ceil(performance.now()-start)); }
  for (const width of [390,768,1440]) {
    await page.setViewportSize({width,height:1000}); await fixture.reset(); await home();
    await page.getByLabel('Order ID',{exact:true}).fill('');
    await page.getByLabel('Status',{exact:true}).selectOption('');
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'Apply filters',exact:true}).click()]);
    for (const view of ['report','edit']) {
      if (view === 'edit') {
        await page.getByLabel('Order ID',{exact:true}).fill('1002');
        await page.getByLabel('Status',{exact:true}).selectOption('');
        await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'Apply filters',exact:true}).click()]);
        await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('link',{name:'1002',exact:true}).click()]);
      }
      const axe = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      const violations = axe.violations.map(rule=>({id:rule.id,impact:rule.impact,nodes:rule.nodes.map(node=>({target:node.target}))}));
      counters.criticalViolations += axe.violations.filter(rule=>rule.impact==='critical').reduce((n,rule)=>n+rule.nodes.length,0);
      counters.seriousViolations += axe.violations.filter(rule=>rule.impact==='serious').reduce((n,rule)=>n+rule.nodes.length,0);
      counters.unnamedControls += axe.violations.filter(rule=>['button-name','label','link-name','select-name','input-button-name','aria-input-field-name'].includes(rule.id)).reduce((n,rule)=>n+rule.nodes.length,0);
      const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1 || document.body.scrollWidth>innerWidth+1);
      counters.horizontalOverflow += Number(overflow);
      await page.locator(view==='report'?'#P1_ORDER_ID':'#P2_STATUS').focus(); await page.keyboard.press('Tab');
      const focusStarted=performance.now();
      try {
        await page.waitForFunction(()=>{const element=document.activeElement,style=getComputedStyle(element);return element.matches(':focus-visible')&&((style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>=1)||style.boxShadow!=='none');},null,{timeout:500});
      }catch(error){if(error.name!=='TimeoutError')throw error;}
      const focus = await page.evaluate(()=>{const element=document.activeElement,style=getComputedStyle(element);return {tag:element.tagName,id:element.id,keyboardVisible:element.matches(':focus-visible'),visibleIndicator:(style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>0)||style.boxShadow!=='none'};});
      focus.observationWaitMs=Math.ceil(performance.now()-focusStarted);
      counters.focusFailures += Number(!focus.keyboardVisible || !focus.visibleIndicator);
      scans.push({width,view,violations,overflow,focus,axeVersion:axe.testEngine.version});
      if (view==='report') {
        await page.evaluate(()=>window.scrollTo(0,0));
        const bounds=await page.locator('.t-Body-content').boundingBox(),header=await page.locator('.t-Header').boundingBox();
        const viewport=page.viewportSize(),x=Math.max(0,bounds.x),y=Math.max(0,bounds.y,header?header.y+header.height:0)+2;
        const clip={x,y,width:Math.min(bounds.x+bounds.width,viewport.width)-x,height:Math.min(bounds.y+bounds.height,viewport.height)-y};
        assert.ok(clip.width>0&&clip.height>0);
        const path=join(directory,`orders-${width}.png`); await page.screenshot({path,clip,captureBeyondViewport:false});
        screenshots.push({width,path:relative(root,path).replaceAll('\\','/'),sha256:digest(await readFile(path)),crop:'visible content below header',captureMethod:'Playwright browser screenshot with viewport clip; no image editing',clip});
      }
    }
    counters.viewportsTested++;
  }
  return {...counters,loadMs:[...samples].sort((a,b)=>a-b)[1],warmLoadSamplesMs:samples,scans,screenshots};
}

export async function runApplicationSmoke(configPath, { applicationIds,canaryApplicationId }={}) {
  if (!configPath) throw new TypeError('Explicit application sandbox worker configuration required');
  oracledb.fetchAsString = [oracledb.CLOB];
  const configurationPath=resolve(configPath),configuration=await json(configurationPath);
  const policy=await json(resolve(dirname(configurationPath),configuration.sandboxPolicyPath)); validateSandboxPolicy(policy);
  const oracle=await json(resolve(dirname(configurationPath),configuration.oracleConfigPath));
  assert.equal(oracle.user,policy.schema);assert.equal(oracle.workspace,policy.workspace);
  assert.ok(Array.isArray(applicationIds)&&applicationIds.length===2&&new Set(applicationIds).size===2&&applicationIds.every(id=>Number.isSafeInteger(id)&&policy.applicationIds.includes(id)&&!policy.protectedApplicationIds.includes(id)));
  assert.ok(Number.isSafeInteger(canaryApplicationId)&&policy.applicationIds.includes(canaryApplicationId)&&!applicationIds.includes(canaryApplicationId)&&!policy.protectedApplicationIds.includes(canaryApplicationId),'An explicit distinct owned isolation canary is required');
  assert.equal(typeof oracle.apexUser,'string');assert.equal(typeof oracle.apexPassword,'string');
  const sqlclPath=resolve(dirname(configurationPath),configuration.sqlclPath);
  const db=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});
  const options={outFormat:oracledb.OUT_FORMAT_OBJECT};
  let browser, runId, runDirectory, activeOrganism;
  const result={kind:'real-apex-feasibility',releaseReady:false,algorithmComparison:false,paidRequests:0,applicationIds,candidates:[]};
  try {
    const identity=(await db.execute("select sys_context('USERENV','CURRENT_SCHEMA') schema_name,sys_context('USERENV','SESSION_USER') session_user,sys_context('USERENV','DB_NAME') database_name,sys_context('USERENV','CON_NAME') container_name from dual",{},options)).rows[0];
    const mapping=(await db.execute('select workspace,workspace_id from apex_workspaces where workspace=:workspace',{workspace:policy.workspace},options)).rows;
    assert.equal(identity.SESSION_USER,policy.schema);assert.equal(mapping.length,1);
    assertSandboxIdentity(policy,{schema:identity.SCHEMA_NAME,workspace:mapping[0].WORKSPACE,workspaceId:mapping[0].WORKSPACE_ID});
    const expectedDatabase={databaseName:identity.DATABASE_NAME,containerName:identity.CONTAINER_NAME};
    const canaries=(await db.execute("select s.owner_run_id,s.owner_organism_id,s.workspace_id,s.fixture_version,s.slot_state,case when s.lease_until>systimestamp then 1 else 0 end lease_current,a.owner,a.workspace,o.application_id,o.artifact_hash,o.state organism_state,r.state run_state from genesis_order_lab_slots s join apex_applications a on a.application_id=s.application_id join apxgen_app_organisms o on o.organism_id=s.owner_organism_id and o.run_id=s.owner_run_id join apxgen_app_runs r on r.run_id=s.owner_run_id where s.application_id=:id",{id:canaryApplicationId},options)).rows;
    assert.equal(canaries.length,1,'Exactly one installed and durably owned isolation canary required');
    const canary=canaries[0];assert.equal(canary.WORKSPACE_ID,policy.workspaceId);assert.equal(canary.WORKSPACE,policy.workspace);assert.equal(canary.OWNER,policy.schema);assert.equal(canary.FIXTURE_VERSION,'order-lab/1.0');assert.equal(canary.SLOT_STATE,'ACTIVE');assert.equal(canary.LEASE_CURRENT,1);assert.equal(canary.APPLICATION_ID,canaryApplicationId);assert.ok(['SELECTED','REJECTED'].includes(canary.ORGANISM_STATE));assert.ok(['FAILED','COMPLETE'].includes(canary.RUN_STATE));assert.match(canary.ARTIFACT_HASH,/^[a-f0-9]{64}$/);
    result.isolationCanary={applicationId:canaryApplicationId,ownerRunId:canary.OWNER_RUN_ID,ownerOrganismId:canary.OWNER_ORGANISM_ID,definitionHash:canary.ARTIFACT_HASH,readOnly:true};
    for(const applicationId of applicationIds) {
      assert.equal((await db.execute('select application_id from apex_applications where application_id=:id',{id:applicationId})).rows.length,0,'Fresh target application required');
      assert.equal((await db.execute('select application_id from genesis_order_lab_slots where application_id=:id',{id:applicationId})).rows.length,0,'Fresh unregistered slot required');
    }
    const protocolPath=join(root,'experiments/configurations/application-feasibility-v1.json');
    const protocolBytes=await readFile(protocolPath); result.protocolHash=digest(protocolBytes);
    assert.equal(result.protocolHash,'7bd821284d54a7740a7d1b8f79b672960f4dc9ca98387179fdd481ab0479ccc3','Preregistered protocol changed');
    const created=await db.execute("begin :run_id:=apxgen_app_evolution.create_run(50000,1,2,'Order Lab first real materialization loop');end;",{run_id:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32}});
    runId=created.outBinds.run_id;await db.commit();result.runId=runId;
    runDirectory=join(root,'.local/order-lab/runs',runId);await mkdir(runDirectory,{recursive:true});
    const sources=['scripts/application/run-smoke.mjs','scripts/application/build-definition.mjs','scripts/application/validate-definition.mjs','scripts/application/import-definition.mjs','runtime/application/tasks.mjs','evolution/application/genome.mjs','evolution/genome-schema/application-genome.schema.json','apex/order-lab/parent-source.json','database/packages/apxgen_app_fitness.sql','database/packages/apxgen_app_genome.sql','database/packages/apxgen_app_evolution.sql','database/packages/genesis_order_lab.sql','database/migrations/007_order_lab_fixture.sql','database/migrations/008_application_evolution.sql','database/migrations/009_application_import_attempts.sql','experiments/configurations/application-feasibility-v1.json',...(await sourceFiles(join(root,'apex/order-lab/template'))).map(path=>'apex/order-lab/template/'+path)];
    result.sourceHashes=await Promise.all(sources.map(async path=>({path,sha256:digest(await readFile(join(root,path)))})));
    browser=await chromium.launch();result.browserVersion=browser.version();
    for(let generation=0;generation<=1;generation++) {
      let organism;
      if(generation===0) organism=(await db.execute('select organism_id,genome_json,genome_hash,parent_id from apxgen_app_organisms where run_id=:run_id and generation=0',{run_id:runId},options)).rows[0];
      else {
        const next=await db.execute('begin :organism_id:=apxgen_app_evolution.next_candidate(:run_id);end;',{run_id:runId,organism_id:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32}});await db.commit();
        organism=(await db.execute('select organism_id,genome_json,genome_hash,parent_id from apxgen_app_organisms where organism_id=:id',{id:next.outBinds.organism_id},options)).rows[0];
      }
      assert.ok(organism);activeOrganism=organism.ORGANISM_ID;
      const applicationId=applicationIds[generation],alias=`GENESIS-ORDER-${applicationId}`,leaseToken=randomBytes(16).toString('hex');
      const candidate={organismId:activeOrganism,parentId:organism.PARENT_ID,generation,applicationId,genome:JSON.parse(organism.GENOME_JSON),genomeHash:organism.GENOME_HASH,stages:[],runtimeVerified:false};
      result.candidates.push(candidate);console.log(JSON.stringify({runId,generation,applicationId,stage:'GENOME_CREATED'}));
      assert.equal(digest(canonicalApplicationGenome(candidate.genome)),candidate.genomeHash,'Oracle and boundary genome hashes differ');
      const directory=join(runDirectory,activeOrganism);await mkdir(directory);
      const phase=async(state,artifactHash=null,appId=null)=>{await db.execute('begin apxgen_app_evolution.record_phase(:organism_id,:state,:artifact_hash,:application_id);end;',{organism_id:activeOrganism,state,artifact_hash:artifactHash,application_id:appId});await db.commit();candidate.stages.push(state);};
      const parentHash=generation===0?null:result.candidates[0].definitionHash;
      const built=await buildApplicationDefinition(candidate.genome,{outputDir:join(directory,'definition'),parentDefinitionHash:parentHash});candidate.definitionHash=built.definitionHash;candidate.definitionManifest=relative(root,built.manifestPath).replaceAll('\\','/');
      await phase('DEFINITION_GENERATED',built.definitionHash);await phase('VALIDATION_STARTED');
      const compiler=await validateApplicationDefinition({appPath:built.appPath,evidenceDir:join(directory,'compiler'),sqlclPath});
      candidate.compilerEvidence=relative(root,compiler.evidencePath).replaceAll('\\','/');assert.equal(compiler.compilerValid,true,'Real compiler validation failed');await phase('VALIDATED');
      await db.execute("insert into genesis_order_lab_slots(application_id,workspace_id,approved_username,owner_run_id,owner_organism_id,lease_token,lease_until,slot_state) values(:application_id,:workspace_id,:username,:run_id,:organism_id,:token,systimestamp+numtodsinterval(4,'HOUR'),'ACTIVE')",{application_id:applicationId,workspace_id:policy.workspaceId,username:oracle.apexUser.toUpperCase(),run_id:runId,organism_id:activeOrganism,token:leaseToken});await db.commit();
      await phase('IMPORT_STARTED',null,applicationId);
      const imported=await importApplicationDefinition({configPath:configurationPath,appPath:built.appPath,compilerEvidencePath:compiler.evidencePath,applicationId,runId,organismId:activeOrganism,leaseToken,alias,expectedDatabase,evidenceDir:join(directory,'import')});
      candidate.importEvidence=relative(root,imported.evidencePath).replaceAll('\\','/');assert.equal(imported.importVerified,true,'Guarded import did not verify');await phase('IMPORTED');
      console.log(JSON.stringify({runId,generation,applicationId,stage:'IMPORTED'}));
      const fixture={
        reset:async()=>{
          const reset=await db.execute('begin genesis_order_lab.reset_fixture(:application_id,:token);:fixture_hash:=genesis_order_lab.fixture_hash(:application_id,:token);end;',{application_id:applicationId,token:leaseToken,fixture_hash:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:64}});await db.commit();
          const observedHash=reset.outBinds.fixture_hash;assert.match(observedHash,/^[a-f0-9]{64}$/);
          if(result.initialFixtureHash)assert.equal(observedHash,result.initialFixtureHash,'Fixture hash changed across equivalent resets/candidates');else result.initialFixtureHash=observedHash;
          assertResetFixture(await fixture.snapshot(),await fixture.auditSnapshot());candidate.fixtureVerified=true;candidate.fixtureHash=observedHash;
        },
        snapshot:async()=>{const rows=(await db.execute('select order_id,customer_name,status,order_total from genesis_orders where application_id=:id order by order_id',{id:applicationId},options)).rows;return rows.map(row=>({orderId:row.ORDER_ID,customerName:row.CUSTOMER_NAME,status:row.STATUS,orderTotal:row.ORDER_TOTAL}));},
        auditSnapshot:async()=>{const rows=(await db.execute("select order_id,status,row_version,updated_by,to_char(sys_extract_utc(updated_at),'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"') updated_at from genesis_orders where application_id=:id order by order_id",{id:applicationId},options)).rows;return rows.map(row=>({orderId:row.ORDER_ID,status:row.STATUS,rowVersion:row.ROW_VERSION,updatedBy:row.UPDATED_BY,updatedAt:row.UPDATED_AT}));}
      };
      await fixture.reset();assert.equal((await fixture.snapshot()).length,40);
      const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(20000);
      const runtimeErrors=[];page.on('pageerror',error=>runtimeErrors.push({kind:'pageerror',failure:safeFailure(error)}));
      const requiredType=request=>['document','script','xhr','fetch'].includes(request.resourceType())&&request.url().startsWith('http://127.0.0.1:8080/');
      page.on('requestfailed',request=>{if(requiredType(request)&&request.failure()?.errorText!=='net::ERR_ABORTED')runtimeErrors.push({kind:'requestfailed',resourceType:request.resourceType(),error:request.failure()?.errorText});});
      page.on('response',response=>{if(requiredType(response.request())&&response.status()>=400)runtimeErrors.push({kind:'http',resourceType:response.request().resourceType(),status:response.status()});});
      const startUrl=`http://127.0.0.1:8080/ords/r/${policy.workspace.toLowerCase()}/${alias.toLowerCase()}/orders`;
      await page.goto(startUrl,{waitUntil:'domcontentloaded'});assert.equal(await page.locator('#P9999_PASSWORD').isVisible(),true,'Anonymous access was not redirected to login');assert.equal(await page.getByRole('button',{name:'Apply filters',exact:true}).count(),0);
      candidate.anonymousAccessBlocked=true;
      await page.locator('#P9999_USERNAME').fill(oracle.apexUser);await page.locator('#P9999_PASSWORD').fill(oracle.apexPassword);
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'Sign In',exact:true}).click()]);
      await page.getByRole('button',{name:'Apply filters',exact:true}).waitFor();assert.equal(Number(await page.evaluate(()=>apex.env.APP_ID)),applicationId);
      candidate.authenticationVerified=true;candidate.runtimeVerified=true;await phase('RUNTIME_VERIFIED');
      const session=String(await page.evaluate(()=>apex.env.APP_SESSION));
      const home=async()=>{await page.goto(startUrl+'?session='+session,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Apply filters',exact:true}).waitFor();assert.equal(Number(await page.evaluate(()=>apex.env.APP_ID)),applicationId);};
      const security={anonymousBlocked:true,directWorkerRejected:false,wrongPrincipalReadDenied:false,wrongPrincipalWriteDenied:false};
      const original=await fixture.auditSnapshot();
      try{await db.execute("begin genesis_order_lab.update_status(1002,'SHIPPED');end;");}catch(error){security.directWorkerRejected=error.errorNum===20131;}await db.rollback();assert.deepEqual(await fixture.auditSnapshot(),original);
      const denied=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});let deniedSession;
      try {
        const attached=await denied.execute("begin apex_util.set_security_group_id(:workspace_id);apex_session.create_session(p_app_id=>:application_id,p_page_id=>1,p_username=>'GENESIS_DENIED');:session_id:=apex_application.g_instance;end;",{workspace_id:policy.workspaceId,application_id:applicationId,session_id:{dir:oracledb.BIND_OUT,type:oracledb.NUMBER}});deniedSession=attached.outBinds.session_id;
        security.wrongPrincipalReadDenied=(await denied.execute('select count(*) from GENESIS_ORDERS_SAFE_V')).rows[0][0]===0;
        try{await denied.execute("begin genesis_order_lab.update_status(1002,'SHIPPED');end;");}catch(error){security.wrongPrincipalWriteDenied=error.errorNum===20131;}
      }finally{if(deniedSession)await denied.execute('begin apex_session.delete_session(:session_id);end;',{session_id:deniedSession});await denied.rollback();await denied.close();}
      assert.deepEqual(await fixture.auditSnapshot(),original);candidate.security=security;
      const isolationId=canaryApplicationId;
      assert.notEqual(applicationId,isolationId,'The preserved failed application is the read-only isolation partition');
      const isolationSnapshot=async()=>(await db.execute("select order_id,customer_name,status,order_total,row_version,updated_by,to_char(sys_extract_utc(updated_at),'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"') updated_at from genesis_orders where application_id=:id order by order_id",{id:isolationId},options)).rows;
      const otherBefore=await isolationSnapshot();assert.equal(otherBefore.length,40,'Known other-owned partition required for isolation probe');
      assert.equal(otherBefore.some(row=>row.ORDER_ID===1040),true,'Other-owned sentinel required');
      const removed=await db.execute('delete from genesis_orders where application_id=:id and order_id=1040',{id:applicationId});assert.equal(removed.rowsAffected,1);await db.commit();
      const probe=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});let attachedProbe=false;
      try {
        await probe.execute('begin apex_util.set_security_group_id(:workspace_id);apex_session.attach(p_app_id=>:application_id,p_page_id=>1,p_session_id=>:session_id);end;',{workspace_id:policy.workspaceId,application_id:applicationId,session_id:Number(session)});attachedProbe=true;
        security.crossOwnedReadDenied=(await probe.execute('select count(*) from GENESIS_ORDERS_SAFE_V where order_id=1040')).rows[0][0]===0;
        try{await probe.execute("begin genesis_order_lab.update_status(1040,'SHIPPED');end;");security.crossOwnedWriteDenied=false;}catch(error){security.crossOwnedWriteDenied=error.errorNum===20131;}
      }finally{if(attachedProbe)await probe.execute('begin apex_session.detach;end;');await probe.rollback();await probe.close();await fixture.reset();}
      assert.deepEqual(await isolationSnapshot(),otherBefore,'Other-owned partition changed during denial probe');
      candidate.crossPartitionProbe={shadowApplicationId:isolationId,sentinelOrderId:1040,currentSentinelTemporarilyAbsent:true,readDenied:security.crossOwnedReadDenied,writeDenied:security.crossOwnedWriteDenied,shadowUnchanged:true,currentFixtureRestored:true};
      await phase('TESTING');
      const tasks=await runOrderLabTasks({page,applicationId,home,fixture,principal:oracle.apexUser.toUpperCase()});candidate.taskEvidence=tasks;
      assert.deepEqual(await isolationSnapshot(),otherBefore,'Other-owned partition changed during actual UI tasks');
      candidate.security=security;
      const measurement=await browserMeasurements({page,home,fixture,directory});candidate.browserMeasurements=measurement;candidate.runtimeErrors=runtimeErrors;
      let componentCount=0;for(const view of ['apex_application_pages','apex_application_page_regions','apex_application_page_items','apex_application_page_da']) componentCount+=(await db.execute(`select count(*) from ${view} where application_id=:id and page_id not in(0,9999)`,{id:applicationId})).rows[0][0];
      for(const source of result.sourceHashes)assert.equal(digest(await readFile(join(root,source.path))),source.sha256,'Evaluator source changed during the run');
      const metrics=oracleMetricsFromObservations(candidate.genomeHash,{compilerValidated:compiler.compilerValid,importVerified:imported.importVerified,authenticationVerified:candidate.authenticationVerified,runtimeVerified:candidate.runtimeVerified,fixtureVerified:candidate.fixtureVerified,databaseChangeVerified:tasks.databaseChangeVerified,securityVerified:Object.values(security).every(value=>value===true),tasks:tasks.tasks,...measurement,runtimeErrors:runtimeErrors.length,componentCount});
      candidate.metrics=metrics;await save(join(directory,'candidate-evidence.json'),candidate);
      await db.execute('begin apxgen_app_evolution.evaluate(:organism_id,:metrics);apxgen_app_evolution.decide(:organism_id);end;',{organism_id:activeOrganism,metrics:{val:JSON.stringify(metrics),type:oracledb.CLOB}});await db.commit();
      const decision=(await db.execute('select state,eligible,fitness,selected,reason from apxgen_app_organisms where organism_id=:id',{id:activeOrganism},options)).rows[0];candidate.oracleDecision=decision;
      candidate.oracleEvents=(await db.execute("select event_id,state,detail,to_char(sys_extract_utc(recorded_at),'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"') recorded_at from apxgen_app_events where organism_id=:id order by event_id",{id:activeOrganism},options)).rows;
      candidate.importAttempt=(await db.execute("select attempt_id,state,error_code,to_char(sys_extract_utc(created_at),'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"') created_at,to_char(sys_extract_utc(completed_at),'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"') completed_at from apxgen_app_import_attempts where organism_id=:id",{id:activeOrganism},options)).rows;
      await save(join(directory,'candidate-evidence.json'),candidate);await context.close();
      console.log(JSON.stringify({runId,generation,applicationId,stage:decision.STATE,eligible:decision.ELIGIBLE,fitness:decision.FITNESS}));
      if(generation===0&&decision.SELECTED!==1)break;
    }
  }catch(error){
    result.failure=safeFailure(error);
    if(activeOrganism){try{await db.execute('begin apxgen_app_evolution.reject(:id,:reason);end;',{id:activeOrganism,reason:'Real smoke incomplete; inspect private recorded evidence'});await db.commit();}catch{await db.rollback();}}
  }finally{
    if(runId){result.oracleRun=(await db.execute('select state,materializations,materialization_budget,current_generation,best_organism_id from apxgen_app_runs where run_id=:id',{id:runId},options)).rows[0];result.completedCandidates=result.candidates.filter(candidate=>candidate.oracleDecision).length;result.protocolCompleted=result.completedCandidates===2&&result.oracleRun.STATE==='COMPLETE';if(runDirectory)await save(join(runDirectory,'run-evidence.json'),result);}
    if(browser)await browser.close();await db.close();
  }
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const applicationIds=JSON.parse(process.argv[3]),canaryApplicationId=Number(process.argv[4]);const result=await runApplicationSmoke(process.argv[2],{applicationIds,canaryApplicationId});console.log(JSON.stringify({runId:result.runId,completedCandidates:result.completedCandidates,protocolCompleted:result.protocolCompleted,oracleRun:result.oracleRun,failure:result.failure},null,2));if(!result.protocolCompleted)process.exitCode=1;}
  catch(error){console.error(JSON.stringify(safeFailure(error)));process.exitCode=1;}
}
