import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fromGenes,canonicalGenome} from '../../showcase/renderer/genome.mjs';
test('publication verifier refuses unlisted generation files and traversal',async()=>{
 const local=resolve('.local');await mkdir(local,{recursive:true});const temp=await mkdtemp(join(local,'verifier-'));
 try{
  const genome=fromGenes([2,0,0,0,0,0,2,3,3,0,0]),fingerprint=createHash('sha256').update(canonicalGenome(genome)).digest('hex');
  await writeFile(join(temp,'unlisted.json'),JSON.stringify({runId:'r',generation:0,organisms:[{id:1,genome,fingerprint,fitness:0,eligible:0}]}));
  await mkdir(join(temp,'dataset'));
  const index=JSON.stringify({runs:[{id:'r',state:'COMPLETED',seed:42,targetGenerations:0,populationSize:1,generations:[{generation:0,path:'../unlisted.json',bestFitness:0,bestSoFar:0,meanFitness:0,diversity:1}]}]});
  await writeFile(join(temp,'dataset/index.json'),index);await writeFile(join(temp,'dataset/manifest.json'),JSON.stringify({files:[{path:'index.json',sha256:createHash('sha256').update(index).digest('hex'),bytes:Buffer.byteLength(index)}]}));
  const result=spawnSync(process.execPath,['scripts/verify-export.mjs',join(temp,'dataset')],{encoding:'utf8'});assert.notEqual(result.status,0,'An unlisted traversal partition was accepted');
 }finally{const target=resolve(temp);if(!target.startsWith(local+sep))throw new Error('Unsafe test cleanup');await rm(target,{recursive:true,force:true});}
});
