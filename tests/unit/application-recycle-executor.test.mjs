import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture as recyclingFixture, sha, otherId } from './application-recycling-fixture.mjs';
import { createRecyclingAuthorization, recyclingAuthorizationHash } from '../../scripts/application/recycle-policy.mjs';
import { preserveOriginalCandidateEvidence, assertTerminalRecycleApproval, assertRecycleQuiescence, executeTerminalRecycle, prepareTerminalApplicationRecycle, recycleTerminalApplication } from '../../scripts/application/recycle-application.mjs';
import {acquireCoordinatorLock,releaseCoordinatorLock} from '../../runtime/application/coordinator-lock.mjs';
const fixture=fn=>recyclingFixture(fn,{bestOrganismId:otherId});

async function setup(options) {
  const authorization=await createRecyclingAuthorization(options);
  const approval={mode:'RECYCLE_TERMINAL_OWNED_APPLICATION',schema:options.policy.schema,workspace:options.policy.workspace,workspaceId:options.policy.workspaceId,...options.request,policyHash:authorization.policyHash,expectedDatabase:{databaseName:'FREE',containerName:'FREEPDB1'}};
  approval.mode='RECYCLE_TERMINAL_OWNED_APPLICATION';
  const orders=JSON.parse(await readFile(join(options.preservation.snapshotDir,'orders.json'),'utf8'));
  const canaries=JSON.parse(await readFile(join(options.preservation.snapshotDir,'canaries.json'),'utf8'));
  const state={observation:structuredClone(options.observed),orders,canaries,log:[],attempt:null,apiCalls:0,deleted:false,commits:0};
  const backend={
    async observe(){state.log.push('observe');return structuredClone(state.observation);},
    async currentPolicy(){return structuredClone(options.policy);},
    async fixture(){return structuredClone(state.orders);},
    async canaries(){state.log.push('canaries');return structuredClone(state.canaries);},
    async startAttempt(id,auth){state.log.push('STARTED');state.attempt={attemptId:id,organismId:auth.organismId,runId:auth.runId,applicationId:auth.applicationIds[0],genomeHash:auth.genomeHash,definitionHash:auth.definitionHash,policyHash:auth.policyHash,archiveManifestSha256:auth.archiveManifestSha256,snapshotManifestSha256:auth.snapshotManifestSha256,evidenceManifestSha256:auth.evidenceManifestSha256,authorizationHash:recyclingAuthorizationHash(auth),state:'STARTED',completed:false};state.observation.cleanupAttempts=[state.attempt];},
    async commit(){state.log.push('commit');state.commits++;},
    async rollback(){state.log.push('rollback');},
    async removeApplication(){state.log.push('API');state.apiCalls++;state.observation.application=null;},
    async deleteOwnedRows(){state.log.push('delete-owned');state.deleted=true;state.orders=[];return {orders:40,slots:1};},
    async absence(){return {applications:state.observation.application===null?0:1,orders:state.orders.length,slots:state.deleted?0:1};},
    async finishAttempt(id,value){state.log.push(value);assert.equal(id,state.attempt.attemptId);state.attempt.state=value;state.attempt.completed=true;},
    async recordEvent(){state.log.push('event');}
  };
  return {state,backend,args:{...options,approval,cleanupDir:join(options.root,'cleanup'),backend}};
}

test('full original candidate inventory preserves source, compiler/import output and actual screenshots as bytes',async()=>fixture(async options=>{
  const image=Buffer.from('Synthetic recorded-image fixture bytes, never published');
  await writeFile(join(options.preservation.evidenceDir,'orders-390.png'),image);
  const candidatePath=join(options.preservation.evidenceDir,'candidate-evidence.json'),candidate=JSON.parse(await readFile(candidatePath,'utf8'));
  candidate.browserMeasurements.screenshots=[{path:'orders-390.png',sha256:sha(image)}];await writeFile(candidatePath,JSON.stringify(candidate));
  const output=join(options.root,'preserved');const result=await preserveOriginalCandidateEvidence({originalCandidateDir:options.preservation.evidenceDir,evidenceDir:output,request:options.request});
  const manifest=JSON.parse(await readFile(join(output,'evidence-manifest.json'),'utf8'));
  assert.equal(sha(await readFile(join(output,'evidence-manifest.json'))),result.evidenceManifestSha256);
  assert.ok(manifest.files.some(file=>file.path==='orders-390.png'&&file.sha256===sha(image)));
  assert.deepEqual(await readFile(join(output,'orders-390.png')),image);
  await assert.rejects(preserveOriginalCandidateEvidence({originalCandidateDir:options.preservation.evidenceDir,evidenceDir:output,request:options.request}),/exists|fresh|new/i);
  await assert.rejects(preserveOriginalCandidateEvidence({originalCandidateDir:options.preservation.evidenceDir,evidenceDir:join(options.preservation.evidenceDir,'nested'),request:options.request}),/separate|inside/i);
}));

