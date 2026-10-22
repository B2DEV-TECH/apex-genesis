import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {deriveSmokeHashes,assertSmokeReconciliation,isPrivacySafeCapture,oracleFitnessFromEvidence,stageSmokeEvidence} from '../../scripts/application/stage-smoke-evidence.mjs';
import {APPLICATION_BASELINE,canonicalApplicationGenome} from '../../evolution/application/genome.mjs';
import {createHash} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
const runId='a'.repeat(32),id='b'.repeat(32),hash='c'.repeat(64);
// TEST ONLY in-memory assertions. No synthetic selected application is written
// to staging or a publication directory, and the entrypoint refuses TEST runs.
function fixture(){
 const genome=structuredClone(APPLICATION_BASELINE),genomeHash=digest(canonicalApplicationGenome(genome));
 const sourceHashes=['scripts/application/run-smoke.mjs','runtime/application/tasks.mjs','database/packages/apxgen_app_fitness.sql','experiments/configurations/application-feasibility-v1.json'].map(path=>({path,sha256:hash}));
 const decision={STATE:'REJECTED',ELIGIBLE:0,FITNESS:0,SELECTED:0,REASON:'Recorded ineligible outcome'};
 const candidate={organismId:id,generation:0,parentId:null,applicationId:130,genome,genomeHash,definitionHash:hash,oracleDecision:decision};
 const run={testOnly:true,kind:'TEST_ONLY_SYNTHETIC',runId,sourceHashes,protocolHash:hash,browserVersion:'141.0.0.0',candidates:[candidate]};
 const snapshot={run:{runId,fitnessDefinition:'order-lab-task-proxy/2.0.0'},organisms:[{id,runId,generation:0,parentId:null,applicationId:130,genomeJson:canonicalApplicationGenome(genome),genomeHash,artifactHash:hash,state:'REJECTED',eligible:0,fitness:0,selected:0,reason:decision.REASON,metricsJson:null}],events:{[id]:[]},attempts:{[id]:[]}};
 return {run,snapshot,candidate};
}
test('recorded source identity is order-independent and never hashes fresh working files',()=>{
 const {run}=fixture(),first=deriveSmokeHashes(run);assert.deepEqual(deriveSmokeHashes({...run,sourceHashes:[...run.sourceHashes].reverse()}),first);
 const changed=structuredClone(run);changed.sourceHashes[0].sha256='d'.repeat(64);assert.notEqual(deriveSmokeHashes(changed).sourceHash,first.sourceHash);assert.notEqual(deriveSmokeHashes(changed).evaluatorHash,first.evaluatorHash);
 const duplicate=structuredClone(run);duplicate.sourceHashes.push(duplicate.sourceHashes[0]);assert.throws(()=>deriveSmokeHashes(duplicate),/duplicate/i);
});
test('the native queue protocol is independently bound without changing historical fingerprints',()=>{
 const {run}=fixture(),queued=structuredClone(run);queued.protocolSourcePath='experiments/configurations/application-queued-feasibility-v1.json';queued.sourceHashes.find(source=>source.path==='experiments/configurations/application-feasibility-v1.json').path=queued.protocolSourcePath;
 const result=deriveSmokeHashes(queued);assert.notEqual(result.sourceHash,deriveSmokeHashes(run).sourceHash);assert.notEqual(result.evaluatorHash,deriveSmokeHashes(run).evaluatorHash);
 queued.protocolSourcePath='private/unsupported-protocol.json';assert.throws(()=>deriveSmokeHashes(queued),/protocol|source/i);
});
test('the published genuine feasibility run retains its original source and evaluator fingerprints',async()=>{
 const summary=JSON.parse(await readFile(new URL('../../experiments/published-results/living-feasibility/summary.json',import.meta.url),'utf8'));
 assert.deepEqual(deriveSmokeHashes(summary),{sourceHash:summary.sourceHash,evaluatorHash:summary.evaluatorHash});
 const protocol=await readFile(new URL('../../experiments/configurations/application-feasibility-v1.json',import.meta.url));assert.equal(digest(protocol),summary.protocolHash);
});
test('the genuine native result binds its separate queued protocol and recorded source fingerprints',async()=>{
 const summary=JSON.parse(await readFile(new URL('../../experiments/published-results/living-native-feasibility/summary.json',import.meta.url),'utf8'));
 assert.deepEqual(deriveSmokeHashes(summary),{sourceHash:summary.sourceHash,evaluatorHash:summary.evaluatorHash});
 const protocol=await readFile(new URL('../../experiments/configurations/application-queued-feasibility-v1.json',import.meta.url));assert.equal(digest(protocol),summary.protocolHash);
 assert.equal(summary.nativeControl.queueState,'COMPLETED');assert.equal(summary.nativeControl.successfulStartCount,1);
});
test('cached Oracle decisions, DNA, parent and source identities must match readonly records',()=>{
 const {run,snapshot}=fixture();assert.equal(assertSmokeReconciliation(run,snapshot),true);
 for(const mutate of [s=>{s.organisms[0].fitness=1;},s=>{s.organisms[0].parentId='d'.repeat(32);},s=>{s.organisms[0].genomeHash='d'.repeat(64);},s=>{s.organisms[0].applicationId=131;},s=>{s.organisms=[];}]){const bad=structuredClone(snapshot);mutate(bad);assert.throws(()=>assertSmokeReconciliation(run,bad),/Oracle|candidate|genome|identity|missing/i);}
});
test('recorded evaluator identity rejects missing, contradictory and unsafe provenance',()=>{
 for(const mutate of [run=>{run.sourceHashes.pop();},run=>{run.protocolHash='d'.repeat(64);},run=>{run.sourceHashes[0].path='../private/credentials.json';},run=>{run.browserVersion='unknown';}]){const {run}=fixture();mutate(run);assert.throws(()=>deriveSmokeHashes(run),/source|protocol|evaluator|path/i);}
});
test('Oracle event and import-attempt caches cannot contradict authoritative chronology',()=>{
 const {run,snapshot,candidate}=fixture(),time='2026-10-22T14:26:00.000Z';
 snapshot.events[id]=[{EVENT_ID:1,STATE:'GENOME_CREATED',DETAIL:null,RECORDED_AT:time}];candidate.oracleEvents=structuredClone(snapshot.events[id]);
 snapshot.attempts[id]=[{ATTEMPT_ID:'d'.repeat(32),ORGANISM_ID:id,RUN_ID:runId,APPLICATION_ID:130,DEFINITION_HASH:hash,STATE:'VERIFIED',ERROR_CODE:null,CREATED_AT:time,COMPLETED_AT:'2026-10-22T14:27:00.000Z'}];candidate.importAttempt=[{ATTEMPT_ID:'d'.repeat(32),STATE:'VERIFIED',ERROR_CODE:null,CREATED_AT:time,COMPLETED_AT:'2026-10-22T14:27:00.000Z'}];
 assert.equal(assertSmokeReconciliation(run,snapshot),true);
 for(const mutate of [value=>{value.events[id][0].RECORDED_AT='unknown';},value=>{value.events[id].push({...value.events[id][0]});},value=>{value.attempts[id][0].RUN_ID='f'.repeat(32);},value=>{value.attempts[id][0].COMPLETED_AT='2026-10-22T14:25:00.000Z';},value=>{value.attempts[id][0].STATE='UNCERTAIN';}]){const changed=structuredClone(snapshot);mutate(changed);assert.throws(()=>assertSmokeReconciliation(run,changed),/Oracle|chronology|cached/i);}
});
test('Oracle metrics stay bound to the exact recorded browser observations',()=>{
 const {run,snapshot,candidate}=fixture();candidate.metrics={fitnessDefinition:'order-lab-task-proxy/2.0.0',tasks:{locateOrder:{success:true,actions:3,navigationSteps:1}}};snapshot.organisms[0].metricsJson=JSON.stringify(candidate.metrics);
 assert.equal(assertSmokeReconciliation(run,snapshot),true);snapshot.organisms[0].metricsJson=JSON.stringify({...candidate.metrics,tasks:{locateOrder:{success:false,actions:3,navigationSteps:1}}});assert.throws(()=>assertSmokeReconciliation(run,snapshot),/metrics/i);
});
test('a rejected incomplete import has no invented evaluation or public zero score',()=>{
 const {snapshot}=fixture(),row=snapshot.organisms[0];assert.equal(oracleFitnessFromEvidence(row,[{STATE:'REJECTED',RECORDED_AT:'2026-10-22T14:26:00.000Z'}]),null);
 assert.throws(()=>oracleFitnessFromEvidence({...row,fitness:1},[]),/unrecorded|evaluation/i);
 assert.throws(()=>oracleFitnessFromEvidence({...row,selected:1},[]),/unrecorded|evaluation/i);
 const metrics={fitnessDefinition:'order-lab-task-proxy/2.0.0',genomeFingerprint:row.genomeHash};row.metricsJson=JSON.stringify(metrics);row.eligible=1;row.fitness=89.675;
 const events=[{STATE:'EVALUATED',RECORDED_AT:'2026-10-22T14:26:00.000Z'}];assert.deepEqual(oracleFitnessFromEvidence(row,events),{eligible:true,score:89.675,completedAt:events[0].RECORDED_AT});
 assert.throws(()=>oracleFitnessFromEvidence(row,[]),/unrecorded|evaluation/i);assert.throws(()=>oracleFitnessFromEvidence(row,[...events,...events]),/duplicate|evaluation/i);
});
test('old body captures never establish privacy-safe screenshot proof',()=>{
 assert.equal(isPrivacySafeCapture({width:390,crop:'.t-Body-content',sha256:hash}),false);
 const safe={width:390,crop:'visible content below header',captureMethod:'Playwright browser screenshot with viewport clip; no image editing',sha256:hash,clip:{x:0,y:58,width:390,height:942}};
 assert.equal(isPrivacySafeCapture(safe),true);assert.equal(isPrivacySafeCapture({...safe,clip:{...safe.clip,height:1001}}),false);assert.equal(isPrivacySafeCapture({...safe,sha256:'unknown'}),false);
 assert.equal(isPrivacySafeCapture({...safe,clip:undefined}),false);assert.equal(isPrivacySafeCapture({...safe,clip:{...safe.clip,y:0,height:1000}}),false);assert.equal(isPrivacySafeCapture({...safe,clip:{...safe.clip,width:768}}),false);
});
test('the staging entrypoint refuses TEST runs before database access or output creation',async()=>{
 const local=resolve('.local');await mkdir(local,{recursive:true});const root=await mkdtemp(join(local,'stage-boundary-test-'));
 try{const runEvidencePath=join(root,'TEST-run-evidence.json'),outputRoot=join(root,'output');await writeFile(runEvidencePath,JSON.stringify(fixture().run));await assert.rejects(stageSmokeEvidence({runEvidencePath,outputRoot}),/TEST|real.*run/i);await assert.rejects(access(outputRoot),{code:'ENOENT'});}
 finally{const target=resolve(root);if(!target.startsWith(local+sep))throw new Error('Unsafe stage test cleanup');await rm(target,{recursive:true,force:true});}
});
