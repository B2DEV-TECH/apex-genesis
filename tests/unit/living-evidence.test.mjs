import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadLivingEvidence,validateLivingManifest} from '../../showcase/living-evidence.mjs';
import {canonicalLivingGenome} from '../../showcase/living-evidence.mjs';
import {APPLICATION_BASELINE,APPLICATION_TRAITS,canonicalApplicationGenome} from '../../evolution/application/genome.mjs';

// Synthetic boundary fixtures only. They are never exported into showcase data
// and the production loader rejects their explicit TEST marker by default.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash='a'.repeat(64),evaluator='b'.repeat(64);
const taskNames=['locateOrder','filterOrders','updateOrder'];
function fixture(){
 const files=new Map();
 const put=(path,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value));files.set(path,bytes);return sha(bytes);};
 const genome={schemaVersion:'2.0',application:'GENESIS_ORDER_LAB',dataSource:'GENESIS_ORDERS_SAFE_V',tasks:taskNames,traits:{report:'classicReport',edit:'page',filters:'above',summary:'before',navigation:'side',density:'comfortable'}};
 const genomeHash=put('genomes/parent.json',genome),artifactHash=put('artifacts/parent.apx','application genesis-order-lab ( name: Genesis Order Lab )');
 const candidate={id:'TEST-parent',runId:'TEST-run',generation:0,parentId:null,genomePath:'genomes/parent.json',artifactPath:'artifacts/parent.apx',genomeHash,artifactHash,applicationId:9000,sourceHash:hash,evaluatorHash:evaluator,selected:true,fitness:75,fitnessEvidence:'evidence/parent-fitness.json',validation:null,import:null,runtime:null,tasks:{},screenshots:[]};
 const bindings={candidateId:candidate.id,runId:candidate.runId,applicationId:candidate.applicationId,genomeHash,artifactHash,sourceHash:hash,evaluatorHash:evaluator};
 let minute=0;
 const stage=(name,extra={})=>{const path='evidence/parent-'+name.replace(':','-')+'.json';put(path,{...bindings,stage:name,success:true,completedAt:`2026-10-22T00:${String(minute++).padStart(2,'0')}:00.000Z`,...extra});return {success:true,evidence:path};};
 candidate.validation=stage('validation');candidate.import=stage('import');candidate.runtime=stage('runtime');
 for(const name of taskNames)candidate.tasks[name]=stage('task:'+name);
 stage('fitness',{authority:'ORACLE',definition:'order-lab-task-proxy/2.0.0',eligible:true,score:75});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=','base64');
 put('screenshots/parent.png',png);candidate.screenshots.push({path:'screenshots/parent.png',viewport:{width:1440,height:900},alt:'TEST ONLY synthetic image'});
 put('candidates/parent.json',candidate);
 const manifest={schemaVersion:'1.0',experimentType:'APEX_APPLICATION',genomeSchemaVersion:'2.0',fitnessDefinition:'order-lab-task-proxy/2.0.0',sourceHash:hash,evaluatorHash:evaluator,testOnly:true,candidates:['candidates/parent.json'],files:[]};
 function refresh(){manifest.files=[...files].map(([path,bytes])=>({path,sha256:sha(bytes),bytes:bytes.length}));}
 const mutateCandidate=fn=>{fn(candidate);put('candidates/parent.json',candidate);refresh();};
 refresh();
 const fetcher=async url=>{const path=new URL(url).pathname.replace('/fixture/','');const bytes=path==='manifest.json'?Buffer.from(JSON.stringify(manifest)):files.get(path);return new Response(bytes||'missing',{status:bytes?200:404});};
 return {manifest,files,candidate,put,refresh,mutateCandidate,fetcher};
}
const load=(f,extra={})=>loadLivingEvidence('fixture/manifest.json',{baseUrl:'https://example.test/living.html',fetcher:f.fetcher,allowTestFixtures:true,...extra});

