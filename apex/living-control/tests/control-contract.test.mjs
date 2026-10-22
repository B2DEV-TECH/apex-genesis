import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {hashApplicationDefinition} from '../../../scripts/application/build-definition.mjs';
import {fileURLToPath} from 'node:url';
import {assertControlInstallation} from '../install-control.mjs';
const contractUrl=new URL('../template/shared-components/static-files/control-contract.mjs',import.meta.url);

test('infrastructure installation requires the dedicated explicit owner and mode',()=>{
 const policy={schemaVersion:'1.0',enabled:true,environment:'development',schema:'APXGEN_ORDER_LAB',workspace:'APXGEN_ORDER_LAB',workspaceId:123456789,applicationIds:[130,131,132,133],protectedApplicationIds:[120,121],fixtureWritesAuthorized:true,maxConcurrentImports:1,maxMaterializationsPerRun:22};
 const oracle={user:'APXGEN_ORDER_LAB',workspace:'APXGEN_ORDER_LAB',connectString:'localhost:1521/FREEPDB1',password:'TEST_ONLY_NOT_A_CREDENTIAL'};
 assert.equal(assertControlInstallation(policy,oracle,'INSTALL_DISABLED_CONTROL'),true);
 for(const [p,o,m] of [[policy,{...oracle,user:'APXGEN_LAB'},'INSTALL_DISABLED_CONTROL'],[{...policy,enabled:false},oracle,'INSTALL_DISABLED_CONTROL'],[{...policy,applicationIds:[120,130]},oracle,'INSTALL_DISABLED_CONTROL'],[policy,oracle,'IMPORT'],[policy,oracle,undefined]])assert.throws(()=>assertControlInstallation(p,o,m));
});

test('draft validation requires explicit integer budgets and excludes paid or executable fields',async()=>{
 const {validateDraft}=await import(contractUrl.href);
 const caps={capabilityVersion:'order-lab-queued-feasibility/1.0',supportedSeed:50000,maxGenerations:1,maxMaterializations:2};
 const good={label:'Synthetic order experiment',seed:50000,generations:1,materializationBudget:2};
 assert.deepEqual(validateDraft(good,caps),good);
 for(const value of [{...good,seed:50001},{...good,seed:'50000'},{...good,seed:null},{...good,generations:1.1},{...good,generations:2,materializationBudget:3},{...good,materializationBudget:1},{...good,materializationBudget:3},{...good,label:' '},{...good,label:'TEST\nlabel'},{...good,label:'TEST\u0000label'},{...good,label:'TEST\u007flabel'},{...good,mode:'HYBRID'},{...good,sql:'select 1 from dual'},{...good,applicationId:120},{...good,provider:'any'}])assert.throws(()=>validateDraft(value,caps));
});

test('watch distinguishes queued work from actual Oracle outcomes and preserves unknown evidence',async()=>{
 const {validateWatch,watchLines}=await import(contractUrl.href);
 const request={id:'a'.repeat(32),label:'<img src=x onerror=alert(1)>',state:'QUEUED',seed:50000,generations:1,materializationBudget:2,runId:null};
 const pending={request,run:null,organisms:[],events:[]};
 assert.deepEqual(validateWatch(pending),pending);
 assert.ok(watchLines(pending).includes('No Oracle run is linked. Evolution has not started.'));
 const id='b'.repeat(32),runId='c'.repeat(32);
 const actual={request:{...request,state:'CLAIMED',runId},run:{id:runId,state:'RUNNING',materializations:0,budget:2,fitnessDefinition:'order-lab-task-proxy/2.0.0'},organisms:[{id,generation:0,parentId:null,applicationId:null,state:'GENOME_CREATED',eligible:null,fitness:null,selected:false,reason:null}],events:[{organismId:id,state:'GENOME_CREATED',recordedAt:'2026-10-22T00:00:00.000Z'}]};
 assert.deepEqual(validateWatch(actual),actual);
 assert.ok(watchLines(actual).some(line=>line.includes('not evaluated')));
 for(const bad of [{...pending,leaseToken:'secret'},{...pending,request:{...request,state:'COMPLETE'}},{...actual,run:{...actual.run,id:'d'.repeat(32)}},{...actual,organisms:[{...actual.organisms[0],fitness:0}]},{...pending,organisms:actual.organisms},{...actual,events:[{...actual.events[0],organismId:'e'.repeat(32)}]}])assert.throws(()=>validateWatch(bad));
});

test('advertised capability is exactly the implemented feasibility protocol',async()=>{
 const {validateStatus}=await import(contractUrl.href);
 const status={canCreate:false,canStart:false,capabilityVersion:'order-lab-queued-feasibility/1.0',supportedSeed:50000,maxGenerations:1,maxMaterializations:2,requests:[]};
 assert.deepEqual(validateStatus(status),status);
 for(const bad of [{...status,supportedSeed:50001},{...status,maxGenerations:2},{...status,maxMaterializations:3},{...status,capabilityVersion:'order-lab-feasibility/2.0'}])assert.throws(()=>validateStatus(bad));
});

