import assert from 'node:assert/strict';
import test from 'node:test';
import {assertArchiveObservation,assertArchiveRequest} from '../../scripts/application/archive-application.mjs';

const policy={schemaVersion:'1.0',enabled:true,environment:'development',schema:'GENESIS_TEST_OWNER',workspace:'GENESIS_TEST_WS',workspaceId:98765,applicationIds:[130,131,132,133],protectedApplicationIds:[120,121],fixtureWritesAuthorized:true,maxConcurrentImports:1,maxMaterializationsPerRun:22};
const request={mode:'ARCHIVE_ONLY',applicationId:133,runId:'1'.repeat(32),organismId:'2'.repeat(32),definitionHash:'3'.repeat(64)};
function observation(){return {identity:{schema:policy.schema,sessionUser:policy.schema,workspace:policy.workspace,workspaceId:policy.workspaceId},application:{applicationId:133,workspace:policy.workspace,schema:policy.schema},slot:{applicationId:133,workspaceId:policy.workspaceId,runId:request.runId,organismId:request.organismId,state:'RELEASED',leaseCurrent:false},run:{runId:request.runId,state:'COMPLETE'},organism:{organismId:request.organismId,runId:request.runId,applicationId:133,artifactHash:request.definitionHash,state:'SELECTED'},pendingEvaluations:0,attempts:[{organismId:request.organismId,runId:request.runId,applicationId:133,definitionHash:request.definitionHash,state:'VERIFIED',completed:true}]};}

test('archive admission binds terminal artifacts to explicit durable application ownership',()=>{
 assert.equal(assertArchiveRequest(policy,request),true);
 assert.equal(assertArchiveObservation(policy,request,observation()),true);
 const failed=observation();failed.run.state='FAILED';failed.organism.state='REJECTED';
 assert.equal(assertArchiveObservation(policy,request,failed),true);
});
test('archive admission refuses protected apps, naming adoption and disposal modes',()=>{
 for(const change of [x=>x.applicationId=120,x=>x.applicationId=121,x=>x.applicationId=999,x=>x.mode='REMOVE',x=>x.cleanup=true,x=>x.organismId='GENESIS_ORDER_133']){
  const altered=structuredClone(request);change(altered);assert.throws(()=>assertArchiveRequest(policy,altered));
 }
 for(const change of [o=>o.slot=null,o=>o.slot.organismId='4'.repeat(32),o=>o.slot.runId='4'.repeat(32),o=>o.identity.sessionUser='SYSTEM',o=>o.application.workspace='OTHER',o=>o.organism.artifactHash='4'.repeat(64)]){
  const o=observation();change(o);assert.throws(()=>assertArchiveObservation(policy,request,o));
 }
});
test('live or uncertain work cannot be archived as a completed disposable slot',()=>{
 for(const change of [o=>o.run.state='RUNNING',o=>o.organism.state='TESTING',o=>o.slot.leaseCurrent=true,o=>o.slot.leaseCurrent=null,o=>o.pendingEvaluations=1,o=>o.attempts[0].state='STARTED',o=>o.attempts[0].state='UNCERTAIN',o=>o.attempts[0].completed=false,o=>o.attempts=[]]){
  const o=observation();change(o);assert.throws(()=>assertArchiveObservation(policy,request,o));
 }
});
test('an export cannot be bound to a different import or application despite a matching alias',()=>{
 for(const change of [o=>o.attempts[0].applicationId=132,o=>o.attempts[0].organismId='4'.repeat(32),o=>o.attempts[0].definitionHash='4'.repeat(64),o=>o.application.applicationId=132,o=>o.organism.runId='4'.repeat(32)]){
  const o=observation();change(o);assert.throws(()=>assertArchiveObservation(policy,request,o));
 }
});
