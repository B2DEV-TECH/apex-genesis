import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {buildPublicEvidence} from '../../scripts/application/package-evidence.mjs';
import {APPLICATION_BASELINE,canonicalApplicationGenome} from '../../evolution/application/genome.mjs';

const local=resolve('.local'),hash='a'.repeat(64),evaluator='b'.repeat(64);
const digest=value=>createHash('sha256').update(value).digest('hex');
async function workspace(fn){await mkdir(local,{recursive:true});const root=await mkdtemp(join(local,'public-evidence-test-'));try{const inputRoot=join(root,'input'),outputDir=join(root,'output');await mkdir(inputRoot);await fn({root,inputRoot,outputDir});}finally{const target=resolve(root);if(!target.startsWith(local+sep))throw new Error('Unsafe publication test cleanup');await rm(target,{recursive:true,force:true});}}
const absent=async path=>{await assert.rejects(access(path),{code:'ENOENT'});};
async function generated(inputRoot){
 const genome=canonicalApplicationGenome(APPLICATION_BASELINE),artifact='application genesis-order-lab ( name: Genesis Order Lab )';
 await writeFile(join(inputRoot,'genome.json'),genome);await writeFile(join(inputRoot,'application.apx'),artifact);
 return {id:'boundary-candidate',runId:'boundary-run',generation:0,parentId:null,genomePath:'genome.json',artifactPath:'application.apx',genomeHash:digest(genome),artifactHash:digest(artifact),applicationId:9000,sourceHash:hash,evaluatorHash:evaluator,selected:false,fitness:null,fitnessEvidence:null,validation:null,import:null,runtime:null,tasks:{locateOrder:null,filterOrders:null,updateOrder:null},screenshots:[]};
}
const args=paths=>({...paths,candidates:[],sourceHash:hash,evaluatorHash:evaluator});

test('an empty publication has verified hashes and copies no unrelated private input',async()=>workspace(async paths=>{
 await writeFile(join(paths.inputRoot,'private-operator-notes.json'),JSON.stringify({password:'TEST ONLY never copied'}));
 const result=await buildPublicEvidence(args(paths)),manifest=JSON.parse(await readFile(join(paths.outputDir,'manifest.json'),'utf8'));
 assert.equal(result.verified,true);assert.equal(result.verifiedCandidates,0);assert.equal(manifest.experimentType,'APEX_APPLICATION');assert.deepEqual(manifest.files,[]);assert.deepEqual(manifest.candidates,[]);await absent(join(paths.outputDir,'private-operator-notes.json'));
}));
test('publication output is exclusively claimed and never merged or overwritten',async()=>workspace(async paths=>{
 await mkdir(paths.outputDir);await writeFile(join(paths.outputDir,'sentinel'),'preserve');
 await assert.rejects(buildPublicEvidence(args(paths)),/exists|new output/i);assert.equal(await readFile(join(paths.outputDir,'sentinel'),'utf8'),'preserve');await absent(join(paths.outputDir,'manifest.json'));
}));
test('TEST candidates cannot be packaged even when they claim successful selection',async()=>workspace(async paths=>{
 await assert.rejects(buildPublicEvidence({...args(paths),candidates:[{id:'TEST-fabricated',runId:'TEST-run',selected:true}]}),/TEST/i);await absent(paths.outputDir);
}));
test('missing stage evidence does not create a public output',async()=>workspace(async paths=>{
 const candidate=await generated(paths.inputRoot);candidate.validation={success:true,evidence:'missing-validation.json'};
 await assert.rejects(buildPublicEvidence({...args(paths),candidates:[candidate]}),/missing|unavailable|ENOENT/i);await absent(paths.outputDir);
}));
test('declared artifact and canonical genome hashes must match the actual bytes',async()=>workspace(async paths=>{
 const candidate=await generated(paths.inputRoot);candidate.genomeHash='c'.repeat(64);
 await assert.rejects(buildPublicEvidence({...args(paths),candidates:[candidate]}),/hash|canonical/i);await absent(paths.outputDir);
}));
test('private URLs, sessions and credentials are rejected before package creation',async()=>workspace(async paths=>{
 const candidate=await generated(paths.inputRoot);const privateArtifact='application genesis-order-lab ( endpoint: https://private.example/apex?session=123 )';await writeFile(join(paths.inputRoot,'application.apx'),privateArtifact);candidate.artifactHash=digest(privateArtifact);
 await assert.rejects(buildPublicEvidence({...args(paths),candidates:[candidate]}),/private|URL|session|sanitized/i);await absent(paths.outputDir);
}));
test('relative traversal and reserved publication paths cannot copy files',async()=>workspace(async paths=>{
 for(const path of ['../outside.apx','/outside.apx','folder\\outside.apx','manifest.json','candidates/collision.json']){const candidate=await generated(paths.inputRoot);candidate.artifactPath=path;await assert.rejects(buildPublicEvidence({...args(paths),candidates:[candidate]}),/path|reserved/i);await absent(paths.outputDir);}
}));
test('unknown candidate fields cannot carry private runtime data into a publication',async()=>workspace(async paths=>{
 const candidate=await generated(paths.inputRoot);candidate.runtimeUrl='https://private.example';await assert.rejects(buildPublicEvidence({...args(paths),candidates:[candidate]}),/unknown|field|URL|private/i);await absent(paths.outputDir);
}));
test('screenshot metadata and appended private bytes are never copied',async()=>workspace(async paths=>{
 const candidate=await generated(paths.inputRoot),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=','base64');await writeFile(join(paths.inputRoot,'capture.png'),Buffer.concat([png,Buffer.from('TEST ONLY private metadata')]));candidate.screenshots=[{path:'capture.png',viewport:{width:1,height:1},alt:'TEST ONLY invalid capture'}];
 await assert.rejects(buildPublicEvidence({...args(paths),candidates:[candidate]}),/trailing|metadata|private/i);await absent(paths.outputDir);
}));
