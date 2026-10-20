import test from 'node:test';import assert from 'node:assert/strict';import {aiEvidenceLabel} from '../../showcase/dataset.mjs';
test('population mode alone never creates AI evidence',()=>{
 assert.equal(aiEvidenceLabel([{mode:'GA_HAIKU',ai:{attempts:0,reconciled:0,uncertain:0}}]),'No provider calls');
 assert.equal(aiEvidenceLabel([{mode:'GA_HAIKU',ai:{attempts:1,reconciled:0,uncertain:1}}]),'Billing uncertain');
 assert.equal(aiEvidenceLabel([{mode:'GA_HAIKU',ai:{attempts:2,reconciled:2,uncertain:0}}]),'2 usage records');
});
