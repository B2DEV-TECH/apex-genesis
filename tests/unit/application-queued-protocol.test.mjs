import test from 'node:test';
import assert from 'node:assert/strict';
import {assertQueuedSmokeRequest} from '../../scripts/application/run-smoke.mjs';

test('the initial native queue binds the exact preregistered unpaid feasibility capabilities',()=>{
 const request={id:'a'.repeat(32),label:'Native Order Lab feasibility',seed:50000,generations:1,materializationBudget:2};
 const result=assertQueuedSmokeRequest(request);assert.deepEqual(result,request);assert.equal(Object.isFrozen(result),true);assert.notEqual(result,request);
 assert.doesNotThrow(()=>assertQueuedSmokeRequest({...request,label:'é'.repeat(60)}));assert.throws(()=>assertQueuedSmokeRequest({...request,label:'é'.repeat(61)}));
 for(const invalid of [{...request,seed:50001},{...request,generations:2},{...request,materializationBudget:3},{...request,label:''},{...request,id:'unowned'},{...request,provider:'paid'},{...request,label:'line\nbreak'}])assert.throws(()=>assertQueuedSmokeRequest(invalid));
});