test('Living Applications rejects TEST evidence in the public loader',async()=>{
 const f=fixture();await assert.rejects(load(f,{allowTestFixtures:false}),/TEST|test fixture/i);
 f.manifest.testOnly=false;await assert.rejects(load(f,{allowTestFixtures:false}),/TEST|test fixture/i);
});
test('public genome grammar agrees with the private canonical boundary for every allele',()=>{
 assert.equal(canonicalLivingGenome(APPLICATION_BASELINE),canonicalApplicationGenome(APPLICATION_BASELINE));
 for(const [trait,values]of Object.entries(APPLICATION_TRAITS))for(const value of values){const genome=structuredClone(APPLICATION_BASELINE);genome.traits[trait]=value;assert.equal(canonicalLivingGenome(genome),canonicalApplicationGenome(genome));}
 const extra=structuredClone(APPLICATION_BASELINE);extra.traits.execute='begin null; end;';assert.throws(()=>canonicalLivingGenome(extra),/unknown|field/i);
});
test('verified evidence binds source, artifact, stages, screenshots and Oracle selection',async()=>{
 const f=fixture(),result=await load(f);assert.equal(result.testOnly,true);assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].status,'verified');assert.equal(result.candidates[0].selected,true);assert.equal(result.candidates[0].screenshots[0].bytes.length,f.files.get('screenshots/parent.png').length);
});
test('a complete selected child is bound to its actual verified parent',async()=>{
 // Rejected intermediate generations do not require fabricated elite copies.
 const f=fixture(),child=structuredClone(f.candidate);child.id='TEST-child';child.generation=3;child.parentId=f.candidate.id;child.applicationId=9001;
 const genome=JSON.parse(f.files.get(child.genomePath));genome.traits.density='compact';child.genomePath='genomes/child.json';child.genomeHash=f.put(child.genomePath,genome);child.artifactPath='artifacts/child.apx';child.artifactHash=f.put(child.artifactPath,'application genesis-order-lab ( name: Genesis Order Lab child )');
 for(const [name,observation]of [['validation',child.validation],['import',child.import],['runtime',child.runtime],...taskNames.map(task=>['task:'+task,child.tasks[task]]),['fitness',{evidence:child.fitnessEvidence}]]){const record=JSON.parse(f.files.get(observation.evidence));Object.assign(record,{candidateId:child.id,applicationId:child.applicationId,genomeHash:child.genomeHash,artifactHash:child.artifactHash,completedAt:record.completedAt.replace('T00:','T01:')});const path='evidence/child-'+name.replace(':','-')+'.json';f.put(path,record);if(name==='fitness')child.fitnessEvidence=path;else observation.evidence=path;}
 f.put('candidates/child.json',child);f.manifest.candidates.push('candidates/child.json');f.refresh();const result=await load(f);assert.deepEqual(result.candidates.map(c=>[c.id,c.parentId,c.generation,c.status]),[['TEST-parent',null,0,'verified'],['TEST-child','TEST-parent',3,'verified']]);
});
test('a sanitized application bundle verifies its actual density stylesheet too',async()=>{
 const f=fixture();f.put('artifacts/order-lab.css','.order-lab-compact { padding: .35rem; }');const artifactHash=f.put('artifacts/bundle.json',{files:['artifacts/parent.apx','artifacts/order-lab.css']});f.mutateCandidate(c=>{c.artifactPath='artifacts/bundle.json';c.artifactHash=artifactHash;});for(const [path,bytes]of [...f.files])if(path.startsWith('evidence/')){const record=JSON.parse(bytes);record.artifactHash=artifactHash;f.put(path,record);}f.refresh();assert.equal((await load(f)).candidates[0].artifactHash,artifactHash);
});
test('every artifact is hash checked before a candidate can be displayed',async()=>{
 for(const path of ['candidates/parent.json','genomes/parent.json','artifacts/parent.apx','evidence/parent-runtime.json','screenshots/parent.png']){const f=fixture(),corrupt=Buffer.from(f.files.get(path));corrupt[0]^=1;f.files.set(path,corrupt);await assert.rejects(load(f),/integrity|size|hash/i,path);}
});
test('duplicate JSON keys cannot turn contradictory evidence into success',async()=>{
 const f=fixture(),path='evidence/parent-runtime.json';f.put(path,f.files.get(path).toString('utf8').replace('"success":true','"success":false,"success":true'));f.refresh();await assert.rejects(load(f),/duplicate/i);
 const g=fixture(),fetcher=async url=>{const response=await g.fetcher(url);if(new URL(url).pathname.endsWith('/manifest.json'))return new Response((await response.text()).replace('"schemaVersion":"1.0"','"schemaVersion":"0.0","schemaVersion":"1.0"'));return response;};await assert.rejects(load(g,{fetcher}),/duplicate/i);
});
test('an expected manifest hash anchors the root and refuses tampered publication indexes',async()=>{
 const f=fixture(),expectedManifestSha256=sha(Buffer.from(JSON.stringify(f.manifest)));assert.equal((await load(f,{expectedManifestSha256})).candidates.length,1);
 f.manifest.candidates=[];await assert.rejects(load(f,{expectedManifestSha256}),/manifest.*integrity|manifest.*hash/i);
 let fetched=0;await assert.rejects(load(f,{expectedManifestSha256:'unknown',fetcher:async()=>{fetched++;throw new Error('Unexpected fetch');}}),/manifest.*hash/i);assert.equal(fetched,0);
});
test('oversized response bodies are stopped at the published byte bound',async()=>{
 const f=fixture(),path='screenshots/parent.png';f.files.set(path,Buffer.alloc(1024*1024));await assert.rejects(load(f),/size|limit|integrity/i);
});
test('a screenshot signature cannot be replaced by active document bytes',async()=>{
 const f=fixture();f.put('screenshots/parent.png','<svg xmlns="http://www.w3.org/2000/svg"><script>throw 1</script></svg>');f.refresh();await assert.rejects(load(f),/image format|screenshot/i);
});
test('public paths, duplicate files and version mixing fail closed',async()=>{
 const f=fixture();
 for(const path of ['../x.json','/x.json','https://example.test/x.json','x\\y.json','x/%2e%2e/y.json','x.json?session=1'])assert.throws(()=>validateLivingManifest({...f.manifest,candidates:[path]},{allowTestFixtures:true}),/path/i);
 assert.throws(()=>validateLivingManifest({...f.manifest,files:[...f.manifest.files,f.manifest.files[0]]},{allowTestFixtures:true}),/duplicate/i);
 for(const [key,value] of [['schemaVersion','2.0'],['experimentType','DASHBOARD'],['genomeSchemaVersion','1.0'],['fitnessDefinition','legacy']])assert.throws(()=>validateLivingManifest({...f.manifest,[key]:value},{allowTestFixtures:true}),/version|type|definition/i);
});
test('selected candidates require complete real stage and Oracle score evidence',async()=>{
 for(const key of ['validation','import','runtime','fitnessEvidence']){const f=fixture();f.mutateCandidate(c=>{c[key]=null;});await assert.rejects(load(f),/evidence|chain|selected|fitness/i,key);}
 const f=fixture();f.mutateCandidate(c=>{c.tasks.updateOrder=null;});await assert.rejects(load(f),/evidence|chain|selected|fitness/i);
 const g=fixture();const record=JSON.parse(g.files.get('evidence/parent-fitness.json'));record.authority='BROWSER';g.put('evidence/parent-fitness.json',record);g.refresh();await assert.rejects(load(g),/Oracle|authority/i);
});
test('false and ambiguous task outcomes never become survivors or fitness',async()=>{
 for(const success of [false,null]){const f=fixture();f.mutateCandidate(c=>{c.selected=false;c.fitness=null;c.fitnessEvidence=null;c.tasks.updateOrder.success=success;c.screenshots=[];});const p='evidence/parent-task-updateOrder.json';const record=JSON.parse(f.files.get(p));record.success=success;f.put(p,record);f.refresh();assert.equal((await load(f)).candidates[0].status,success===false?'task-failed':'ambiguous');}
});
test('a genome-only rejection needs no invented artifact or application identity',async()=>{
 const f=fixture();f.mutateCandidate(c=>{c.artifactPath=null;c.artifactHash=null;c.applicationId=null;c.validation=null;c.import=null;c.runtime=null;c.tasks=Object.fromEntries(taskNames.map(t=>[t,null]));c.selected=false;c.fitness=null;c.fitnessEvidence=null;c.screenshots=[];c.rejectionReason='Unverified structural mapping rejected before materialization';});const result=await load(f);assert.equal(result.candidates[0].status,'rejected');assert.equal(result.candidates[0].applicationId,null);assert.equal(result.candidates[0].artifactHash,null);
});
test('actual runtime screenshots remain inspectable after a failed task',async()=>{
 const f=fixture();f.mutateCandidate(c=>{c.selected=false;c.fitness=null;c.fitnessEvidence=null;c.tasks.updateOrder.success=false;c.rejectionReason='Recorded update assertion failed';});const path='evidence/parent-task-updateOrder.json',record=JSON.parse(f.files.get(path));record.success=false;f.put(path,record);f.refresh();const candidate=(await load(f)).candidates[0];assert.equal(candidate.status,'task-failed');assert.equal(candidate.screenshots.length,1);assert.equal(candidate.selected,false);
});
test('an eligible unselected challenger retains its genuine task score and loss reason',async()=>{
 const f=fixture();f.mutateCandidate(c=>{c.selected=false;c.rejectionReason='Candidate did not exceed the surviving parent';});const candidate=(await load(f)).candidates[0];assert.equal(candidate.status,'verified');assert.equal(candidate.selected,false);assert.equal(candidate.fitness,75);assert.equal(candidate.stages.fitness.eligible,true);assert.match(candidate.rejectionReason,/did not exceed/);
 const g=fixture();g.mutateCandidate(c=>{c.rejectionReason='Contradictory rejection';});await assert.rejects(load(g),/rejection|unselected/i);
});
test('successful tasks alone do not establish Oracle eligibility',async()=>{
 const f=fixture();f.mutateCandidate(c=>{c.selected=false;c.fitness=0;});const path='evidence/parent-fitness.json',record=JSON.parse(f.files.get(path));record.eligible=false;record.score=0;f.put(path,record);f.refresh();assert.equal((await load(f)).candidates[0].status,'ineligible');
 f.mutateCandidate(c=>{c.selected=true;});await assert.rejects(load(f),/selected|Oracle|fitness/i);
});
test('task effort counters are optional actual measurements with strict numeric bounds',async()=>{
 const f=fixture(),path='evidence/parent-task-locateOrder.json',record=JSON.parse(f.files.get(path));Object.assign(record,{actions:3,navigationSteps:1,elapsedMs:250});f.put(path,record);f.refresh();assert.equal((await load(f)).candidates[0].stages['task:locateOrder'].actions,3);
 record.navigationSteps=4;f.put(path,record);f.refresh();await assert.rejects(load(f),/counter|navigation|measurement/i);
});
test('generated and imported are separate states and later stages cannot skip a gate',async()=>{
 const f=fixture();f.mutateCandidate(c=>{c.validation=null;c.import=null;c.runtime=null;c.tasks=Object.fromEntries(taskNames.map(t=>[t,null]));c.selected=false;c.fitness=null;c.fitnessEvidence=null;c.screenshots=[];});assert.equal((await load(f)).candidates[0].status,'generated');
 const g=fixture();g.mutateCandidate(c=>{c.runtime=null;c.tasks=Object.fromEntries(taskNames.map(t=>[t,null]));c.selected=false;c.fitness=null;c.fitnessEvidence=null;c.screenshots=[];});assert.equal((await load(g)).candidates[0].status,'imported');
 const h=fixture();h.mutateCandidate(c=>{c.import.success=false;});const record=JSON.parse(h.files.get('evidence/parent-import.json'));record.success=false;h.put('evidence/parent-import.json',record);h.refresh();await assert.rejects(load(h),/chain|gate/i);
});
test('unknown fields, forged bindings and public sessions are rejected',async()=>{
 const f=fixture();f.mutateCandidate(c=>{c.unexpected='extra';});await assert.rejects(load(f),/unknown|field/i);
 const g=fixture();const record=JSON.parse(g.files.get('evidence/parent-runtime.json'));record.artifactHash='c'.repeat(64);g.put('evidence/parent-runtime.json',record);g.refresh();await assert.rejects(load(g),/binding|artifact/i);
 const h=fixture();h.mutateCandidate(c=>{c.screenshots[0].alt='https://internal.example/apex?session=secret';});await assert.rejects(load(h),/public|URL|session/i);
});
test('missing parents, generation shortcuts and parent cycles cannot invent lineage',async()=>{
 const f=fixture();f.mutateCandidate(c=>{c.parentId='missing';c.generation=1;});await assert.rejects(load(f),/parent|lineage/i);
 const g=fixture();g.mutateCandidate(c=>{c.parentId=c.id;c.generation=1;});await assert.rejects(load(g),/parent|lineage|cycle/i);
 const h=fixture();h.mutateCandidate(c=>{c.generation=1;});await assert.rejects(load(h),/parent|lineage|generation/i);
});