test('every native page begins disabled, uses authenticated callback, and renders data as text',async()=>{
 const boot=await readFile(new URL('../template/shared-components/static-files/control-boot.js',import.meta.url),'utf8');
 assert.ok(!/innerHTML|insertAdjacentHTML|eval\(/.test(boot));
 for(const file of ['p00001-create.apx','p00002-evolve.apx','p00003-watch.apx']){
  const source=await readFile(new URL('../template/pages/'+file,import.meta.url),'utf8');
  assert.match(source,/authentication: required/);assert.match(source,/apxgen_app_control\.ajax;/);
  assert.match(source,/disabled/);assert.match(source,/unconfigured|not configured/i);
  if(file==='p00001-create.apx')assert.match(source,/name="seed"[^>]*value="50000"[^>]*readonly/);
 }
});

test('recorded offline compiler success remains bound to its immutable original template and output',async()=>{
 const evidence=JSON.parse(await readFile(new URL('../evidence/queued-feasibility-v1/offline-validation.json',import.meta.url),'utf8'));
 const actual=await hashApplicationDefinition(fileURLToPath(new URL('../versions/queued-feasibility-v1/template',import.meta.url)));
 assert.equal(evidence.compilerValid,true);assert.equal(evidence.connected,false);assert.equal(evidence.runtimeVerified,false);
 assert.equal(evidence.definitionHash,actual.definitionHash);assert.deepEqual(evidence.files,actual.files);
 const output=await readFile(new URL('../evidence/queued-feasibility-v1/compiler-output.txt',import.meta.url));
 assert.equal(createHash('sha256').update(output).digest('hex'),evidence.outputSha256);
 assert.match(output.toString('utf8'),/^Validation successful\./m);assert.doesNotMatch(output.toString('utf8'),/Warning|Compile Errors|ORA-\d|Error:/i);
});

const assets=new URL('../template/shared-components/static-files/',import.meta.url),runId='c46d109a8952417ea277daa0696ed698';
async function evidenceModule(){const module=await import(new URL('control-evidence.mjs',assets)).catch(()=>null);assert.ok(module,'Native evidence registry and reconciliation must exist');return module;}
async function assetReader(transform=bytes=>bytes){let requests=0;return {get requests(){return requests;},async fetcher(url){requests++;const value=new URL(url);assert.equal(value.origin,'https://native.test');assert.ok(value.pathname.startsWith('/static/evidence/'));const path=value.pathname.slice('/static/'.length);const bytes=transform(await readFile(new URL(path,assets)),path);return new Response(bytes,{status:200});}};}
function watchFor(publication){return {request:{id:'7bcff90329154f549db36272a84dc707',label:'UNIT TEST projection of the actual recorded request',state:'COMPLETED',seed:50000,generations:1,materializationBudget:2,runId},run:{id:runId,state:'COMPLETE',materializations:2,budget:2,fitnessDefinition:'order-lab-task-proxy/2.0.0'},organisms:publication.candidates.map(candidate=>({id:candidate.id,generation:candidate.generation,parentId:candidate.parentId,applicationId:candidate.applicationId,state:candidate.selected?'SELECTED':'REJECTED',eligible:candidate.stages.fitness.eligible,fitness:candidate.fitness,selected:candidate.selected,reason:candidate.rejectionReason||'Eligible improvement selected by Oracle'})),events:[]};}
test('native assets contain the exact complete genuine package and an unchanged strict public loader',async()=>{
 const module=await evidenceModule(),entry=module.NATIVE_EVIDENCE[runId];assert.deepEqual(Object.keys(module.NATIVE_EVIDENCE),[runId]);assert.equal(entry.manifestSha256,'9884a0b6070d697a828f24193647878fbce13938ba0279ad69299f3568a5427e');assert.equal(entry.objects,49);assert.equal(entry.bytes,275656);
 const original=await readFile(new URL('../../../showcase/living-evidence.mjs',import.meta.url)),copy=await readFile(new URL('living-evidence.mjs',assets));assert.ok(original.equals(copy),'Copied strict loader must stay byte-identical to source');
 const manifestBytes=await readFile(new URL(entry.manifestPath,assets)),manifest=JSON.parse(manifestBytes);assert.equal(createHash('sha256').update(manifestBytes).digest('hex'),entry.manifestSha256);
 const catalog=await hashApplicationDefinition(fileURLToPath(new URL('.',new URL(entry.manifestPath,assets))));assert.equal(catalog.files.length,49);
 for(const file of manifest.files){const bytes=await readFile(new URL(file.path,new URL(entry.manifestPath,assets)));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
 const declarations=await readFile(new URL('../template/shared-components/static-files.apx',import.meta.url),'utf8');for(const file of catalog.files)assert.ok(declarations.includes('"'+entry.manifestPath.replace(/manifest\.json$/,'')+file.path+'"'));
});
test('all actual native candidate bindings must agree before images, with one bounded cached package',async()=>{
 const {createNativeEvidenceReader,reconcileNativeEvidence}=await evidenceModule(),disk=await assetReader(),reader=createNativeEvidenceReader({baseUrl:'https://native.test/static/control-boot.js',fetcher:disk.fetcher});
 const {loadLivingEvidence}=await import(new URL('living-evidence.mjs',assets));const publication=await loadLivingEvidence('evidence/'+runId+'/manifest.json',{baseUrl:'https://native.test/static/',fetcher:disk.fetcher,expectedManifestSha256:'9884a0b6070d697a828f24193647878fbce13938ba0279ad69299f3568a5427e'});const watch=watchFor(publication);assert.equal(reconcileNativeEvidence(watch,publication),publication);
 const before=disk.requests;assert.equal((await reader(watch)).candidates.length,2);assert.equal(disk.requests-before,49);await reader(watch);assert.equal(disk.requests-before,49,'Repeated viewing must reuse the single verified immutable package');
 for(const [key,value]of [['id','f'.repeat(32)],['parentId','e'.repeat(32)],['generation',2],['applicationId',150],['eligible',false],['fitness',89],['selected',true],['state','SELECTED']]){const changed=structuredClone(watch);changed.organisms[1][key]=value;assert.throws(()=>reconcileNativeEvidence(changed,publication),/match|identity|evidence|binding/i,key);}
 const missing=structuredClone(watch);missing.organisms.pop();assert.throws(()=>reconcileNativeEvidence(missing,publication),/match|identity|evidence|binding/i);const extra=structuredClone(watch);extra.organisms.push({...extra.organisms[1],id:'d'.repeat(32)});assert.throws(()=>reconcileNativeEvidence(extra,publication),/match|identity|evidence|binding/i);
});
test('unknown runs fetch nothing and corrupted native evidence never becomes a comparison',async()=>{
 const {createNativeEvidenceReader}=await evidenceModule();let calls=0;const unknown=createNativeEvidenceReader({baseUrl:'https://native.test/static/control-boot.js',fetcher:async()=>{calls++;throw new Error('Must not fetch');}});const pending={request:{id:'a'.repeat(32),label:'UNIT TEST unknown draft',state:'DRAFT',seed:50000,generations:1,materializationBudget:2,runId:null},run:null,organisms:[],events:[]};assert.equal(await unknown(pending),null);assert.equal(calls,0);
 const {loadLivingEvidence}=await import(new URL('living-evidence.mjs',assets)),disk=await assetReader(),publication=await loadLivingEvidence('evidence/'+runId+'/manifest.json',{baseUrl:'https://native.test/static/',fetcher:disk.fetcher,expectedManifestSha256:'9884a0b6070d697a828f24193647878fbce13938ba0279ad69299f3568a5427e'}),watch=watchFor(publication);
 for(const suffix of ['manifest.json','orders-1440.png']){const broken=await assetReader((bytes,path)=>{if(path.endsWith(suffix)){bytes=Buffer.from(bytes);bytes[bytes.length-1]^=1;}return bytes;});await assert.rejects(createNativeEvidenceReader({baseUrl:'https://native.test/static/control-boot.js',fetcher:broken.fetcher})(watch),/integrity|hash|evidence/i);}
});
test('native UI compiler proof binds this source and only its exact embedded-source warning set',async()=>{
 const evidenceRoot=new URL('../evidence/native-ui-v1/',import.meta.url),evidence=JSON.parse(await readFile(new URL('offline-validation.json',evidenceRoot),'utf8')),actual=await hashApplicationDefinition(fileURLToPath(new URL('../template',import.meta.url))),output=await readFile(new URL('compiler-output.txt',evidenceRoot));
 assert.equal(evidence.compilerValid,true);assert.equal(evidence.connected,false);assert.equal(evidence.runtimeVerified,false);assert.equal(evidence.definitionHash,actual.definitionHash);assert.deepEqual(evidence.files,actual.files);assert.equal(createHash('sha256').update(output).digest('hex'),evidence.outputSha256);
 const pattern=/File: ([^\r\n]+)\r?\nLine: 0\r?\nColumn: 0\r?\nType: FILE_IGNORED\r?\nWarning: APEXlang source file ignored\./g,records=[...output.toString('utf8').matchAll(pattern)].map(match=>match[1]).sort(),manifest=JSON.parse(await readFile(new URL('evidence/'+runId+'/manifest.json',assets))),expected=manifest.files.filter(file=>file.path.endsWith('.apx')).map(file=>'shared-components/static-files/evidence/'+runId+'/'+file.path).sort();
 assert.equal(records.length,20);assert.deepEqual(records,expected);assert.equal(evidence.warningReview.reviewed,true);assert.equal(evidence.warningReview.count,20);assert.deepEqual(evidence.warningReview.records.map(record=>record.path).sort(),expected);assert.equal(output.toString('utf8').replace(pattern,'').replace('APEXlang Compile Warnings:','').replace('Validation successful.','').trim(),'');
});
