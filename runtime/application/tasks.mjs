import assert from 'node:assert/strict';

function canonicalRows(rows){
 assert.ok(Array.isArray(rows),'Independent order snapshot required');
 const result=rows.map(row=>{
  assert.deepEqual(Object.keys(row).sort(),['customerName','orderId','orderTotal','status']);
  assert.ok(Number.isSafeInteger(row.orderId)&&row.orderId>0);
  assert.equal(typeof row.customerName,'string');assert.equal(typeof row.status,'string');assert.ok(Number.isFinite(row.orderTotal));
  return {orderId:row.orderId,customerName:row.customerName,status:row.status,orderTotal:row.orderTotal};
 }).sort((a,b)=>a.orderId-b.orderId);
 assert.equal(new Set(result.map(row=>row.orderId)).size,result.length,'Duplicate database order identifiers');
 return result;
}
export function assertSameOrders(expected,observed){assert.deepEqual(canonicalRows(observed),canonicalRows(expected));return true;}
export function assertOrderSet(observed,expected){
 for(const ids of [observed,expected]){
  assert.ok(Array.isArray(ids)&&ids.every(id=>Number.isSafeInteger(id)&&id>0),'Numeric order identifiers required');
  assert.equal(new Set(ids).size,ids.length,'Duplicate visible order identifier');
 }
 assert.deepEqual([...observed].sort((a,b)=>a-b),[...expected].sort((a,b)=>a-b));return true;
}
export function assertOnlyOrderStatusChanged(before,after,orderId,status){
 const expected=canonicalRows(before);const target=expected.find(row=>row.orderId===orderId);
 assert.ok(target,'Target order must exist');assert.notEqual(target.status,status,'Task must actually change the status');
 target.status=status;assertSameOrders(expected,after);return true;
}
export function assertStatusUpdateAudit(before,after,orderId,status,principal){
 assert.equal(typeof principal,'string');assert.ok(principal.length>0);
 const normalize=rows=>{
  assert.ok(Array.isArray(rows));
  const sorted=structuredClone(rows).sort((a,b)=>a.orderId-b.orderId);
  assert.equal(new Set(sorted.map(row=>row.orderId)).size,sorted.length);
  for(const row of sorted){
   assert.deepEqual(Object.keys(row).sort(),['orderId','rowVersion','status','updatedAt','updatedBy']);
   assert.ok(Number.isSafeInteger(row.orderId)&&Number.isSafeInteger(row.rowVersion)&&row.rowVersion>=0);
   assert.equal(typeof row.status,'string');assert.equal(typeof row.updatedBy,'string');assert.equal(typeof row.updatedAt,'string');assert.ok(Number.isFinite(Date.parse(row.updatedAt)));
  }return sorted;
 };
 const expected=normalize(before),observed=normalize(after);
 const target=expected.find(row=>row.orderId===orderId),changed=observed.find(row=>row.orderId===orderId);
 assert.ok(target&&changed,'The intended audited row must exist');
 assert.notEqual(target.status,status);assert.equal(changed.rowVersion,target.rowVersion+1);assert.equal(changed.updatedBy,principal);
 assert.ok(Date.parse(changed.updatedAt)>=Date.parse(target.updatedAt),'Update timestamp moved backwards');
 Object.assign(target,{status,rowVersion:changed.rowVersion,updatedBy:principal,updatedAt:changed.updatedAt});
 assert.deepEqual(observed,expected,'Unexpected status, version or audit changes');return true;
}

