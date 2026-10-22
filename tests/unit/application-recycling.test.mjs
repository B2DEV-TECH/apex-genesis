// Synthetic filesystem fixtures only; these tests create no Oracle authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRecyclingAuthorization, assertRecyclingAuthorization, createOwnedCleanupAttempt } from '../../scripts/application/recycle-policy.mjs';
import { fixture, sha, policy, runId, organismId, otherId, json } from './application-recycling-fixture.mjs';

test('generic recycling binds one explicitly owned slot and verified preservation for each allowlisted ID', async () => {
  for(const applicationId of policy.applicationIds) await fixture(async options => {
    const authorization=await createRecyclingAuthorization(options);
    assert.deepEqual(authorization.applicationIds,[applicationId]); assert.equal(authorization.mode,'DISPOSE_ARCHIVED_OWNED_APPLICATION');
    for(const key of ['genomeHash','definitionHash','runId','organismId']) assert.equal(authorization[key],options.request[key]);
    for(const key of ['policyHash','authorityHash','preservedFilesHash']) assert.match(authorization[key],/^[a-f0-9]{64}$/);
    assert.equal(Object.isFrozen(authorization),true);assert.equal(Object.isFrozen(authorization.applicationIds),true);assert.equal(Object.isFrozen(authorization.preservedFiles.archive),true);
    assert.equal(await assertRecyclingAuthorization({...options,authorization}),true);
    assert.equal(await readFile(join(options.preservation.archiveDir,`sql/f${applicationId}.sql`),'utf8'),`begin wwv_flow_imp.import_begin(p_default_application_id=>${applicationId});end;\n/\n`);
  },{applicationId});
});

test('protected IDs, absent scope and unknown request fields never become disposal authorization', async () => fixture(async options => {
  for(const applicationId of [120,121,999]) await assert.rejects(createRecyclingAuthorization({...options,request:{...options.request,applicationId}}),TypeError);
  for(const change of [r=>r.mode='REMOVE_ANY',r=>r.runId='named-application',r=>r.cleanup=true,r=>delete r.genomeHash]) {const request=structuredClone(options.request);change(request);await assert.rejects(createRecyclingAuthorization({...options,request}),TypeError);}
  await assert.rejects(createRecyclingAuthorization({...options,policy:{...options.policy,enabled:false}}),TypeError);
}));

test('all current identity, canonical DNA, import and registry ownership must match', async () => fixture(async options => {
  for(const change of [
    o=>o.identity.sessionUser='SYSTEM',o=>o.identity.workspaceId=1,o=>o.application.schema='OTHER',o=>o.application.applicationId=132,
    o=>o.slot=null,o=>o.slot.runId=otherId,o=>o.slot.organismId=otherId,o=>o.slot.workspaceId=1,
    o=>o.organism.runId=otherId,o=>o.organism.genomeHash='a'.repeat(64),o=>o.organism.genome.traits.filters='beside',o=>o.organism.artifactHash='a'.repeat(64),
    o=>o.attempts=[],o=>o.attempts[0].attemptId=otherId,o=>o.attempts[0].state='UNCERTAIN',o=>o.attempts[0].state='FAILED',o=>o.attempts[0].completed=false
  ]) {const observed=structuredClone(options.observed);change(observed);await assert.rejects(createRecyclingAuthorization({...options,observed}),TypeError);}
}));

test('a running owner may recycle a terminal nonincumbent, while the live incumbent remains pinned', async () => {
  await fixture(async options => {
    assert.equal((await createRecyclingAuthorization(options)).organismId,organismId);
    const observed=structuredClone(options.observed);observed.run.bestOrganismId=organismId;
    await assert.rejects(createRecyclingAuthorization({...options,observed}),/incumbent|best/i);
  },{runState:'RUNNING',bestOrganismId:otherId});
  await fixture(async options => assert.equal((await createRecyclingAuthorization(options)).organismId,organismId));
});

test('live work, missing lock observations and previous cleanup attempts fail closed', async () => fixture(async options => {
  for(const change of [
    o=>o.slot.state='ACTIVE',o=>o.slot.leaseCurrent=true,o=>o.organism.state='TESTING',o=>o.run.state='UNKNOWN',
    o=>o.activity.browserStopped=false,o=>o.activity.pendingEvaluations=1,o=>o.activity.activeEvaluationLeases=1,o=>o.activity.activeBrowserLeases=1,o=>o.activity.activeImportLeases=1,
    o=>delete o.activity.activeBrowserLeases,o=>o.locks.slotTableExclusive=false,o=>o.locks.runRow=false,o=>delete o.locks,
    o=>o.cleanupAttempts=[{state:'STARTED'}],o=>o.cleanupAttempts=[{state:'UNCERTAIN'}],o=>o.cleanupAttempts=[{state:'DISPOSED'}]
  ]) {const observed=structuredClone(options.observed);change(observed);await assert.rejects(createRecyclingAuthorization({...options,observed}),TypeError);}
}));

