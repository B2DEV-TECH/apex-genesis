import test from 'node:test';
import assert from 'node:assert/strict';
import {assertQueuedImportLease} from '../../runtime/application/queue-import-guard.mjs';

test('a native queued import needs its exact live Oracle claim and enough lease for the bounded import',()=>{
 const request={runId:'a'.repeat(32),requestId:'b'.repeat(32),schema:'APXGEN_ORDER_LAB',workspaceId:123};
 const observed={runId:request.runId,requestId:request.requestId,schema:request.schema,workspaceId:123,state:'CLAIMED',seed:50000,generations:1,materializationBudget:2,enabled:true,workerEnabled:true,bindingMatches:true,leaseCoversImport:true,heartbeatCurrent:true};
 assert.equal(assertQueuedImportLease(observed,request),true);
 for(const [key,value]of [['runId','c'.repeat(32)],['requestId','c'.repeat(32)],['schema','APXGEN_LAB'],['workspaceId',124],['state','UNCERTAIN'],['seed',50001],['generations',2],['materializationBudget',3],['enabled',false],['workerEnabled',false],['bindingMatches',false],['leaseCoversImport',false],['heartbeatCurrent',false]])assert.throws(()=>assertQueuedImportLease({...observed,[key]:value},request));
 assert.throws(()=>assertQueuedImportLease(null,request));
});
