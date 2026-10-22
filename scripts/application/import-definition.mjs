import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import oracledb from 'oracledb';
import { validateSandboxPolicy, assertSandboxIdentity } from '../../runtime/application/sandbox.mjs';
import { hashApplicationDefinition } from './build-definition.mjs';
import { acceptsCompilerResult, executeSqlcl, fingerprintSqlcl } from './validate-definition.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const opaqueId = /^[a-f0-9]{32}$/;
const safePath = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x1f"]/.test(value);

export function assertImportObservation(policy, request, observation) {
  validateSandboxPolicy(policy);
  if (!request || !Number.isSafeInteger(request.applicationId) || !policy.applicationIds.includes(request.applicationId) || policy.protectedApplicationIds.includes(request.applicationId)) throw new TypeError('Import target is outside the explicit sandbox pool');
  if (!['runId', 'organismId', 'leaseToken'].every(key => typeof request[key] === 'string' && opaqueId.test(request[key])) || typeof request.alias !== 'string' || !/^[A-Z][A-Z0-9_-]{0,59}$/.test(request.alias)) throw new TypeError('Explicit ownership identifiers and a safe unique alias are required');
  const expected = request.expectedDatabase;
  if (!expected || !['databaseName', 'containerName'].every(key => typeof expected[key] === 'string' && /^[A-Z][A-Z0-9_$#]{0,127}$/.test(expected[key]))) throw new TypeError('Explicit database and container identity are required');
  const identity = observation?.identity;
  assertSandboxIdentity(policy, identity);
  if (identity.sessionUser !== policy.schema || identity.databaseName !== expected.databaseName || identity.containerName !== expected.containerName) throw new TypeError('Connected database identity differs from the approved sandbox');
  const slot = observation.slot;
  if (!slot || slot.applicationId !== request.applicationId || slot.workspaceId !== policy.workspaceId || slot.runId !== request.runId || slot.organismId !== request.organismId || slot.leaseToken !== request.leaseToken || slot.state !== 'ACTIVE' || slot.leaseCurrent !== true || slot.fixtureVersion !== 'order-lab/1.0') throw new TypeError('The exact active Oracle-owned slot lease is required');
  if (!Array.isArray(observation.existingApplications) || observation.existingApplications.length !== 0) throw new TypeError('Create-only import requires an absent application; overwrites are forbidden');
  if (!Number.isSafeInteger(observation.initialPoolImports) || observation.initialPoolImports < 0 || observation.initialPoolImports >= Math.min(policy.applicationIds.length, policy.maxMaterializationsPerRun)) throw new TypeError('Initial no-reuse pool import cap exhausted');
  const run = observation.run, organism = observation.organism;
  if (!run || run.runId !== request.runId || run.state !== 'RUNNING' || !Number.isSafeInteger(run.materializationBudget) || run.materializationBudget < 1 || run.materializationBudget > policy.maxMaterializationsPerRun || !Number.isSafeInteger(run.materializations) || run.materializations < 1 || run.materializations > run.materializationBudget) throw new TypeError('An active Oracle run with a reserved import budget is required');
  if (typeof request.definitionHash !== 'string' || !/^[a-f0-9]{64}$/.test(request.definitionHash) || !organism || organism.organismId !== request.organismId || organism.runId !== request.runId || organism.state !== 'IMPORT_STARTED' || organism.applicationId !== request.applicationId || organism.artifactHash !== request.definitionHash) throw new TypeError('Oracle import phase must bind this organism, slot and exact definition');
  return true;
}

export function sanitizeImportOutput(output, secrets) {
  let result = String(output);
  for (const value of Object.values(secrets)) if (typeof value === 'string' && value.length > 0) result = result.split(value).join('[REDACTED]');
  return result;
}

export function assertCompilerBinding(evidence, current, { fingerprint, sqlclPath, output }) {
  if (evidence.compilerValid !== true || evidence.status !== 'compiler_validated' || evidence.runtimeVerified !== false || evidence.connected !== false || evidence.definitionHash !== current.definitionHash || JSON.stringify(evidence.files) !== JSON.stringify(current.files) || evidence.outputSha256 !== sha256(output) || resolve(evidence.compiler?.executable || '') !== resolve(sqlclPath) || evidence.compiler.executableSha256 !== fingerprint.executableSha256 || typeof evidence.compiler.compilerJarSha256 !== 'string' || evidence.compiler.compilerJarSha256 !== fingerprint.compilerJarSha256 || !acceptsCompilerResult({ exitCode: evidence.compiler.exitCode, stdout: output, stderr: '' })) throw new TypeError('Current exact source and genuine compiler evidence are required');
  return true;
}

async function compilerAdmission(appPath, evidencePath, sqlclPath) {
  const evidenceBytes = await readFile(evidencePath), evidence = JSON.parse(evidenceBytes.toString('utf8'));
  const current = await hashApplicationDefinition(appPath);
  const output = await readFile(join(dirname(evidencePath), 'compiler-output.txt'), 'utf8');
  const fingerprint = await fingerprintSqlcl(sqlclPath);
  assertCompilerBinding(evidence, current, { fingerprint, sqlclPath, output });
  return { ...current, fingerprint, compilerEvidenceSha256: sha256(evidenceBytes) };
}

async function observeAdmission(db, policy, request) {
  const options = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const context = (await db.execute("select sys_context('USERENV','CURRENT_SCHEMA') schema_name,sys_context('USERENV','SESSION_USER') session_user,sys_context('USERENV','DB_NAME') database_name,sys_context('USERENV','CON_NAME') container_name from dual", {}, options)).rows[0];
  const mappings = (await db.execute('select w.workspace,w.workspace_id from apex_workspaces w join apex_workspace_schemas s on s.workspace_id=w.workspace_id where s.schema=:schema and w.workspace=:workspace', { schema: policy.schema, workspace: policy.workspace }, options)).rows;
  if (mappings.length !== 1) throw new TypeError('Exactly one approved workspace mapping is required');
  const identity = { schema: context.SCHEMA_NAME, sessionUser: context.SESSION_USER, databaseName: context.DATABASE_NAME, containerName: context.CONTAINER_NAME, workspace: mappings[0].WORKSPACE, workspaceId: mappings[0].WORKSPACE_ID };
  assertSandboxIdentity(policy, identity);
  if (identity.sessionUser !== policy.schema || identity.databaseName !== request.expectedDatabase?.databaseName || identity.containerName !== request.expectedDatabase?.containerName) throw new TypeError('Connected database identity differs from the approved sandbox');
  await db.execute('lock table genesis_order_lab_slots in exclusive mode nowait');
  const runs = (await db.execute('select run_id,state,materializations,materialization_budget from apxgen_app_runs where run_id=:run_id for update nowait', { run_id: request.runId }, options)).rows;
  const organisms = (await db.execute('select organism_id,run_id,state,application_id,artifact_hash from apxgen_app_organisms where organism_id=:organism_id for update nowait', { organism_id: request.organismId }, options)).rows;
  const slots = (await db.execute("select application_id,workspace_id,owner_run_id,owner_organism_id,lease_token,slot_state,fixture_version,case when lease_until>systimestamp then 1 else 0 end lease_current from genesis_order_lab_slots where application_id=:id for update nowait", { id: request.applicationId }, options)).rows;
  const row = slots.length === 1 ? slots[0] : null;
  const existingApplications = (await db.execute('select application_id from apex_applications where application_id=:id', { id: request.applicationId }, options)).rows;
  const count = (await db.execute('select count(*) n from genesis_order_lab_slots s join apex_applications a on a.application_id=s.application_id where s.owner_run_id=:run_id', { run_id: request.runId }, options)).rows[0].N;
  return {
    identity,
    slot: row ? { applicationId: row.APPLICATION_ID, workspaceId: row.WORKSPACE_ID, runId: row.OWNER_RUN_ID, organismId: row.OWNER_ORGANISM_ID, leaseToken: row.LEASE_TOKEN, state: row.SLOT_STATE, fixtureVersion: row.FIXTURE_VERSION, leaseCurrent: row.LEASE_CURRENT === 1 } : null,
    existingApplications, initialPoolImports: count,
    run: runs.length === 1 ? { runId: runs[0].RUN_ID, state: runs[0].STATE, materializations: runs[0].MATERIALIZATIONS, materializationBudget: runs[0].MATERIALIZATION_BUDGET } : null,
    organism: organisms.length === 1 ? { organismId: organisms[0].ORGANISM_ID, runId: organisms[0].RUN_ID, state: organisms[0].STATE, applicationId: organisms[0].APPLICATION_ID, artifactHash: organisms[0].ARTIFACT_HASH } : null
  };
}

export async function importApplicationDefinition({ configPath, appPath, compilerEvidencePath, applicationId, runId, organismId, leaseToken, alias, expectedDatabase, evidenceDir, timeoutMs = 120000 } = {}) {
  if (![configPath, appPath, compilerEvidencePath, evidenceDir].every(safePath) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new TypeError('Explicit safe configuration, source and evidence paths are required');
  const source = resolve(appPath), destination = resolve(evidenceDir);
  const compare = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (compare(destination) === compare(source) || compare(destination).startsWith(compare(source) + sep)) throw new TypeError('Import evidence must be outside application source');
  const configurationPath = resolve(configPath), configuration = await readJson(configurationPath);
  const keys = ['oracleConfigPath', 'sandboxPolicyPath', 'sqlclPath'];
  if (Object.keys(configuration).length !== keys.length || !keys.every(key => safePath(configuration[key]))) throw new TypeError('Explicit application worker configuration is required; no LAB fallback');
  const policy = await readJson(resolve(dirname(configurationPath), configuration.sandboxPolicyPath));
  validateSandboxPolicy(policy);
  const oracle = await readJson(resolve(dirname(configurationPath), configuration.oracleConfigPath));
  if (oracle.user !== policy.schema || oracle.workspace !== policy.workspace || typeof oracle.password !== 'string' || !oracle.password.length || /[\x00-\x1f"]/.test(oracle.password) || typeof oracle.connectString !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/?=&%+-]*$/.test(oracle.connectString)) throw new TypeError('Connection configuration is outside the approved sandbox grammar');
  const sqlclPath = resolve(dirname(configurationPath), configuration.sqlclPath);
  const admitted = await compilerAdmission(source, resolve(compilerEvidencePath), sqlclPath);
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination); // Each attempt is immutable, including failed admission.
  const request = { applicationId, runId, organismId, leaseToken, alias, expectedDatabase, definitionHash: admitted.definitionHash };
  const evidence = { formatVersion: '1.0', status: 'admission_rejected', importAttempted: false, importVerified: false, runtimeVerified: false, applicationId, runId, organismId, definitionHash: admitted.definitionHash, compilerEvidenceSha256: admitted.compilerEvidenceSha256, compilerFingerprint: admitted.fingerprint, budgetMode: 'oracle-reserved-plus-create-only-pool-cap', registryWrites: 0, observedAt: new Date().toISOString() };
  let db, audit, attemptId, output = '';
  try {
    db = await oracledb.getConnection({ user: oracle.user, password: oracle.password, connectString: oracle.connectString });
    const observed = await observeAdmission(db, policy, request);
    assertImportObservation(policy, request, observed);
    evidence.identityVerified = true;
    evidence.workspace = policy.workspace;
    evidence.parsingSchema = policy.schema;
    const latest = await hashApplicationDefinition(source);
    if (latest.definitionHash !== admitted.definitionHash) throw new TypeError('Definition changed before import');
    audit = await oracledb.getConnection({ user: oracle.user, password: oracle.password, connectString: oracle.connectString });
    const proposedAttemptId = randomBytes(16).toString('hex');
    await audit.execute("insert into apxgen_app_import_attempts(attempt_id,organism_id,run_id,application_id,definition_hash,state) values(:attempt_id,:organism_id,:run_id,:application_id,:definition_hash,'STARTED')", { attempt_id:proposedAttemptId,organism_id:request.organismId,run_id:request.runId,application_id:request.applicationId,definition_hash:admitted.definitionHash }, { autoCommit:true });
    attemptId = proposedAttemptId;
    evidence.attemptId = attemptId;
    evidence.attemptLedgerWrites = 1;
    evidence.importAttempted = true;
    const result = await executeSqlcl(sqlclPath, ['-thin', '-nohistory', '-noupdates', '-S', '/nolog'], { timeoutMs,
      input: `prompt\nset echo off\nset define off\nwhenever sqlerror exit failure rollback\nconnect ${oracle.user}/"${oracle.password}"@${oracle.connectString}\napex import -input "${source.replaceAll('\\', '/')}" -workspace ${policy.workspace} -schema ${policy.schema} -id ${applicationId} -alias ${alias}\nexit\n` });
    output = sanitizeImportOutput(result.stdout + result.stderr, { password: oracle.password, connectString: oracle.connectString, leaseToken });
    evidence.processExitCode = result.exitCode;
    evidence.processTimedOut = result.timedOut;
    const importedTarget = output.match(/Importing application ID:\s*(\d+)\s+into workspace:\s*(\S+)/i);
    const records = (await db.execute('select application_id,workspace,owner,alias from apex_applications where application_id=:id', { id: applicationId }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows;
    const current = await hashApplicationDefinition(source), fingerprintAfter = await fingerprintSqlcl(sqlclPath);
    const correctMetadata = records.length === 1 && records[0].APPLICATION_ID === applicationId && records[0].WORKSPACE === policy.workspace && records[0].OWNER === policy.schema && records[0].ALIAS === alias;
    evidence.metadataVerified = correctMetadata;
    const unchanged = current.definitionHash === admitted.definitionHash && JSON.stringify(fingerprintAfter) === JSON.stringify(admitted.fingerprint);
    evidence.definitionAndCompilerUnchanged = unchanged;
    const success = result.exitCode === 0 && !result.timedOut && !result.spawnError && /^\s*Import successful\.\s*$/m.test(output) && !/Compile Errors|Error:|ORA-\d|SP2-\d/i.test(output) && importedTarget && Number(importedTarget[1]) === applicationId && importedTarget[2] === policy.workspace;
    evidence.importVerified = Boolean(success && correctMetadata && unchanged);
    evidence.status = evidence.importVerified ? 'import_verified' : 'import_incomplete';
    evidence.reportedApplicationId = importedTarget ? Number(importedTarget[1]) : null;
  } catch (error) {
    evidence.status = evidence.importAttempted ? 'import_incomplete' : 'admission_rejected';
    evidence.failure = error.code && /^(ORA|NJS)-\d+$/.test(error.code) ? error.code : error instanceof TypeError ? sanitizeImportOutput(error.message, { password: oracle.password, connectString: oracle.connectString, leaseToken }) : 'IMPORT_WORKER_FAILED';
  } finally {
    if (attemptId && audit) {
      const finalState = evidence.importVerified ? 'VERIFIED' : evidence.processTimedOut || evidence.metadataVerified || evidence.processExitCode === undefined ? 'UNCERTAIN' : 'FAILED';
      try {
        const finalized = await audit.execute('update apxgen_app_import_attempts set state=:state,completed_at=systimestamp,error_code=:error_code where attempt_id=:attempt_id and state=\'STARTED\'', { state:finalState,error_code:finalState==='VERIFIED'?null:finalState==='UNCERTAIN'?'IMPORT_UNCERTAIN':'IMPORT_FAILED',attempt_id:attemptId }, { autoCommit:true });
        if (finalized.rowsAffected !== 1) throw new Error('Attempt finalization was not unique');
        evidence.attemptFinalState = finalState;
        evidence.attemptLedgerWrites = 2;
      } catch {
        evidence.importVerified = false;
        evidence.status = 'import_incomplete';
        evidence.failure = 'ATTEMPT_FINALIZATION_FAILED';
      }
    }
    if (audit) { try { await audit.close(); } catch {} }
    if (db) {
      try { await db.rollback(); await db.close(); }
      catch {
        evidence.importVerified = false;
        evidence.status = evidence.importAttempted ? 'import_incomplete' : 'admission_rejected';
        evidence.failure = 'GUARD_CONNECTION_RELEASE_FAILED';
      }
    }
  }
  evidence.outputSha256 = sha256(output);
  await writeFile(join(destination, 'import-output.txt'), output);
  const evidencePath = join(destination, 'import-evidence.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  return { ...evidence, evidencePath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await importApplicationDefinition(await readJson(process.argv[2]));
    console.log(JSON.stringify(result, null, 2));
    if (!result.importVerified) process.exitCode = 1;
  } catch (error) { console.error(error instanceof TypeError ? error.message : 'Import worker failed; inspect private configuration and evidence'); process.exitCode = 1; }
}
