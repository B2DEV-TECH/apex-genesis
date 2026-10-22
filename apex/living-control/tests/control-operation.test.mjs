import assert from 'node:assert/strict';
import {test} from 'node:test';
const target=new URL('../verify-control-operation.mjs',import.meta.url);
async function implementation(){const value=await import(target.href).catch(()=>null);assert.ok(value,'Guarded native role/draft operation must exist');return value;}
const policy=()=>({schemaVersion:'1.0',operation:'NATIVE_CONTROL_ONE_DRAFT',applicationId:134,schema:'APXGEN_ORDER_LAB',workspace:'APXGEN_ORDER_LAB',workspaceId:123456789,capabilityVersion:'order-lab-queued-feasibility/1.0',seed:50000,generations:1,materializationBudget:2,paidRequestBudget:0,principal:'GENESIS_TEST',label:'Native Order Lab queued feasibility',workerEnabled:false,workerBinding:null,enqueue:false});
test('real native draft authorization cannot broaden account, paid mode, application or execution',async()=>{
 const {assertControlOperationPolicy}=await implementation();const good=policy();assert.equal(assertControlOperationPolicy(good),true);
 for(const bad of [{...good,applicationId:130},{...good,principal:'ANY'},{...good,paidRequestBudget:1},{...good,workerEnabled:true},{...good,workerBinding:'ANY'},{...good,enqueue:true},{...good,seed:50001},{...good,materializationBudget:3},{...good,execute:true}])assert.throws(()=>assertControlOperationPolicy(bad));
});
test('operation accepts only exact disabled134 reservation without roles or prior queue rows',async()=>{
 const {assertDisabledControlOperation}=await implementation();const good={enabled:0,workerEnabled:0,schema:'APXGEN_ORDER_LAB',workspaceId:123456789,applicationId:134,binding:null,heartbeat:null,roles:0,requests:0,events:0};
 assert.equal(assertDisabledControlOperation(policy(),good),true);
 for(const bad of [{...good,enabled:1},{...good,roles:1},{...good,requests:1},{...good,binding:'ANY'},{...good,applicationId:133}])assert.throws(()=>assertDisabledControlOperation(policy(),bad));
});
