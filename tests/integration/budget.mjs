import assert from 'node:assert/strict';
import {connect,rows,createRun,oracledb} from '../../scripts/db.mjs';
let checks=0;const db=await connect(),other=await connect(),original=(await rows(db,'select * from apxgen_provider_config where singleton=1'))[0];
const metrics=JSON.stringify({overflow:0,overlap:0,clipped:0,missing:0,unnamed:0,axeCritical:0,focusVisible:1,domNodes:77,viewportsTested:3,errors:0,renderMs:1});
const reserve=(conn,run,parent)=>conn.execute('begin :id:=apxgen_budget.reserve(:run,0,:parent);end;',{id:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32},run,parent});
async function fixture(){const run=await createRun(db,{label:'TEST mocked budget; no HTTP',mode:'GA_HAIKU',size:4,generations:5});await db.execute('begin apxgen_evolution.initialize(:id);end;',{id:run});await db.commit();const c=await db.execute('begin apxgen_evolution.claim(:run,:id,:token,:g);end;',{run,id:{dir:oracledb.BIND_OUT,type:oracledb.NUMBER},token:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32},g:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:2000}});await db.commit();await db.execute('begin apxgen_evolution.submit_evaluation(:id,:token,\'mock-budget-test\',:m);end;',{id:c.outBinds.id,token:c.outBinds.token,m:metrics});await db.commit();return {run,parent:c.outBinds.id};}
try{
 const f=await fixture();await assert.rejects(()=>reserve(db,f.run,f.parent));checks++;
 await db.execute("update apxgen_provider_config set enabled=1,credential_static_id='MOCK_NO_HTTP',model_id='mock-model',verified_model_id='mock-model',model_verified_at=systimestamp,pricing_reviewed_at=systimestamp,input_usd_per_million=.1,output_usd_per_million=.5,daily_limit_usd=1 where singleton=1");
 await db.execute('update apxgen_run_budgets set enabled=1 where run_id=:run',{run:f.run});await db.commit();
 const races=await Promise.allSettled([reserve(db,f.run,f.parent),reserve(other,f.run,f.parent)]);assert.equal(races.filter(x=>x.status==='fulfilled').length,1);checks++;
 const id=races.find(x=>x.status==='fulfilled').value.outBinds.id;
 await db.execute('begin apxgen_budget.reconcile(:id,100,20);end;',{id});
 const i=(await rows(db,'select state,actual_usd from apxgen_invocations where invocation_id=:id',{id}))[0];assert.equal(i.STATE,'RECONCILED');assert.equal(i.ACTUAL_USD,.00002);checks++;
 await assert.rejects(()=>db.execute('begin apxgen_budget.reconcile(:id,100,20);end;',{id}));checks++;
 const f2=await fixture();await db.execute('update apxgen_run_budgets set enabled=1,limit_usd=.000001 where run_id=:run',{run:f2.run});await db.commit();await assert.rejects(()=>reserve(db,f2.run,f2.parent));
 assert.equal((await rows(db,'select stopped from apxgen_run_budgets where run_id=:run',{run:f2.run}))[0].STOPPED,1);checks++;
 const f3=await fixture();await db.execute('update apxgen_run_budgets set enabled=1 where run_id=:run',{run:f3.run});await db.commit();const id3=(await reserve(db,f3.run,f3.parent)).outBinds.id;
 await db.execute('begin apxgen_budget.uncertain(:id,\'TIMEOUT\');end;',{id:id3});
 assert.equal((await rows(db,'select state from apxgen_invocations where invocation_id=:id',{id:id3}))[0].STATE,'UNCERTAIN');await assert.rejects(()=>reserve(db,f3.run,f3.parent));checks++;
 const f4=await fixture();await db.execute('update apxgen_run_budgets set enabled=1 where run_id=:run',{run:f4.run});await db.commit();const id4=(await reserve(db,f4.run,f4.parent)).outBinds.id;
 const response=JSON.stringify({id:'msg_mock',type:'message',role:'assistant',model:'mock-model',content:[{type:'text',text:JSON.stringify({operations:[{gene:'spacing',value:16}]})}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:100,output_tokens:20,cache_creation_input_tokens:0,cache_read_input_tokens:0}});
 await db.execute('begin apxgen_ai.accept_response(:id,:response);end;',{id:id4,response});assert.ok((await rows(db,'select proposal from apxgen_invocations where invocation_id=:id',{id:id4}))[0].PROPOSAL);checks++;
 const parent=(await rows(db,'select g.canonical_json from apxgen_organisms o join apxgen_genomes g on g.fingerprint=o.fingerprint where o.organism_id=:id',{id:f4.parent}))[0].CANONICAL_JSON;
 await assert.rejects(()=>db.execute('begin :out:=apxgen_ai.apply_proposal(:parent,:proposal);end;',{out:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:4000},parent,proposal:'{"operations":[{"gene":"sql","value":"drop table"}]}'}));checks++;
 console.log(JSON.stringify({checks,passed:true,paidRequests:0,scope:'Mocked responses and durable database reservations; no provider HTTP'}));
}finally{
 await db.rollback();const columns=Object.keys(original).filter(k=>k!=='SINGLETON');await db.execute('update apxgen_provider_config set '+columns.map(k=>k+'=:'+k).join(',')+' where singleton=1',Object.fromEntries(columns.map(k=>[k,original[k]])));await db.commit();await db.close();await other.close();
}
