import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv from 'ajv';
import {safePath,digest} from '../../showcase/dataset.mjs';
import {fromGenes,validateGenome,GENE_LIMITS} from '../../showcase/renderer/genome.mjs';
test('rejects traversal and absolute dataset paths',()=>{
 for(const path of ['../secret','a/../b','/private','https://evil.test/x','a\\b','a//b','a/%2e%2e/b'])assert.throws(()=>safePath(path));
 assert.equal(safePath('run-42/generation-0100.json'),'run-42/generation-0100.json');
});
test('uses SHA-256 for file integrity',async()=>{assert.equal(await digest(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');});
test('formal schema agrees with renderer grammar at every gene boundary',async()=>{
 const schema=JSON.parse(await readFile(new URL('../../evolution/genome-schema/genome.schema.json',import.meta.url),'utf8'));const validate=new Ajv({strict:true}).compile(schema);
 for(let i=0;i<11;i++)for(const value of [0,GENE_LIMITS[i]-1]){const genes=[2,0,0,0,0,0,2,3,3,0,0];genes[i]=value;const genome=fromGenes(genes);assert.equal(validate(genome),true);assert.equal(validateGenome(genome).valid,true);}
 const g=fromGenes([2,0,0,0,0,0,2,3,3,0,0]);g.layout.order=['metrics','metrics','revenue','orders'];assert.equal(validate(g),false);assert.equal(validateGenome(g).valid,false);
});