test('executor approval binds explicit one-owner scope and excludes control/protected/out-of-pool IDs',async()=>fixture(async options=>{
  const {args}=await setup(options);assert.equal(assertTerminalRecycleApproval(options.policy,args.approval,options.request),true);
  for(const applicationId of [120,121,134,999])assert.throws(()=>assertTerminalRecycleApproval(options.policy,{...args.approval,applicationId},{...options.request,applicationId}),TypeError);
  for(const change of [a=>a.organismId='a'.repeat(32),a=>a.schema='OTHER',a=>a.policyHash='0'.repeat(64),a=>a.mode='ANY_OWNER',a=>a.applicationIds=[130,131]]){const approval=structuredClone(args.approval);change(approval);assert.throws(()=>assertTerminalRecycleApproval(options.policy,approval,options.request),TypeError);}
}));

test('quiescence is an explicit fresh owner attestation, never an inferred empty worker count',async()=>fixture(async options=>{
  const now=Date.parse('2026-10-22T18:00:00Z'),runEvidenceSha256='a'.repeat(64);
  const attestation={kind:'operator-owned-worker-stop-1',applicationId:options.request.applicationId,runId:options.request.runId,organismId:options.request.organismId,runEvidenceSha256,workerStopped:true,browserStopped:true,activeWorkerCount:0,activeEvaluationLeases:0,activeBrowserLeases:0,observedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()};
  assert.equal(assertRecycleQuiescence(attestation,options.request,{now,runEvidenceSha256}),true);
  for(const change of [a=>a.workerStopped=false,a=>a.activeWorkerCount=1,a=>delete a.activeBrowserLeases,a=>a.organismId='0'.repeat(32),a=>a.runEvidenceSha256='b'.repeat(64),a=>a.expiresAt=new Date(now-1).toISOString(),a=>a.observedAt=new Date(now+10000).toISOString()]){const altered=structuredClone(attestation);change(altered);assert.throws(()=>assertRecycleQuiescence(altered,options.request,{now,runEvidenceSha256}),TypeError);}
}));

test('cleanup commits a unique attempt then reacquires and verifies before the workspace API; final readback precedes VERIFIED',async()=>fixture(async options=>{
  const {args,state}=await setup(options);const result=await executeTerminalRecycle(args);
  assert.equal(result.disposalVerified,true);assert.equal(state.apiCalls,1);assert.equal(state.deleted,true);assert.equal(state.attempt.state,'VERIFIED');
  const started=state.log.indexOf('STARTED'),api=state.log.indexOf('API'),deleted=state.log.indexOf('delete-owned'),verified=state.log.indexOf('VERIFIED');
  assert.ok(started>=0&&state.log.indexOf('commit',started)<api&&state.log.indexOf('observe',started)<api&&api<deleted&&deleted<verified);
  assert.equal(result.deletedFixtureRows,40);assert.equal(result.otherApplicationsUnchanged,true);
  assert.equal(JSON.parse(await readFile(join(args.cleanupDir,'cleanup-result.json'),'utf8')).disposalVerified,true);
}));

test('a terminal-looking candidate in a running run is never released by this initial executor',async()=>fixture(async options=>{
  const {args,state}=await setup(options);state.observation.run.state='RUNNING';
  await assert.rejects(executeTerminalRecycle(args),/terminal|running/i);assert.equal(state.apiCalls,0);assert.equal(state.attempt,null);
}));