// Uses actual APEX pages supplied by the trusted worker. No renderer, fixture
// page, score calculation, login trace or model-generated selectors are used.
// This task adapter is intentionally limited to the compiler-supported page form.
export async function runOrderLabTasks({page,applicationId,home,fixture,principal,signal}){
 const ensureActive=()=>signal?.throwIfAborted();ensureActive();
 assert.ok(Number.isSafeInteger(applicationId)&&applicationId>0);
 assert.equal(typeof home,'function');
 assert.equal(typeof principal,'string');
 for(const method of ['reset','snapshot','auditSnapshot'])assert.equal(typeof fixture?.[method],'function');
 const results={};
 async function ready(){
  ensureActive();
  await home();await page.getByRole('button',{name:'Apply filters',exact:true}).waitFor();
  assert.equal(Number(await page.evaluate(()=>globalThis.apex?.env?.APP_ID)),applicationId,'Wrong running APEX application');
 }
 async function trial(task,action){
  ensureActive();await fixture.reset();ensureActive();const before=await fixture.snapshot(),beforeAudit=await fixture.auditSnapshot();assert.equal(before.length,40,'Equivalent 40-order fixture required');assert.equal(beforeAudit.length,40);
  await ready();let actions=0,navigationSteps=0;
  const act=async operation=>{
   ensureActive();
   actions++;let navigated=false;
   const onNavigate=frame=>{if(frame===page.mainFrame())navigated=true;};
   page.on('framenavigated',onNavigate);
   try{await operation();ensureActive();}finally{page.off('framenavigated',onNavigate);if(navigated)navigationSteps++;}
  };
  const start=performance.now();
  try{await action({before,beforeAudit,act});ensureActive();results[task]={success:true,actions,navigationSteps,elapsedMs:Math.ceil(performance.now()-start),completedAt:new Date().toISOString()};}
  catch(error){if(signal?.aborted)throw error;results[task]={success:error.name==='AssertionError'?false:null,actions,navigationSteps,elapsedMs:Math.ceil(performance.now()-start),completedAt:new Date().toISOString(),outcome:error.name==='AssertionError'?'TASK_ASSERTION_FAILED':'EVALUATOR_LIMITATION'};return false;}
  return true;
 }
 async function filter(orderId,status,act){
  await act(()=>page.getByLabel('Order ID',{exact:true}).fill(orderId));
  await act(()=>page.getByLabel('Status',{exact:true}).selectOption(status));
  await act(()=>Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'Apply filters',exact:true}).click()]));
 }
 async function visibleOrderIds(){
  const links=await page.getByRole('link',{name:/^10[0-9]{2}$/}).allTextContents();
  return links.map(text=>Number(text.trim()));
 }
 const locate=await trial('locateOrder',async({before,beforeAudit,act})=>{
  const target=before.find(row=>row.orderId===1002);assert.equal(target.status,'DELAYED');
  await filter('1002','',act);assertOrderSet(await visibleOrderIds(),[1002]);
  const row=page.getByRole('row').filter({has:page.getByRole('link',{name:'1002',exact:true})});
  assert.ok((await row.innerText()).includes(target.customerName));assert.ok((await row.innerText()).includes('DELAYED'));
  assertSameOrders(before,await fixture.snapshot());
  assert.deepEqual(await fixture.auditSnapshot(),beforeAudit);
 });
 const filtered=await trial('filterOrders',async({before,beforeAudit,act})=>{
  await filter('','DELAYED',act);assertOrderSet(await visibleOrderIds(),before.filter(row=>row.status==='DELAYED').map(row=>row.orderId));
  assertSameOrders(before,await fixture.snapshot());
  assert.deepEqual(await fixture.auditSnapshot(),beforeAudit);
 });
 const updated=await trial('updateOrder',async({before,beforeAudit,act})=>{
  await filter('1002','',act);
  await act(()=>Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('link',{name:'1002',exact:true}).click()]),{navigates:true});
  await act(()=>page.getByLabel('Status',{exact:true}).selectOption('SHIPPED'));
  await act(()=>Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'Save status',exact:true}).click()]));
  assertOnlyOrderStatusChanged(before,await fixture.snapshot(),1002,'SHIPPED');
  assertStatusUpdateAudit(beforeAudit,await fixture.auditSnapshot(),1002,'SHIPPED',principal);
 });
 return {tasks:results,allTasksVerified:locate&&filtered&&updated,databaseChangeVerified:updated,fitnessSubmitted:false};
}
