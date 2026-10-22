import test from 'node:test';
import assert from 'node:assert/strict';
import {runOrderLabTasks} from '../../runtime/application/tasks.mjs';

test('an expired worker signal prevents fixture changes and browser task actions',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 const action=async()=>{calls++;throw new Error('Must not execute');};
 await assert.rejects(runOrderLabTasks({page:{},applicationId:133,home:action,principal:'TEST_ONLY',fixture:{reset:action,snapshot:action,auditSnapshot:action},signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);
});
test('cancellation during fixture preparation stops before reading or interacting',async()=>{
 const controller=new AbortController();let resets=0,other=0;const action=async()=>{other++;throw new Error('Must not execute');};
 await assert.rejects(runOrderLabTasks({page:{},applicationId:133,home:action,principal:'TEST_ONLY',fixture:{reset:async()=>{resets++;controller.abort();},snapshot:action,auditSnapshot:action},signal:controller.signal}),{name:'AbortError'});assert.equal(resets,1);assert.equal(other,0);
});