test('the current incumbent remains pinned even when its source run is complete',async()=>fixture(async options=>{
  const {args,state}=await setup(options);state.observation.run.bestOrganismId=options.request.organismId;
  await assert.rejects(executeTerminalRecycle(args),/incumbent.*pinned/i);assert.equal(state.apiCalls,0);assert.equal(state.attempt,null);
}));

test('preservation or other-application changes after the durable attempt stop before the removal API',async()=>{
  for(const corruption of ['source','canary'])await fixture(async options=>{
    const {args,state,backend}=await setup(options),commit=backend.commit;backend.commit=async()=>{await commit();if(state.commits===1){if(corruption==='source')await writeFile(join(options.preservation.evidenceDir,'candidate-evidence.json'),'changed');else state.canaries.orders.push({APPLICATION_ID:130,ORDER_ID:1001});}};
    await assert.rejects(executeTerminalRecycle(args),/uncertain|incomplete/i);assert.equal(state.apiCalls,0);assert.equal(state.deleted,false);assert.equal(state.attempt.state,'UNCERTAIN');
    assert.equal(JSON.parse(await readFile(join(args.cleanupDir,'cleanup-incomplete.json'),'utf8')).apiInvoked,false);
  });
});

test('API failure is permanent UNCERTAIN and a second invocation cannot retry the removal',async()=>fixture(async options=>{
  const {args,state,backend}=await setup(options);backend.removeApplication=async()=>{state.apiCalls++;throw new Error('Synthetic API transport failure');};
  await assert.rejects(executeTerminalRecycle(args),/uncertain|incomplete/i);assert.equal(state.attempt.state,'UNCERTAIN');assert.equal(state.deleted,false);
  await assert.rejects(executeTerminalRecycle({...args,cleanupDir:join(options.root,'second-cleanup')}),/previous cleanup/i);assert.equal(state.apiCalls,1);
}));

test('rollback failures cannot hide an uncertain API outcome or prevent its private audit',async()=>fixture(async options=>{
  const {args,state,backend}=await setup(options);backend.removeApplication=async()=>{state.apiCalls++;throw new Error('Synthetic API ambiguity');};backend.rollback=async()=>{throw new Error('Synthetic rollback transport failure');};
  await assert.rejects(executeTerminalRecycle(args),/cleanup incomplete or uncertain/i);
  const evidence=JSON.parse(await readFile(join(args.cleanupDir,'cleanup-incomplete.json'),'utf8'));assert.equal(evidence.disposalVerified,false);assert.equal(evidence.apiInvoked,true);assert.equal(state.attempt.state,'UNCERTAIN');
}));

test('fixture or canary changes during removal prevent fixture deletion and cannot be reported VERIFIED',async()=>{
  for(const corruption of ['fixture','canary'])await fixture(async options=>{
    const {args,state,backend}=await setup(options),remove=backend.removeApplication;backend.removeApplication=async()=>{await remove();if(corruption==='fixture')state.orders[0].STATUS='SHIPPED';else state.canaries.applications.push({APPLICATION_ID:134});};
    await assert.rejects(executeTerminalRecycle(args),/uncertain|incomplete/i);assert.equal(state.deleted,false);assert.equal(state.attempt.state,'UNCERTAIN');
  });
});

test('Oracle Date canaries agree with saved ISO strings and changed Date values stop before fixture deletion',async()=>fixture(async options=>{
  const {args,state,backend}=await setup(options),path=join(options.preservation.snapshotDir,'canaries.json'),savedAt='2026-10-22T18:00:00.123Z';
  state.canaries.applications=[{APPLICATION_ID:134,LAST_UPDATED_ON:savedAt}];
  const bytes=Buffer.from(JSON.stringify(state.canaries));await writeFile(path,bytes);
  const manifest=JSON.parse(await readFile(join(options.preservation.snapshotDir,'snapshot-manifest.json'),'utf8')),entry=manifest.files.find(file=>file.path==='canaries.json');Object.assign(entry,{sha256:sha(bytes),bytes:bytes.length});
  const manifestBytes=Buffer.from(JSON.stringify(manifest));await writeFile(join(options.preservation.snapshotDir,'snapshot-manifest.json'),manifestBytes);args.preservation.snapshotManifestSha256=sha(manifestBytes);
  state.canaries.applications[0].LAST_UPDATED_ON=new Date(savedAt);
  const remove=backend.removeApplication;backend.removeApplication=async()=>{await remove();state.canaries.applications[0].LAST_UPDATED_ON=new Date('2026-10-22T18:00:01.123Z');};
  await assert.rejects(executeTerminalRecycle(args),/uncertain|incomplete/i);assert.equal(state.apiCalls,1,'unchanged Date must pass admission before the actual changed Date probe');assert.equal(state.deleted,false);assert.equal(state.attempt.state,'UNCERTAIN');
}));

