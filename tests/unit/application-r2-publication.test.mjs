import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {buildPublicEvidence} from '../../scripts/application/package-evidence.mjs';
import {publishApplicationEvidence,APPLICATION_PUBLICATION_PREFIX} from '../../scripts/application/publish-evidence.mjs';
import {APPLICATION_BASELINE,canonicalApplicationGenome} from '../../evolution/application/genome.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(fn){
 const local=resolve('.local');await mkdir(local,{recursive:true});const root=await mkdtemp(join(local,'application-r2-test-'));
 try{
  const input=join(root,'input'),output=join(root,'package');await mkdir(input);const genome=canonicalApplicationGenome(APPLICATION_BASELINE);await writeFile(join(input,'genome.json'),genome);
  const candidate={id:'boundary-candidate',runId:'boundary-run',generation:0,parentId:null,genomePath:'genome.json',genomeHash:digest(genome),artifactPath:null,artifactHash:null,applicationId:null,sourceHash:'a'.repeat(64),evaluatorHash:'b'.repeat(64),validation:null,import:null,runtime:null,tasks:{locateOrder:null,filterOrders:null,updateOrder:null},selected:false,fitness:null,fitnessEvidence:null,screenshots:[],rejectionReason:'Rejected before definition generation'};
  const packaged=await buildPublicEvidence({inputRoot:input,outputDir:output,candidates:[candidate],sourceHash:candidate.sourceHash,evaluatorHash:candidate.evaluatorHash});
  const objects=new Map(),writes=[];const target={name:'DIRECTORY',async getBytes(key){if(!objects.has(key)){const error=new Error('Missing object');error.code='ENOENT';throw error;}return objects.get(key);},async put(key,file,options){writes.push({key,options});objects.set(key,await readFile(file));}};
  await fn({root,output,packaged,objects,writes,target});
 }finally{if(!resolve(root).startsWith(local+sep))throw new Error('Unsafe test cleanup');await rm(root,{recursive:true,force:true});}
}

test('application publication verifies immutable bytes and advances its own pointer last',async()=>fixture(async f=>{
 const result=await publishApplicationEvidence({packageDir:f.output,workingDir:join(f.root,'work'),target:f.target});
 assert.equal(result.manifestSha256,f.packaged.manifestSha256);assert.equal(f.writes.at(-1).key,APPLICATION_PUBLICATION_PREFIX+'latest.json');
 assert.ok(f.writes.every(x=>x.key.startsWith(APPLICATION_PUBLICATION_PREFIX)));assert.equal(f.writes.some(x=>x.key.startsWith('genesis/live/')),false);
 const pointer=JSON.parse(f.objects.get(f.writes.at(-1).key));assert.equal(pointer.manifest.sha256,f.packaged.manifestSha256);assert.equal(pointer.previousSha256,null);
 const count=f.writes.length;await publishApplicationEvidence({packageDir:f.output,workingDir:join(f.root,'again'),target:f.target});assert.equal(f.writes.length,count+1,'existing immutable objects are read and reused');
}));
test('tampered local bytes are rejected before an upload',async()=>fixture(async f=>{
 await writeFile(join(f.output,'genome.json'),'{}');await assert.rejects(publishApplicationEvidence({packageDir:f.output,workingDir:join(f.root,'work'),target:f.target}),/integrity|hash|canonical|bytes/i);assert.equal(f.writes.length,0);
}));
test('an orphan file cannot bypass the public loader privacy checks',async()=>fixture(async f=>{
 const bytes=Buffer.from('{"password":"boundary-test-value"}'),path='orphan.json';await writeFile(join(f.output,path),bytes);const manifest=JSON.parse(await readFile(join(f.output,'manifest.json'),'utf8'));manifest.files.push({path,sha256:digest(bytes),bytes:bytes.length});await writeFile(join(f.output,'manifest.json'),JSON.stringify(manifest));
 await assert.rejects(publishApplicationEvidence({packageDir:f.output,workingDir:join(f.root,'work'),target:f.target}),/unreferenced|orphan/i);assert.equal(f.writes.length,0);
}));
test('an immutable remote collision blocks publication without overwriting it',async()=>fixture(async f=>{
 const key=APPLICATION_PUBLICATION_PREFIX+'packages/'+f.packaged.manifestSha256+'/genome.json';f.objects.set(key,Buffer.from('different bytes'));
 await assert.rejects(publishApplicationEvidence({packageDir:f.output,workingDir:join(f.root,'work'),target:f.target}),/immutable|collision/i);assert.equal(f.objects.get(key).toString(),'different bytes');assert.equal(f.writes.some(x=>x.key.endsWith('latest.json')),false);
}));
test('a failed binary readback leaves the pointer untouched',async()=>fixture(async f=>{
 const original=f.target.getBytes;f.target.getBytes=async key=>{const bytes=await original(key);return key.endsWith('genome.json')?Buffer.concat([bytes,Buffer.from('!')]):bytes;};
 await assert.rejects(publishApplicationEvidence({packageDir:f.output,workingDir:join(f.root,'work'),target:f.target}),/hash|verification/i);assert.equal(f.writes.some(x=>x.key.endsWith('latest.json')),false);
}));
test('an unverifiable pointer is restored to the previous verified pointer',async()=>fixture(async f=>{
 await publishApplicationEvidence({packageDir:f.output,workingDir:join(f.root,'first'),target:f.target});const key=APPLICATION_PUBLICATION_PREFIX+'latest.json',previous=f.objects.get(key),original=f.target.getBytes;let injected=false;
 f.target.getBytes=async name=>{const bytes=await original(name);if(name===key&&!injected&&f.writes.filter(x=>x.key===key).length===2){injected=true;return Buffer.from('corrupt');}return bytes;};
 await assert.rejects(publishApplicationEvidence({packageDir:f.output,workingDir:join(f.root,'second'),target:f.target}),/pointer|verification/i);assert.deepEqual(f.objects.get(key),previous);
}));
test('a concurrent pointer is preserved during a failed verification',async()=>fixture(async f=>{
 await publishApplicationEvidence({packageDir:f.output,workingDir:join(f.root,'first'),target:f.target});const key=APPLICATION_PUBLICATION_PREFIX+'latest.json',original=f.target.getBytes,other=Buffer.from('another publisher pointer');let injected=false;
 f.target.getBytes=async name=>{if(name===key&&!injected&&f.writes.filter(x=>x.key===key).length===2){injected=true;f.objects.set(key,other);}return original(name);};
 await assert.rejects(publishApplicationEvidence({packageDir:f.output,workingDir:join(f.root,'second'),target:f.target}),/pointer|concurrent/i);assert.deepEqual(f.objects.get(key),other);assert.equal(f.writes.filter(x=>x.key===key).length,2);
}));
