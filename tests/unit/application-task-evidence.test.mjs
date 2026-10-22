import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOnlyOrderStatusChanged,assertSameOrders,assertOrderSet,assertStatusUpdateAudit} from '../../runtime/application/tasks.mjs';
const before=[{orderId:1002,customerName:'Synthetic 2',status:'DELAYED',orderTotal:25},{orderId:1007,customerName:'Synthetic 7',status:'DELAYED',orderTotal:50}];
test('the task evaluator independently verifies the exact changed database record',()=>{
 const after=structuredClone(before);after[0].status='SHIPPED';
 assert.equal(assertOnlyOrderStatusChanged(before,after,1002,'SHIPPED'),true);
 for(const change of [rows=>{rows[1].status='SHIPPED';},rows=>{rows[0].orderTotal=0;},rows=>{rows.pop();},rows=>{rows[0].orderId=2002;},rows=>{rows.push({...rows[0]});}]){
  const invalid=structuredClone(after);change(invalid);assert.throws(()=>assertOnlyOrderStatusChanged(before,invalid,1002,'SHIPPED'));
 }
 assert.throws(()=>assertOnlyOrderStatusChanged(before,before,1002,'SHIPPED'));
 assert.throws(()=>assertOnlyOrderStatusChanged(before,after,9999,'SHIPPED'));
});
test('status update evidence verifies one version increment and unchanged audit fields elsewhere',()=>{
 const initial=before.map(row=>({orderId:row.orderId,status:row.status,rowVersion:0,updatedBy:'FIXTURE_RESET',updatedAt:'2026-10-22T12:00:00Z'}));
 const final=structuredClone(initial);Object.assign(final[0],{status:'SHIPPED',rowVersion:1,updatedBy:'GENESIS_TEST',updatedAt:'2026-10-22T12:00:01Z'});
 assert.equal(assertStatusUpdateAudit(initial,final,1002,'SHIPPED','GENESIS_TEST'),true);
 for(const change of [rows=>{rows[0].rowVersion=2;},rows=>{rows[0].updatedBy='OTHER';},rows=>{rows[1].rowVersion=1;},rows=>{rows[1].updatedAt='2026-10-22T12:01:00Z';},rows=>{rows[0].updatedAt='2026-10-22T11:00:00Z';}]){
  const invalid=structuredClone(final);change(invalid);assert.throws(()=>assertStatusUpdateAudit(initial,invalid,1002,'SHIPPED','GENESIS_TEST'));
 }
});
test('locate and filter tasks require the exact intended rows without side effects',()=>{
 assert.equal(assertSameOrders(before,[...before].reverse()),true);
 assert.equal(assertOrderSet([1007,1002],[1002,1007]),true);
 for(const observed of [[1002],[1002,1007,1008],[1002,1002],['1002',1007]]) assert.throws(()=>assertOrderSet(observed,[1002,1007]));
 const changed=structuredClone(before);changed[1].status='NEW';assert.throws(()=>assertSameOrders(before,changed));
});
