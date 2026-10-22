import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Ajv from 'ajv';
import {APPLICATION_BASELINE, APPLICATION_TRAITS, validateApplicationGenome, canonicalApplicationGenome, applyApplicationProposal} from '../../evolution/application/genome.mjs';

test('application grammar agrees with its independent JSON schema for every allele',async()=>{
 const schema=JSON.parse(await readFile(new URL('../../evolution/genome-schema/application-genome.schema.json',import.meta.url),'utf8'));
 const validate=new Ajv({strict:true}).compile(schema);
 for(const [trait,values] of Object.entries(APPLICATION_TRAITS)) for(const value of values){
  const genome=structuredClone(APPLICATION_BASELINE);genome.traits[trait]=value;
  assert.equal(validate(genome),true,JSON.stringify(validate.errors));assert.equal(validateApplicationGenome(genome),true);
 }
 for(const mutate of [g=>{g.sql='drop table orders';},g=>{g.tasks.pop();},g=>{g.tasks.reverse();},g=>{g.dataSource='OTHER_VIEW';},g=>{g.traits.edit='inline';},g=>{g.traits.report='select * from users';},g=>{g.traits.extra=true;},g=>{g.schemaVersion='1.0';}]){
  const genome=structuredClone(APPLICATION_BASELINE);mutate(genome);assert.equal(validate(genome),false);assert.throws(()=>validateApplicationGenome(genome));
 }
});

test('canonical application DNA is stable and distinct from historical genomes',()=>{
 const reversed=Object.fromEntries(Object.entries(APPLICATION_BASELINE).reverse());
 reversed.traits=Object.fromEntries(Object.entries(APPLICATION_BASELINE.traits).reverse());
 assert.equal(canonicalApplicationGenome(reversed),canonicalApplicationGenome(APPLICATION_BASELINE));
 const sha=g=>createHash('sha256').update(canonicalApplicationGenome(g)).digest('hex');
 const child=applyApplicationProposal(APPLICATION_BASELINE,{operations:[{trait:'edit',value:'modal'}]});
 assert.notEqual(sha(child),sha(APPLICATION_BASELINE));assert.equal(APPLICATION_BASELINE.traits.edit,'page');
 assert.ok(Object.isFrozen(APPLICATION_BASELINE.traits));
});

test('compact structural proposals preserve parents and reject code or boundary edits',()=>{
 const parent=canonicalApplicationGenome(APPLICATION_BASELINE);
 const child=applyApplicationProposal(APPLICATION_BASELINE,{operations:[{trait:'filters',value:'beside'},{trait:'summary',value:'after'}]});
 assert.equal(child.traits.filters,'beside');assert.equal(child.traits.summary,'after');
 assert.equal(canonicalApplicationGenome(APPLICATION_BASELINE),parent);
 for(const proposal of [null,{operations:[]},{operations:[{trait:'sql',value:'select 1'}]},{operations:[{trait:'edit',value:'javascript:alert(1)'}]},{operations:[{trait:'filters',value:'above'},{trait:'filters',value:'beside'}]},{operations:[{trait:'edit',value:'modal',code:'x'}]},{operations:[{trait:'edit',value:'modal'}],tasks:[]},{operations:[{trait:'edit',value:'modal'},{trait:'filters',value:'beside'},{trait:'summary',value:'after'},{trait:'report',value:'interactiveReport'}]}]) assert.throws(()=>applyApplicationProposal(APPLICATION_BASELINE,proposal));
});