test('claims of archive success cannot replace exact source, SQL export, snapshot and runtime evidence bytes', async () => {
  await fixture(async options => {await assert.rejects(createRecyclingAuthorization({...options,preservation:{archiveVerified:true}}),TypeError);});
  for(const [directory,path] of [['archiveDir','sql/f133.sql'],['archiveDir','definition/application.apx'],['snapshotDir','run.json'],['snapshotDir','organism.json'],['evidenceDir','import/import-output.txt'],['evidenceDir','candidate-evidence.json']]) await fixture(async options => {
    await writeFile(join(options.preservation[directory],path),'tampered');await assert.rejects(createRecyclingAuthorization(options),TypeError);
  });
  await fixture(async options => {await writeFile(join(options.preservation.evidenceDir,'omitted-runtime-file.txt'),'preserve this too');await assert.rejects(createRecyclingAuthorization(options),/unlisted|complete|inventory/i);});
});

test('fresh locked rechecks bind original policy, immutable file digests and snapshot best/run state', async () => fixture(async options => {
  const authorization=await createRecyclingAuthorization(options);
  await assert.rejects(assertRecyclingAuthorization({...options,authorization,policy:{...options.policy,maxMaterializationsPerRun:23}}),/changed|policy|authorization/i);
  const observed=structuredClone(options.observed);observed.run.bestOrganismId=otherId;
  await assert.rejects(assertRecyclingAuthorization({...options,authorization,observed}),/snapshot|changed|run/i);
  const file=options.archiveManifest.files.find(entry=>entry.path==='sql/f133.sql'),changed=Buffer.from('begin wwv_flow_imp.import_begin(p_default_application_id=>133);end;\n/\n-- altered archive\n');
  await writeFile(join(options.preservation.archiveDir,file.path),changed);file.sha256=sha(changed);file.bytes=changed.length;
  const manifest=json(options.archiveManifest);await writeFile(join(options.preservation.archiveDir,'archive-manifest.json'),manifest);
  await assert.rejects(assertRecyclingAuthorization({...options,authorization,preservation:{...options.preservation,archiveManifestSha256:sha(manifest)}}),/changed|authorization/i);
}));

test('asynchronous preservation reads cannot silently adopt changed caller policy or authority', async () => fixture(async options => {
  const expected=await createRecyclingAuthorization(options);
  const pending=createRecyclingAuthorization(options);
  options.policy.maxMaterializationsPerRun=23;
  options.request.applicationId=132;
  options.observed.organism.genome.traits.filters='beside';
  options.preservation.archiveManifestSha256='0'.repeat(64);
  const authorization=await pending;
  assert.deepEqual(authorization,expected);
  await assert.rejects(assertRecyclingAuthorization({...options,authorization}),TypeError);
}));

test('a post-commit recheck admits only its own in-memory attempt and cannot resume from JSON', async () => fixture(async options => {
  const authorization=await createRecyclingAuthorization(options),cleanupId='6'.repeat(32),ownAttempt=createOwnedCleanupAttempt(authorization,cleanupId);
  // The module's exported token supplies its hash without exposing reusable
  // process-local authority in JSON. The immutable authorization is independently
  // supplied to the ledger record below using the shared stable hash helper.
  const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
  const row={attemptId:cleanupId,organismId,runId,applicationId:options.request.applicationId,genomeHash:options.request.genomeHash,definitionHash:options.request.definitionHash,policyHash:authorization.policyHash,archiveManifestSha256:authorization.archiveManifestSha256,snapshotManifestSha256:authorization.snapshotManifestSha256,evidenceManifestSha256:authorization.evidenceManifestSha256,authorizationHash:sha(stable(authorization)),state:'STARTED',completed:false};
  const observed={...structuredClone(options.observed),cleanupAttempts:[row]};
  await assert.rejects(createRecyclingAuthorization({...options,observed}),/previous cleanup/i);
  assert.equal(await assertRecyclingAuthorization({...options,observed,authorization,ownAttempt}),true);
  await assert.rejects(assertRecyclingAuthorization({...options,observed,authorization,ownAttempt:JSON.parse(JSON.stringify(ownAttempt))}),TypeError);
  assert.throws(()=>createOwnedCleanupAttempt(JSON.parse(JSON.stringify(authorization)),cleanupId),TypeError);
  for(const change of [r=>r.attemptId=otherId,r=>r.archiveManifestSha256='0'.repeat(64),r=>r.state='UNCERTAIN',r=>r.completed=true]){const changed=structuredClone(observed);change(changed.cleanupAttempts[0]);await assert.rejects(assertRecyclingAuthorization({...options,observed:changed,authorization,ownAttempt}),TypeError);}
}));
