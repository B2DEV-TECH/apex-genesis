import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const builderUrl = new URL('../../scripts/application/build-definition.mjs', import.meta.url);
const genomeUrl = new URL('../../evolution/application/genome.mjs', import.meta.url);
const validatorUrl = new URL('../../scripts/application/validate-definition.mjs', import.meta.url);

test('materializes a deterministic isolated definition with provenance and no inherited callbacks', async () => {
  const { buildApplicationDefinition } = await import(builderUrl);
  const { APPLICATION_BASELINE } = await import(genomeUrl);
  const root = await mkdtemp(join(tmpdir(), 'order-lab-builder-'));
  try {
    const parent = structuredClone(APPLICATION_BASELINE);
    const before = JSON.stringify(parent);
    const a = await buildApplicationDefinition(parent, { outputDir: join(root, 'a') });
    const b = await buildApplicationDefinition(parent, { outputDir: join(root, 'b') });
    assert.equal(JSON.stringify(parent), before);
    assert.equal(a.definitionHash, b.definitionHash);
    assert.equal(a.genomeHash, b.genomeHash);
    assert.equal(a.manifest.runtimeVerified, false);
    assert.equal(a.manifest.compilerValidated, false);
    assert.match(a.manifest.parentSourceHash, /^[a-f0-9]{64}$/);
    const app = await readFile(join(a.appPath, 'application.apx'), 'utf8');
    assert.match(app, /scheme: @oracle-apex-accounts/);
    assert.doesNotMatch(app, /apxgen_|genesis-read|#APP_FILES#genesis/);
    assert.deepEqual(JSON.parse(await readFile(join(a.appPath, 'deployments/default.json'), 'utf8')), {});
    const pages = await Promise.all(a.manifest.files.filter(f => f.path.startsWith('pages/')).map(f => readFile(join(a.appPath, f.path), 'utf8')));
    assert.match(pages.join('\n'), /GENESIS_ORDERS_SAFE_V/);
    assert.match(pages.join('\n'), /genesis_order_lab\.update_status/);
    assert.match(pages.join('\n'), /Delayed;DELAYED/);
    assert.match(pages.join('\n'), /Completed;COMPLETED/);
    assert.doesNotMatch(pages.join('\n'), /CANCELLED/);
    assert.doesNotMatch(pages.join('\n'), /apxgen_web|ajaxCallback/);
    for (const file of a.manifest.files) assert.equal(sha256(await readFile(join(a.appPath, file.path))), file.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects executable genomes, unsupported mappings and existing output directories', async () => {
  const { buildApplicationDefinition } = await import(builderUrl);
  const { APPLICATION_BASELINE } = await import(genomeUrl);
  const root = await mkdtemp(join(tmpdir(), 'order-lab-reject-'));
  try {
    await assert.rejects(buildApplicationDefinition({ ...structuredClone(APPLICATION_BASELINE), sql: 'delete from users' }, { outputDir: join(root, 'bad') }));
    const unsupported = structuredClone(APPLICATION_BASELINE);
    unsupported.traits.report = 'interactiveReport';
    await assert.rejects(buildApplicationDefinition(unsupported, { outputDir: join(root, 'unsupported') }), /unsupported|unverified/i);
    unsupported.traits.report = 'classicReport';
    unsupported.traits.edit = 'modal';
    await assert.rejects(buildApplicationDefinition(unsupported, { outputDir: join(root, 'modal') }), /unsupported|unverified/i);
    await writeFile(join(root, 'keep.txt'), 'keep');
    await assert.rejects(buildApplicationDefinition(APPLICATION_BASELINE, { outputDir: root }), /exist/i);
    assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'keep');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('compiler failure records failure evidence and cannot imply validation or runtime success', async () => {
  const { validateApplicationDefinition } = await import(validatorUrl);
  const root = await mkdtemp(join(tmpdir(), 'order-lab-compiler-'));
  try {
    await mkdir(join(root, 'application'));
    const result = await validateApplicationDefinition({ appPath: join(root, 'application'), evidenceDir: join(root, 'evidence'), sqlclPath: join(root, 'missing-sqlcl.exe'), timeoutMs: 1000 });
    assert.equal(result.compilerValid, false);
    assert.equal(result.runtimeVerified, false);
    assert.equal(result.status, 'compiler_unavailable');
    const evidence = JSON.parse(await readFile(result.evidencePath, 'utf8'));
    assert.equal(evidence.compilerValid, false);
    assert.equal(evidence.runtimeVerified, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('validation evidence cannot be written into the definition being attested', async () => {
  const { validateApplicationDefinition } = await import(validatorUrl);
  const root = await mkdtemp(join(tmpdir(), 'order-lab-evidence-'));
  try {
    await assert.rejects(validateApplicationDefinition({ appPath: root, evidenceDir: join(root, 'evidence'), sqlclPath: join(root, 'missing.exe') }), /outside|overlap/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('supported layout alleles produce distinct bounded definitions and preserve parent provenance', async () => {
  const { buildApplicationDefinition } = await import(builderUrl);
  const { APPLICATION_BASELINE } = await import(genomeUrl);
  const root = await mkdtemp(join(tmpdir(), 'order-lab-layout-'));
  try {
    const alternative = structuredClone(APPLICATION_BASELINE);
    Object.assign(alternative.traits, { filters: 'beside', summary: 'after', navigation: 'top', density: 'compact' });
    const baseline = await buildApplicationDefinition(APPLICATION_BASELINE, { outputDir: join(root, 'base') });
    const child = await buildApplicationDefinition(alternative, { outputDir: join(root, 'child'), parentDefinitionHash: baseline.definitionHash });
    assert.notEqual(child.definitionHash, baseline.definitionHash);
    assert.equal(child.manifest.parentDefinitionHash, baseline.definitionHash);
    const theme = await readFile(join(child.appPath, 'shared-components/themes/universal-theme/theme.apx'), 'utf8');
    assert.match(theme, /navigationMenuListPosition: top/);
    const report = await readFile(join(child.appPath, 'pages/p00001-orders.apx'), 'utf8');
    assert.match(report, /columnSpan: 3/);
    assert.match(report, /columnSpan: 9/);
    assert.match(report, /order-lab-compact/);
    assert.doesNotMatch(report, /@@/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('zero compiler exit without an unambiguous positive result is rejected', async () => {
  const { acceptsCompilerResult } = await import(validatorUrl);
  assert.equal(acceptsCompilerResult({ exitCode: 0, stdout: 'Validation successful.\n', stderr: '' }), true);
  assert.equal(acceptsCompilerResult({ exitCode: 0, stdout: 'APEXlang version 26.2.0+3479 is not supported by this SQLcl version.', stderr: '' }), false);
  assert.equal(acceptsCompilerResult({ exitCode: 0, stdout: 'Validation successful.\nORA-20000: failed', stderr: '' }), false);
  assert.equal(acceptsCompilerResult({ exitCode: 1, stdout: 'Validation successful.', stderr: '' }), false);
  assert.equal(acceptsCompilerResult({ exitCode: 0, stdout: 'Validation successful.', stderr: '', timedOut: true }), false);
});

test('import admission requires exact live identity, active owned lease and an absent allowlisted application', async () => {
  const { assertImportObservation } = await import('../../scripts/application/import-definition.mjs');
  const policy = { schemaVersion:'1.0',enabled:true,environment:'development',schema:'ORDER_LAB',workspace:'ORDER_LAB',workspaceId:12345,applicationIds:[130,131],protectedApplicationIds:[120,121],fixtureWritesAuthorized:true,maxConcurrentImports:1,maxMaterializationsPerRun:22 };
  const request = { applicationId:130,runId:'a'.repeat(32),organismId:'b'.repeat(32),leaseToken:'c'.repeat(32),alias:'ORDER-LAB-130',definitionHash:'d'.repeat(64),expectedDatabase:{databaseName:'FREE',containerName:'FREEPDB1'} };
  const observation = { identity:{schema:'ORDER_LAB',sessionUser:'ORDER_LAB',workspace:'ORDER_LAB',workspaceId:12345,databaseName:'FREE',containerName:'FREEPDB1'},slot:{applicationId:130,workspaceId:12345,runId:'a'.repeat(32),organismId:'b'.repeat(32),leaseToken:'c'.repeat(32),state:'ACTIVE',leaseCurrent:true,fixtureVersion:'order-lab/1.0'},existingApplications:[],initialPoolImports:0,run:{runId:'a'.repeat(32),state:'RUNNING',materializations:1,materializationBudget:22},organism:{organismId:'b'.repeat(32),runId:'a'.repeat(32),state:'IMPORT_STARTED',applicationId:130,artifactHash:'d'.repeat(64)} };
  assert.equal(assertImportObservation(policy, request, observation), true);
  for (const identity of [{schema:'OTHER'},{sessionUser:'SYS'},{workspaceId:7},{databaseName:'OTHER'},{containerName:'OTHER'}]) assert.throws(()=>assertImportObservation(policy,request,{...observation,identity:{...observation.identity,...identity}}));
  for (const slot of [{state:'RELEASED'},{leaseCurrent:false},{leaseToken:'d'.repeat(32)},{runId:'d'.repeat(32)},{organismId:'d'.repeat(32)},{workspaceId:7},{fixtureVersion:'other'}]) assert.throws(()=>assertImportObservation(policy,request,{...observation,slot:{...observation.slot,...slot}}));
  assert.throws(()=>assertImportObservation(policy,{...request,applicationId:120},observation));
  assert.throws(()=>assertImportObservation(policy,{...request,applicationId:132},observation));
  assert.throws(()=>assertImportObservation(policy,request,{...observation,existingApplications:[{applicationId:130}]}));
  assert.throws(()=>assertImportObservation(policy,request,{...observation,initialPoolImports:22}));
  for (const organism of [{state:'VALIDATED'},{artifactHash:'e'.repeat(64)},{runId:'e'.repeat(32)},{applicationId:131}]) assert.throws(()=>assertImportObservation(policy,request,{...observation,organism:{...observation.organism,...organism}}));
  for (const run of [{state:'COMPLETE'},{materializations:0},{materializations:23},{materializationBudget:23}]) assert.throws(()=>assertImportObservation(policy,request,{...observation,run:{...observation.run,...run}}));
});

test('import logs redact configured secrets and private endpoint even on command errors', async () => {
  const { sanitizeImportOutput } = await import('../../scripts/application/import-definition.mjs');
  const output = sanitizeImportOutput('connect ORDER_LAB/"unsafe-password"@private-host:1521/PRIVATEPDB\nlease=cccccccccccccccccccccccccccccccc', { password:'unsafe-password',connectString:'private-host:1521/PRIVATEPDB',leaseToken:'c'.repeat(32) });
  assert.doesNotMatch(output, /unsafe-password|private-host|PRIVATEPDB|cccccccc/);
  assert.match(output, /REDACTED/);
});

test('import rejects compiler evidence from a different compiler library even with the same launcher', async () => {
  const { assertCompilerBinding } = await import('../../scripts/application/import-definition.mjs');
  const sqlclPath = join(tmpdir(), 'sqlcl', 'bin', 'sql.exe');
  const output = 'Validation successful.\n';
  const current = { definitionHash:'a'.repeat(64),files:[] };
  const fingerprint = { executableSha256:'b'.repeat(64),compilerJarSha256:'c'.repeat(64) };
  const evidence = { compilerValid:true,status:'compiler_validated',runtimeVerified:false,connected:false,...current,outputSha256:sha256(output),compiler:{executable:sqlclPath,...fingerprint,exitCode:0} };
  assert.equal(assertCompilerBinding(evidence,current,{fingerprint,sqlclPath,output}),true);
  assert.throws(()=>assertCompilerBinding({...evidence,compiler:{...evidence.compiler,compilerJarSha256:'d'.repeat(64)}},current,{fingerprint,sqlclPath,output}));
  assert.throws(()=>assertCompilerBinding({...evidence,compiler:{...evidence.compiler,compilerJarSha256:undefined}},current,{fingerprint,sqlclPath,output}));
});

test('smoke metrics refuse unobserved tasks and cannot invent successful gates', async () => {
  const { oracleMetricsFromObservations } = await import('../../scripts/application/run-smoke.mjs');
  const tasks = {locateOrder:{success:true,actions:3,navigationSteps:1},filterOrders:{success:true,actions:3,navigationSteps:1},updateOrder:{success:true,actions:6,navigationSteps:3}};
  const observations = {compilerValidated:true,importVerified:true,authenticationVerified:true,runtimeVerified:true,fixtureVerified:true,databaseChangeVerified:true,securityVerified:false,tasks,viewportsTested:3,criticalViolations:0,seriousViolations:0,unnamedControls:0,focusFailures:0,horizontalOverflow:0,runtimeErrors:0,loadMs:800,componentCount:12};
  const metrics = oracleMetricsFromObservations('a'.repeat(64),observations);
  assert.equal(metrics.securityVerified,false);
  assert.equal(Object.keys(metrics).length,20);
  assert.equal(metrics.tasks.updateOrder.navigationSteps,3);
  assert.throws(()=>oracleMetricsFromObservations('a'.repeat(64),{...observations,fixtureVerified:undefined}));
  assert.throws(()=>oracleMetricsFromObservations('a'.repeat(64),{...observations,tasks:{...tasks,updateOrder:{success:null,actions:1,navigationSteps:0}}}));
});
