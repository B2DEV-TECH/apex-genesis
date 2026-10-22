import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSandboxPolicy,assertSandboxIdentity,assertImportLease} from '../../runtime/application/sandbox.mjs';

const policy=()=>({schemaVersion:'1.0',enabled:true,environment:'development',schema:'ORDER_LAB',workspace:'ORDER_LAB',workspaceId:12345,applicationIds:[130,131],protectedApplicationIds:[120,121],fixtureWritesAuthorized:true,maxConcurrentImports:1,maxMaterializationsPerRun:22});
const identity={schema:'ORDER_LAB',workspace:'ORDER_LAB',workspaceId:12345};
const lease=(extra={})=>({applicationId:130,schema:'ORDER_LAB',workspaceId:12345,runId:'a'.repeat(32),organismId:'b'.repeat(32),token:'c'.repeat(32),state:'RESERVED',expiresAt:'2026-10-22T12:01:00.000Z',owned:true,materializationsRemaining:1,...extra});
const now=new Date('2026-10-22T12:00:00.000Z');

test('materialization has no implicit authorized destination',()=>{
 assert.equal(validateSandboxPolicy(policy()),true);
 for(const input of [undefined,{}, {...policy(),enabled:false},{...policy(),environment:'production'},{...policy(),schema:'SYS'},{...policy(),workspace:'INTERNAL'},{...policy(),applicationIds:[120]},{...policy(),applicationIds:[130,130]},{...policy(),applicationIds:[]},{...policy(),fixtureWritesAuthorized:false},{...policy(),maxConcurrentImports:2},{...policy(),maxMaterializationsPerRun:0},{...policy(),sql:'grant dba'}]) assert.throws(()=>validateSandboxPolicy(input));
});

test('live Oracle identity must match every configured sandbox boundary',()=>{
 assert.equal(assertSandboxIdentity(policy(),identity),true);
 for(const changed of [{schema:'OTHER'},{workspace:'OTHER'},{workspaceId:2}]) assert.throws(()=>assertSandboxIdentity(policy(),{...identity,...changed}));
});

test('imports require an unexpired Oracle-owned slot and remaining run budget',()=>{
 assert.equal(assertImportLease(policy(),identity,lease(),{now,existingApplication:false}),true);
 for(const changed of [{applicationId:120},{applicationId:132},{schema:'OTHER'},{workspaceId:7},{state:'TESTING'},{owned:false},{expiresAt:'2026-10-22T11:59:00Z'},{expiresAt:'nonsense'},{token:null},{materializationsRemaining:0},{runId:'x'}]) assert.throws(()=>assertImportLease(policy(),identity,lease(changed),{now,existingApplication:false}));
 assert.throws(()=>assertImportLease(policy(),identity,lease(),{now,existingApplication:true}));
 assert.equal(assertImportLease(policy(),identity,lease(),{now,existingApplication:true,existingOwnership:{runId:'a'.repeat(32),organismId:'b'.repeat(32),applicationId:130,token:'c'.repeat(32)}}),true);
 assert.throws(()=>assertImportLease(policy(),identity,lease(),{now,existingApplication:true,existingOwnership:{runId:'d'.repeat(32),organismId:'b'.repeat(32),applicationId:130,token:'c'.repeat(32)}}));
});