test('legacy disposal events still block cleanup when the new ledger is empty',async()=>fixture(async options=>{
  const {args,state}=await setup(options);state.observation.cleanupAttempts=[{source:'legacy-event',state:'CLEANUP_STARTED'}];
  await assert.rejects(executeTerminalRecycle(args),/previous cleanup/i);assert.equal(state.apiCalls,0);assert.equal(state.attempt,null);
  await assert.rejects(access(join(args.cleanupDir,'cleanup-result.json')),{code:'ENOENT'});
}));

test('production preparation preserves FF9 data and the canonical shared lock survives uncertain resource cleanup',async()=>{for(const scenario of ['none','resource','api'])await fixture(async options=>{
  const {args}=await setup(options),p=options.policy,r=options.request,root=options.root;
  const snapshot=options.snapshotManifest,canaryFile=snapshot.files.find(file=>file.path==='canaries.json'),canaries=Buffer.from(JSON.stringify({applications:[],registry:[],orders:[]}));
  await writeFile(join(options.preservation.snapshotDir,canaryFile.path),canaries);Object.assign(canaryFile,{sha256:sha(canaries),bytes:canaries.length});const snapshotBytes=Buffer.from(JSON.stringify(snapshot));await writeFile(join(options.preservation.snapshotDir,'snapshot-manifest.json'),snapshotBytes);options.preservation.snapshotManifestSha256=sha(snapshotBytes);
  const runBytes=Buffer.from(JSON.stringify({runId:r.runId,oracleRun:{STATE:'COMPLETE'},candidates:[{organismId:r.organismId,applicationId:r.applicationId}]}));await writeFile(join(root,'run-evidence.json'),runBytes);
  await mkdir(join(root,'policies'));await writeFile(join(root,'policies/policy.json'),JSON.stringify(p));await writeFile(join(root,'oracle.json'),JSON.stringify({user:p.schema,workspace:p.workspace,password:'TEST_ONLY_NOT_A_REAL_CREDENTIAL',connectString:'TEST_ONLY'}));await writeFile(join(root,'worker.json'),JSON.stringify({oracleConfigPath:'oracle.json',sandboxPolicyPath:'policies/policy.json',sqlclPath:'TEST_ONLY_SQLCL_NOT_EXECUTED'}));
  const now=Date.now(),quiescenceAttestation={kind:'operator-owned-worker-stop-1',applicationId:r.applicationId,runId:r.runId,organismId:r.organismId,runEvidenceSha256:sha(runBytes),workerStopped:true,browserStopped:true,activeWorkerCount:0,activeEvaluationLeases:0,activeBrowserLeases:0,observedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString()};
  const rawRun=JSON.parse(await readFile(join(options.preservation.snapshotDir,'run.json'),'utf8'))[0],rawOrganism=JSON.parse(await readFile(join(options.preservation.snapshotDir,'organism.json'),'utf8'))[0],rawImport=JSON.parse(await readFile(join(options.preservation.snapshotDir,'import-attempts.json'),'utf8'))[0];let orders=JSON.parse(await readFile(join(options.preservation.snapshotDir,'orders.json'),'utf8')).map(row=>({...row,UPDATED_AT:new Date('2026-10-22T18:00:00.123Z'),UPDATED_AT_EXACT:'2026-10-22T18:00:00.123456789Z'})),appExists=true,slotExists=true,slotState='ACTIVE',closed=false,ledger=null,resourceFaults=false;const trace=[],workerLockPath=join(root,'owned-worker.lock'),actualPreparation=join(root,'actual-preparation');
  const db={
    async execute(sql,binds={}){
      assert.equal(closed,false,'production connection closed before executor completion');
      if(sql.includes('remove_application')){await access(workerLockPath);trace.push('API');assert.equal(binds.app,r.applicationId);assert.equal(binds.workspace,p.workspace);appExists=false;if(scenario==='api')throw new Error('Synthetic ambiguous API response');return {};}
      if(sql.startsWith('insert into apxgen_app_cleanup_attempts')){ledger={ATTEMPT_ID:binds.attempt,ORGANISM_ID:binds.organism,RUN_ID:binds.run,APPLICATION_ID:binds.app,GENOME_HASH:binds.genome,ARTIFACT_HASH:binds.artifact,POLICY_HASH:binds.policy,ARCHIVE_HASH:binds.archive,SNAPSHOT_HASH:binds.snapshot,EVIDENCE_HASH:binds.evidence,AUTHORIZATION_HASH:binds.authorization,STATE:'STARTED',COMPLETED:0};return {rowsAffected:1};}
      if(sql.startsWith('update apxgen_app_cleanup_attempts')){assert.equal(ledger.STATE,'STARTED');ledger.STATE=binds.state;ledger.COMPLETED=1;return {rowsAffected:1};}
      if(sql.startsWith('update genesis_order_lab_slots')){await access(join(actualPreparation,'evidence/evidence-manifest.json'));await access(join(actualPreparation,'preparation-manifest.json'));const saved=JSON.parse(await readFile(join(actualPreparation,'snapshot/orders.json'),'utf8'));assert.equal(saved.length,40);assert.equal(saved[0].UPDATED_AT_EXACT,'2026-10-22T18:00:00.123456789Z');assert.equal(trace.includes('API'),false);slotState='RELEASED';trace.push('release-slot');return {rowsAffected:1};}
      if(sql.startsWith('delete from genesis_orders')){assert.equal(binds.app,r.applicationId);const count=orders.length;orders=[];return {rowsAffected:count};}
      if(sql.startsWith('delete from genesis_order_lab_slots')){slotExists=false;return {rowsAffected:1};}
      if(sql.includes('from apex_workspace_schemas'))return {rows:[{WORKSPACE_NAME:p.workspace,WORKSPACE_ID:p.workspaceId}]};
      if(sql.includes('select count(*) n')){let n=0;if(sql.includes('apex_applications'))n=appExists?1:0;else if(sql.includes('genesis_orders'))n=orders.length;else if(sql.includes('genesis_order_lab_slots'))n=slotExists?1:0;return {rows:[{N:n}]};}
      if(sql.includes('from apxgen_app_runs'))return {rows:[rawRun]};
      if(sql.includes('from apxgen_app_organisms'))return {rows:[rawOrganism]};
      if(sql.includes('from apxgen_app_cleanup_attempts'))return {rows:ledger?[{...ledger}]:[]};
      if(sql.includes('from apxgen_app_import_attempts'))return {rows:[{...rawImport,COMPLETED:1}]};
      if(sql.includes('from apxgen_app_events'))return {rows:sql.includes("state in(")?[]:[{ORGANISM_ID:r.organismId,STATE:'SELECTED'}]};
      if(sql.includes('from genesis_order_lab_slots'))return {rows:sql.includes('<>')?[]:slotExists?[{APPLICATION_ID:r.applicationId,WORKSPACE_ID:p.workspaceId,OWNER_RUN_ID:r.runId,OWNER_ORGANISM_ID:r.organismId,SLOT_STATE:slotState,LEASE_CURRENT:slotState==='ACTIVE'?1:0,LEASE_UNTIL_EXACT:'2026-10-22T18:00:00.987654321Z',REGISTERED_AT_EXACT:'2026-10-22T17:00:00.987654321Z'}]:[]};
      if(sql.includes('from genesis_orders'))return {rows:sql.includes('<>')?[]:orders};
      if(sql.includes('from apex_applications'))return {rows:sql.includes('<>')?[]:appExists?[{APPLICATION_ID:r.applicationId,WORKSPACE:p.workspace,OWNER:p.schema}]:[]};
      return {rows:[]};
    },async commit(){assert.equal(closed,false);trace.push('commit');},async rollback(){assert.equal(closed,false);if(resourceFaults&&ledger?.STATE==='VERIFIED')throw new Error('Synthetic rollback failure');},async close(){closed=true;trace.push('close');if(resourceFaults&&ledger?.STATE==='VERIFIED')throw new Error('Synthetic close failure');}
  };
  const prepareOptions={configPath:join(root,'worker.json'),approval:args.approval,request:r,originalCandidateDir:options.preservation.evidenceDir,quiescenceAttestation,workerLockPath,preparationDir:actualPreparation};let bypassConnected=false;
  await assert.rejects(prepareTerminalApplicationRecycle({...prepareOptions,workerLockPath:join(root,'bypass.lock')},{connect:async()=>{bypassConnected=true;return db;}}),/canonical|shared.*lock|coordinator/i);
  assert.equal(bypassConnected,false);await assert.rejects(access(join(root,'bypass.lock')),{code:'ENOENT'});await assert.rejects(access(workerLockPath),{code:'ENOENT'});
  const cliLease=await acquireCoordinatorLock(join(root,'worker.json')),cliMarker=await readFile(workerLockPath,'utf8');let contentionConnected=false;
  try{await assert.rejects(prepareTerminalApplicationRecycle(prepareOptions,{connect:async()=>{contentionConnected=true;return db;}}),{code:'COORDINATOR_LOCKED'});assert.equal(contentionConnected,false);assert.equal(await readFile(workerLockPath,'utf8'),cliMarker);await assert.rejects(access(join(root,'policies/owned-worker.lock')),{code:'ENOENT'});}
  finally{await releaseCoordinatorLock(cliLease);}
  const prepared=await prepareTerminalApplicationRecycle(prepareOptions,{connect:async()=>db});
  assert.equal(prepared.released,true);assert.equal(slotState,'RELEASED');assert.equal(appExists,true);assert.equal(orders.length,40);assert.equal(closed,true);await assert.rejects(access(workerLockPath),{code:'ENOENT'});closed=false;
  const disposeOptions={configPath:join(root,'worker.json'),approval:args.approval,request:r,preparationDir:actualPreparation,preparationManifestSha256:prepared.preparationManifestSha256,originalCandidateDir:options.preservation.evidenceDir,quiescenceAttestation,workerLockPath,archiveDir:options.preservation.archiveDir,cleanupDir:join(root,'wrapper-cleanup')};
  const foreignLock=JSON.stringify({pid:99999999,nonce:'foreign-test-lock'});await writeFile(workerLockPath,foreignLock);let connected=false;
  await assert.rejects(recycleTerminalApplication(disposeOptions,{connect:async()=>{connected=true;return db;}}),{code:'COORDINATOR_LOCKED'});
  assert.equal(connected,false);assert.equal(await readFile(workerLockPath,'utf8'),foreignLock);await unlink(workerLockPath);
  resourceFaults=scenario==='resource';
  if(scenario==='api'){
    await assert.rejects(recycleTerminalApplication(disposeOptions,{connect:async()=>db,archive:async()=>({archiveVerified:true,manifestSha256:options.preservation.archiveManifestSha256})}),/incomplete or uncertain/i);
    assert.equal(ledger.STATE,'UNCERTAIN');assert.equal(orders.length,40);assert.equal(slotExists,true);assert.equal(closed,true);await access(workerLockPath);
    const audit=JSON.parse(await readFile(join(disposeOptions.cleanupDir,'resource-cleanup.json'),'utf8'));assert.ok(audit.resourceCleanupErrors.includes('LOCK_RETAINED'));return;
  }
  const result=await recycleTerminalApplication(disposeOptions,{connect:async()=>db,archive:async()=>({archiveVerified:true,manifestSha256:options.preservation.archiveManifestSha256})});
  assert.equal(result.disposalVerified,true);assert.equal(ledger.STATE,'VERIFIED');assert.ok(trace.indexOf('API')<trace.lastIndexOf('close'));assert.equal(trace.at(-1),'close');
  if(scenario==='resource'){await access(workerLockPath);assert.ok(result.resourceCleanupErrors.includes('ROLLBACK_FAILED'));assert.ok(result.resourceCleanupErrors.includes('CLOSE_FAILED'));assert.ok(result.resourceCleanupErrors.includes('LOCK_RETAINED'));}
  else{await assert.rejects(access(workerLockPath),{code:'ENOENT'});assert.equal(result.resourceCleanupErrors,undefined);}
});});
