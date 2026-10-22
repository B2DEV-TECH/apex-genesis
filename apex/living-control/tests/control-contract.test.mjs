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

test('recorded offline compiler success remains bound to exactly this template and output',async()=>{
 const evidence=JSON.parse(await readFile(new URL('../evidence/queued-feasibility-v1/offline-validation.json',import.meta.url),'utf8'));
 const actual=await hashApplicationDefinition(fileURLToPath(new URL('../template',import.meta.url)));
 assert.equal(evidence.compilerValid,true);assert.equal(evidence.connected,false);assert.equal(evidence.runtimeVerified,false);
 assert.equal(evidence.definitionHash,actual.definitionHash);assert.deepEqual(evidence.files,actual.files);
 const output=await readFile(new URL('../evidence/queued-feasibility-v1/compiler-output.txt',import.meta.url));
 assert.equal(createHash('sha256').update(output).digest('hex'),evidence.outputSha256);
 assert.match(output.toString('utf8'),/^Validation successful\./m);assert.doesNotMatch(output.toString('utf8'),/Warning|Compile Errors|ORA-\d|Error:/i);
});
