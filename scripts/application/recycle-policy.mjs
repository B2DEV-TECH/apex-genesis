// Read-only disposal admission. There is intentionally no database connection,
// slot release, APEX removal, fixture deletion, retry, or executable CLI here.
//
// The terminal-run executor lives in recycle-application.mjs and requires its own
// explicit target approval. This factory alone never permits cleanup. An
// executor must stop its browser, verify preservation
// before revoking the lease, durably record a unique cleanup attempt, and obtain
// fresh Oracle identity/ownership/activity observations under the import lock
// order (exclusive slot table, run, organism, slot). It must call the fresh
// recheck immediately before its separately reviewed destructive operation.
// The supplied observations must come from that trusted locked connection;
// JSON supplied by an application user is never an authority observation.
import { readFile, lstat, realpath, readdir } from 'node:fs/promises';
import { resolve, join, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { validateSandboxPolicy, assertSandboxIdentity } from '../../runtime/application/sandbox.mjs';
import { canonicalApplicationGenome } from '../../evolution/application/genome.mjs';
import { hashApplicationDefinition } from './build-definition.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identifier = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = message => { throw new TypeError(message); };
const check = (value, message) => { if (!value) fail(message); };
const terminal = new Set(['SELECTED', 'REJECTED']);
const issuedAuthorizations = new WeakSet(), ownedAttempts = new WeakMap();
const requestKeys = ['mode','applicationId','runId','organismId','genomeHash','definitionHash'];
const preservationKeys = ['archiveDir','archiveManifestSha256','snapshotDir','snapshotManifestSha256','originalDefinitionPath','evidenceDir','evidenceManifestSha256'];
function keys(value, expected, label) {
  check(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value)) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value,key)), 'Invalid '+label+' fields');
}
function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(key => JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
const same = (left,right) => canonical(left) === canonical(right);
function freeze(value) { if(value && typeof value === 'object') { for(const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
const clone = value => JSON.parse(JSON.stringify(value));
const archiveRequest = request => ({mode:'ARCHIVE_ONLY',applicationId:request.applicationId,runId:request.runId,organismId:request.organismId,definitionHash:request.definitionHash});
export function recyclingPolicyHash(policy) { validateSandboxPolicy(policy); return sha(canonical(policy)); }

function assertObservation(policy,request,observed) {
  validateSandboxPolicy(policy); keys(request,requestKeys,'explicit recycling request');
  check(request.mode === 'RECYCLE_OWNED_APPLICATION' && Number.isSafeInteger(request.applicationId) && policy.applicationIds.includes(request.applicationId) && ![120,121,...policy.protectedApplicationIds].includes(request.applicationId), 'Recycling target is outside the explicit disposable policy');
  check(identifier(request.runId) && identifier(request.organismId) && hash(request.genomeHash) && hash(request.definitionHash), 'Exact immutable run, organism, genome and artifact identities are required');
  keys(observed,['identity','application','slot','run','organism','attempts','activity','cleanupAttempts','locks'],'locked recycling observation');
  keys(observed.identity,['schema','sessionUser','workspace','workspaceId'],'connected identity');
  assertSandboxIdentity(policy,observed.identity);
  check(observed.identity.sessionUser === policy.schema, 'Recycling session owner differs from the explicit schema');
  keys(observed.application,['applicationId','workspace','schema'],'installed application');
  check(observed.application.applicationId === request.applicationId && observed.application.workspace === policy.workspace && observed.application.schema === policy.schema, 'Actual installed application ownership differs');
  keys(observed.slot,['applicationId','workspaceId','runId','organismId','state','leaseCurrent'],'owned slot');
  const slot=observed.slot;
  check(slot.applicationId === request.applicationId && slot.workspaceId === policy.workspaceId && slot.runId === request.runId && slot.organismId === request.organismId, 'Durable slot ownership differs');
  check(slot.state === 'RELEASED' && slot.leaseCurrent === false, 'The exact slot must already be released with no live lease');
  keys(observed.run,['runId','state','bestOrganismId','currentGeneration','materializations','materializationBudget'],'owner run');
  const run=observed.run;
  check(run.runId === request.runId && ['RUNNING','COMPLETE','FAILED','CANCELLED'].includes(run.state), 'Owner run state is unavailable or unsupported');
  check((run.bestOrganismId === null || identifier(run.bestOrganismId)) && Number.isSafeInteger(run.currentGeneration) && run.currentGeneration >= 0 && run.currentGeneration <= 10 && Number.isSafeInteger(run.materializations) && Number.isSafeInteger(run.materializationBudget) && run.materializations >= 1 && run.materializations <= run.materializationBudget && run.materializationBudget <= policy.maxMaterializationsPerRun, 'Invalid owner run checkpoint or materialization counters');
  check(run.state !== 'RUNNING' || (run.bestOrganismId !== null && run.bestOrganismId !== request.organismId), 'The live run incumbent/best candidate is pinned');
  keys(observed.organism,['organismId','runId','applicationId','genome','genomeHash','artifactHash','state'],'terminal organism');
  const organism=observed.organism;
  check(organism.organismId === request.organismId && organism.runId === request.runId && organism.applicationId === request.applicationId && organism.genomeHash === request.genomeHash && organism.artifactHash === request.definitionHash && terminal.has(organism.state), 'Terminal organism ownership or artifact binding differs');
  check(sha(canonicalApplicationGenome(organism.genome)) === request.genomeHash, 'Actual canonical Oracle DNA differs from the recorded genome hash');
  check(Array.isArray(observed.attempts) && observed.attempts.length === 1, 'Exactly one finalized import attempt is required');
  const attempt=observed.attempts[0];
  keys(attempt,['attemptId','organismId','runId','applicationId','definitionHash','state','completed'],'finalized import attempt');
  check(identifier(attempt.attemptId) && attempt.organismId === request.organismId && attempt.runId === request.runId && attempt.applicationId === request.applicationId && attempt.definitionHash === request.definitionHash && attempt.state === 'VERIFIED' && attempt.completed === true, 'Matching verified immutable import audit required');
  keys(observed.activity,['browserStopped','pendingEvaluations','activeEvaluationLeases','activeBrowserLeases','activeImportLeases'],'quiescent activity');
  check(observed.activity.browserStopped === true && ['pendingEvaluations','activeEvaluationLeases','activeBrowserLeases','activeImportLeases'].every(key => observed.activity[key] === 0), 'Browser/evaluation/import work or leases remain active');
  check(Array.isArray(observed.cleanupAttempts) && observed.cleanupAttempts.length === 0, 'A previous cleanup attempt exists; automatic recycling retries are prohibited');
  keys(observed.locks,['slotTableExclusive','runRow','organismRow','slotRow'],'trusted lock observation');
  check(Object.values(observed.locks).every(value => value === true), 'A fresh exclusive slot/run/organism/slot locked observation is required');
}

function safeRelative(path) {
  check(typeof path === 'string' && path.length > 0 && path.length <= 240 && /^[-A-Za-z0-9_./]+$/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe preserved evidence path');
  return path;
}
async function rootDirectory(path) {
  check(typeof path === 'string' && path.trim() && !/[\x00-\x1f"]/.test(path), 'Explicit preserved evidence paths are required');
  const absolute=resolve(path),info=await lstat(absolute);
  check(info.isDirectory() && !info.isSymbolicLink(), 'Preserved evidence roots must be real directories');
  return realpath(absolute);
}
async function bytesAt(root,path) {
  safeRelative(path); let current=root;
  for(const part of path.split('/')) { current=join(current,part); check(!(await lstat(current)).isSymbolicLink(), 'Preserved files cannot traverse symbolic links'); }
  check((await realpath(current)).startsWith(root+sep), 'Preserved file escapes its root');
  const info=await lstat(current);
  check(info.isFile() && info.size > 0 && info.size <= 16*1024*1024, 'Invalid preserved file type or size');
  const bytes=await readFile(current); check(bytes.length === info.size, 'Preserved file changed while read'); return bytes;
}
function parse(bytes) { try { return JSON.parse(bytes.toString('utf8')); } catch { fail('Preserved JSON evidence is unreadable'); } }
async function anchoredManifest(root,path,expected) {
  check(hash(expected),'An explicit immutable manifest digest is required');
  const bytes=await bytesAt(root,path); check(sha(bytes) === expected, 'Preserved manifest digest changed'); return parse(bytes);
}
async function verifyFiles(root,manifest) {
  check(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 4096, 'A complete bounded preservation inventory is required');
  const seen=new Set(),files=[],data=new Map();let total=0;
  for(const file of manifest.files) {
    keys(file,['path','sha256','bytes'],'preserved file inventory');safeRelative(file.path);
    check(!seen.has(file.path.toLowerCase()) && hash(file.sha256) && Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 16*1024*1024, 'Invalid or duplicate preserved file entry');
    seen.add(file.path.toLowerCase());total+=file.bytes;check(total <= 128*1024*1024, 'Preservation inventory exceeds its byte bound');
    const bytes=await bytesAt(root,file.path);check(bytes.length === file.bytes && sha(bytes) === file.sha256, 'Preserved evidence bytes differ from their immutable inventory');data.set(file.path,bytes);files.push(clone(file));
  }
  files.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0); return {files,data};
}
function one(value,label) { check(Array.isArray(value) && value.length === 1, 'Exactly one preserved '+label+' row is required');return value[0]; }
function requireFile(files,path) { const bytes=files.get(path);check(bytes,'Missing preserved evidence: '+path);return bytes; }
async function completeEvidenceInventory(root,files,prefix='') {
  for(const entry of await readdir(join(root,prefix),{withFileTypes:true})) {
    const path=prefix ? prefix+'/'+entry.name : entry.name;
    check(!entry.isSymbolicLink(),'Evidence inventories cannot traverse symbolic links');
    if(entry.isDirectory()) await completeEvidenceInventory(root,files,path);
    else { check(entry.isFile(),'Unsupported preserved evidence entry');if(path !== 'evidence-manifest.json') check(files.has(path),'Unlisted file: a complete candidate evidence inventory is required'); }
  }
}

async function verifyPreservation(policy,request,observed,preservation) {
  keys(preservation,preservationKeys,'preservation proof');
  const archiveRoot=await rootDirectory(preservation.archiveDir),snapshotRoot=await rootDirectory(preservation.snapshotDir),evidenceRoot=await rootDirectory(preservation.evidenceDir),originalRoot=await rootDirectory(preservation.originalDefinitionPath);
  const archive=await anchoredManifest(archiveRoot,'archive-manifest.json',preservation.archiveManifestSha256);
  const snapshot=await anchoredManifest(snapshotRoot,'snapshot-manifest.json',preservation.snapshotManifestSha256);
  const evidence=await anchoredManifest(evidenceRoot,'evidence-manifest.json',preservation.evidenceManifestSha256);
  check(archive.mode === 'ARCHIVE_ONLY' && archive.archiveVerified === true && archive.cleanupPerformed === false && same(archive.request,archiveRequest(request)), 'Verified archive belongs to another application/artifact');
  check(snapshot.kind === 'owned-slot-pre-release-snapshot' && same(snapshot.request,archiveRequest(request)) && same(snapshot.identity,observed.identity), 'Pre-release snapshot identity or ownership differs');
  keys(evidence,['kind','request','roles','files'],'candidate evidence manifest');
  check(evidence.kind === 'owned-application-evidence-1' && same(evidence.request,request), 'Candidate evidence inventory belongs to another owner/genome/artifact');
  const archived=await verifyFiles(archiveRoot,archive),snapshotted=await verifyFiles(snapshotRoot,snapshot),preserved=await verifyFiles(evidenceRoot,evidence);
  await completeEvidenceInventory(evidenceRoot,preserved.data);
  const original=await hashApplicationDefinition(originalRoot),copy=await hashApplicationDefinition(join(archiveRoot,'definition'));
  check(original.definitionHash === request.definitionHash && copy.definitionHash === request.definitionHash, 'Original or preserved definition differs from the durable artifact');
  const sourceManifestBytes=requireFile(archived.data,'definition-manifest.json'),sourceManifest=parse(sourceManifestBytes);
  check((await readFile(join(dirname(originalRoot),'definition-manifest.json'))).equals(sourceManifestBytes), 'Original and archived definition manifests differ');
  check(sourceManifest.definitionHash === request.definitionHash && sourceManifest.genomeHash === request.genomeHash && sha(canonicalApplicationGenome(sourceManifest.genome)) === request.genomeHash && same(sourceManifest.files,original.files), 'Archived canonical DNA or original source inventory differs');
  for(const file of original.files) check(sha(requireFile(archived.data,'definition/'+file.path)) === file.sha256, 'Archived source inventory is incomplete');
  const sql=requireFile(archived.data,`sql/f${request.applicationId}.sql`).toString('utf8');
  check(sql.includes('wwv_flow_imp.import_begin') && new RegExp('p_default_application_id\\s*=>\\s*'+request.applicationId+'(?:\\D|$)').test(sql), 'An actual SQL export for the exact application ID is required');

  const registry=one(parse(requireFile(snapshotted.data,'registry.json')),'registry');
  check(registry.APPLICATION_ID === request.applicationId && registry.WORKSPACE_ID === policy.workspaceId && registry.OWNER_RUN_ID === request.runId && registry.OWNER_ORGANISM_ID === request.organismId, 'Preserved slot ownership differs');
  const run=one(parse(requireFile(snapshotted.data,'run.json')),'run');
  check(same({runId:run.RUN_ID,state:run.STATE,bestOrganismId:run.BEST_ORGANISM_ID,currentGeneration:run.CURRENT_GENERATION,materializations:run.MATERIALIZATIONS,materializationBudget:run.MATERIALIZATION_BUDGET},observed.run), 'Snapshot run state, incumbent or counters differ from the current locked observation');
  const organism=one(parse(requireFile(snapshotted.data,'organism.json')),'organism');
  check(organism.ORGANISM_ID === request.organismId && organism.RUN_ID === request.runId && organism.APPLICATION_ID === request.applicationId && organism.GENOME_HASH === request.genomeHash && organism.ARTIFACT_HASH === request.definitionHash && organism.STATE === observed.organism.state && sha(canonicalApplicationGenome(typeof organism.GENOME_JSON === 'string' ? JSON.parse(organism.GENOME_JSON) : organism.GENOME_JSON)) === request.genomeHash, 'Snapshot immutable Oracle genome or organism differs');
  const attempt=one(parse(requireFile(snapshotted.data,'import-attempts.json')),'import attempt');
  check(attempt.ATTEMPT_ID === observed.attempts[0].attemptId && attempt.ORGANISM_ID === request.organismId && attempt.RUN_ID === request.runId && attempt.APPLICATION_ID === request.applicationId && attempt.DEFINITION_HASH === request.definitionHash && attempt.STATE === 'VERIFIED', 'Preserved import audit differs from its original attempt');
  const orders=parse(requireFile(snapshotted.data,'orders.json'));
  check(Array.isArray(orders) && orders.length === 40 && orders.every((row,index) => row.APPLICATION_ID === request.applicationId && row.ORDER_ID === 1001+index), 'Complete exact owned 40-order fixture snapshot required');
  const events=parse(requireFile(snapshotted.data,'events.json'));
  check(Array.isArray(events) && events.length > 0 && events.every(row => row.ORGANISM_ID === request.organismId), 'Preserved candidate phase history is missing or belongs to another owner');
  requireFile(snapshotted.data,'canaries.json');

  keys(evidence.roles,['candidate','compiler','compilerOutput','import','importOutput'],'preserved candidate evidence roles');
  const roles=Object.fromEntries(Object.entries(evidence.roles).map(([role,path]) => [role,requireFile(preserved.data,safeRelative(path))]));
  const candidate=parse(roles.candidate),compiler=parse(roles.compiler),imported=parse(roles.import);
  check(candidate.organismId === request.organismId && candidate.applicationId === request.applicationId && candidate.genomeHash === request.genomeHash && candidate.definitionHash === request.definitionHash, 'Preserved candidate evidence differs from the exact application');
  check(compiler.compilerValid === true && compiler.definitionHash === request.definitionHash && compiler.outputSha256 === sha(roles.compilerOutput) && /Validation successful\./.test(roles.compilerOutput.toString()) && !/APEXlang Compile Errors:/.test(roles.compilerOutput.toString()), 'Preserved real compiler evidence or raw output differs');
  check(imported.importVerified === true && imported.applicationId === request.applicationId && imported.runId === request.runId && imported.organismId === request.organismId && imported.definitionHash === request.definitionHash && imported.attemptId === observed.attempts[0].attemptId && imported.compilerEvidenceSha256 === sha(roles.compiler) && imported.outputSha256 === sha(roles.importOutput), 'Preserved import evidence is not bound to this actual compiler/import attempt');
  for(const screenshot of candidate.browserMeasurements?.screenshots || []) check(hash(screenshot.sha256) && preserved.files.some(file => file.sha256 === screenshot.sha256), 'An actual recorded runtime screenshot is missing from preservation');
  return {archive:archived.files,snapshot:snapshotted.files,evidence:preserved.files,original:original.files};
}

/** Read-only: independently hashes preservation; does not release or remove anything. */
export async function createRecyclingAuthorization({policy,request,observed,preservation} = {}) {
  try {
    assertObservation(policy,request,observed);
    keys(preservation,preservationKeys,'preservation proof');
    // Pin the original caller state before the first filesystem await. A caller
    // changing its config object cannot broaden an in-flight authorization.
    ({policy,request,observed,preservation}=clone({policy,request,observed,preservation}));
    const preservedFiles=await verifyPreservation(policy,request,observed,preservation);
    const authorization=freeze({schemaVersion:'1.0',mode:'DISPOSE_ARCHIVED_OWNED_APPLICATION',schema:policy.schema,workspace:policy.workspace,workspaceId:policy.workspaceId,applicationIds:[request.applicationId],runId:request.runId,organismId:request.organismId,genomeHash:request.genomeHash,definitionHash:request.definitionHash,importAttemptId:observed.attempts[0].attemptId,policyHash:recyclingPolicyHash(policy),authorityHash:sha(canonical(observed)),archiveManifestSha256:preservation.archiveManifestSha256,snapshotManifestSha256:preservation.snapshotManifestSha256,evidenceManifestSha256:preservation.evidenceManifestSha256,preservedFilesHash:sha(canonical(preservedFiles)),preservedFiles});
    issuedAuthorizations.add(authorization);return authorization;
  } catch(error) { if(error instanceof TypeError) throw error; fail('Recycling preservation is incomplete or unreadable'); }
}

export const recyclingAuthorizationHash = authorization => sha(canonical(authorization));

/** Process-local intent only; an executor must persist the attempt itself. */
export function createOwnedCleanupAttempt(authorization,attemptId) {
  check(issuedAuthorizations.has(authorization) && identifier(attemptId),'An authorization issued in this invocation is required; cleanup cannot resume from JSON');
  const token=Object.freeze({});ownedAttempts.set(token,{authorization,attemptId});return token;
}

/** Caller must supply fresh locked Oracle observations and unchanged preserved bytes.
 * A post-commit check consumes the exact attempt started in this process. It does
 * not conceal prior attempts: every actual ledger field is matched first, and
 * serialized tokens cannot authorize a retry after a crash.
 */
export async function assertRecyclingAuthorization({authorization,ownAttempt,...options} = {}) {
  if(ownAttempt !== undefined) {
    const owned=ownedAttempts.get(ownAttempt);
    check(owned && owned.authorization === authorization,'Cleanup attempt is not owned by this live invocation');
    const attempts=options.observed?.cleanupAttempts;
    check(Array.isArray(attempts) && attempts.length === 1,'Exactly the current owned cleanup attempt must be observed');
    const expected={attemptId:owned.attemptId,organismId:authorization.organismId,runId:authorization.runId,applicationId:authorization.applicationIds[0],genomeHash:authorization.genomeHash,definitionHash:authorization.definitionHash,policyHash:authorization.policyHash,archiveManifestSha256:authorization.archiveManifestSha256,snapshotManifestSha256:authorization.snapshotManifestSha256,evidenceManifestSha256:authorization.evidenceManifestSha256,authorizationHash:recyclingAuthorizationHash(authorization),state:'STARTED',completed:false};
    check(same(attempts[0],expected),'Observed cleanup ledger is not the exact unfinished attempt created by this invocation');
    options.observed={...options.observed,cleanupAttempts:[]};
  }
  const current=await createRecyclingAuthorization(options);
  check(same(authorization,current), 'Recycling authorization changed: original policy, locked authority or immutable preservation differs');
  return true;
}
