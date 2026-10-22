import test from 'node:test';
import assert from 'node:assert/strict';
import {runControlWorker,validateControlWorkerConfig,CONTROL_WORKER_CAPABILITY_VERSION} from '../../runtime/application/control-worker.mjs';

// TEST ONLY synthetic owner connections. No Oracle connection, queued request,
// application import, provider call or public evidence is created by this suite.
const id='a'.repeat(32),runId='b'.repeat(32),token='c'.repeat(32),binding='TEST_ONLY_WORKER_BINDING';
function configuration(){return {schemaVersion:'1.0',enabled:true,mode:'GA_ONLY',paidRequestBudget:0,binding,pool:{applicationIds:[150,151],canaryApplicationId:152},capabilities:{seed:50000,advances:1,materializations:2},leaseSeconds:300,heartbeatSeconds:1};}
function fixture(){
 const config=configuration(),calls=[],claim={id,label:'TEST ONLY queued application',state:'CLAIMED',seed:50000,generations:1,materializationBudget:2,runId:null,claimToken:token};
 const state={claimed:false,attached:false,runId:null,oracleState:'RUNNING',queueState:'QUEUED',renewFails:false,attachFails:false,claim:null};
 const row=()=>({REQUEST_ID:id,LABEL:claim.label,STATE:state.queueState,POPULATION_MODE:'GA_ONLY',SEED:claim.seed,GENERATIONS:claim.generations,MATERIALIZATION_BUDGET:claim.materializationBudget,RUN_ID:state.runId,CLAIM_TOKEN:token,CLAIM_BINDING:binding,LEASE_CURRENT:1});
 const db={};for(const name of ['queue','heartbeat']){
  let pending=null;db[name]={async execute(sql,binds={}){
   calls.push({connection:name,sql,binds});
   if(sql.includes('sys_context'))return {rows:[{SCHEMA_NAME:'APXGEN_ORDER_LAB',SESSION_USER:'APXGEN_ORDER_LAB',CURRENT_USER:'APXGEN_ORDER_LAB'}]};
   if(sql.includes('from apxgen_app_control_config'))return {rows:[{CONFIG_ID:1,ENABLED:1,SCHEMA_NAME:'APXGEN_ORDER_LAB',WORKSPACE_ID:123,CONTROL_APPLICATION_ID:134,MAX_GENERATIONS:1,MAX_MATERIALIZATIONS:2,WORKER_ENABLED:1,WORKER_BINDING:binding}]};
   if(sql.includes('worker_heartbeat'))return {};
   if(sql.includes('worker_claim')){pending=()=>{state.claimed=true;state.queueState='CLAIMED';state.claim=structuredClone(claim);};return {outBinds:{claim:JSON.stringify(claim)}};}
   if(sql.includes('worker_renew')){if(state.renewFails)throw new Error('TEST ONLY lost lease '+token);assert.equal(binds.token,token);return {};}
   if(sql.includes('worker_attach_run')){assert.equal(state.claimed,true,'claim must commit before attaching');assert.equal(binds.token,token);assert.equal(binds.run,runId);if(state.attachFails)throw new Error('TEST ONLY attachment rejected '+token);pending=()=>{state.runId=runId;state.attached=true;};return {};}
   if(sql.includes('worker_finish')){assert.equal(state.attached,true);assert.equal(binds.token,token);if(!['COMPLETE','FAILED','CANCELLED'].includes(state.oracleState))throw new Error('TEST ONLY nonterminal Oracle run');pending=()=>{state.queueState=state.oracleState==='COMPLETE'?'COMPLETED':'FAILED';};return {};}
   if(sql.includes('join apxgen_app_runs'))return {rows:[{REQUEST_ID:id,RUN_ID:state.runId,REQUEST_STATE:state.queueState,RUN_STATE:state.oracleState}]};
   if(sql.includes('from apxgen_app_control_requests'))return {rows:[row()]};
   throw new Error('Unexpected TEST ONLY SQL');
  },async commit(){calls.push({connection:name,sql:'COMMIT'});pending?.();pending=null;},async rollback(){calls.push({connection:name,sql:'ROLLBACK'});pending=null;}};
 }
 return {config,db,state,claim,calls};
}
async function successfulEngine(f,options){assert.equal(f.state.claimed,true);await options.onRunCreated(runId);assert.equal(f.state.attached,true,'run attachment must commit before engine may advance');f.state.oracleState='COMPLETE';return {runId,protocolCompleted:true};}

test('native queue worker is disabled by default without contacting a database or engine',async()=>{
 assert.deepEqual(await runControlWorker(),{status:'disabled'});const f=fixture();f.config.enabled=false;let started=false;assert.deepEqual(await runControlWorker({...f,engine:async()=>{started=true;}}),{status:'disabled'});assert.equal(started,false);assert.equal(f.calls.length,0);
});
test('worker configuration admits only the explicit bounded GA engine and a separate pool',()=>{
 assert.equal(CONTROL_WORKER_CAPABILITY_VERSION,'order-lab-queued-feasibility/1.0');assert.equal(validateControlWorkerConfig(configuration()).mode,'GA_ONLY');
 for(const mutate of [c=>{c.mode='LLM';},c=>{c.paidRequestBudget=1;},c=>{c.extra=true;},c=>{c.capabilities.seed=1;},c=>{c.capabilities.advances=2;},c=>{c.capabilities.materializations=3;},c=>{c.capabilities.fake=true;},c=>{c.pool.applicationIds=[150,150];},c=>{c.pool.canaryApplicationId=150;},c=>{c.pool.applicationIds=[120,151];},c=>{c.leaseSeconds=301;},c=>{c.heartbeatSeconds=61;},c=>{c.leaseSeconds=30;c.heartbeatSeconds=11;},c=>{c.binding='';}]){const config=configuration();mutate(config);assert.throws(()=>validateControlWorkerConfig(config),/config|GA|paid|capabilit|pool|lease|heartbeat|binding/i);}
});
test('queue and heartbeat require distinct direct-owner connections',async()=>{
 const f=fixture();await assert.rejects(runControlWorker({...f,db:{queue:f.db.queue,heartbeat:f.db.queue},engine:async()=>{throw new Error('must not execute');}}),/separate|distinct/i);assert.equal(f.calls.length,0);
 const g=fixture(),original=g.db.heartbeat.execute;g.db.heartbeat.execute=async(sql,binds)=>sql.includes('sys_context')?{rows:[{SCHEMA_NAME:'APXGEN_ORDER_LAB',SESSION_USER:'OTHER_USER',CURRENT_USER:'APXGEN_ORDER_LAB'}]}:original(sql,binds);await assert.rejects(runControlWorker({...g,engine:async()=>{throw new Error('must not execute');}}),/owner|identity|sandbox/i);assert.equal(g.calls.some(call=>call.sql.includes('worker_claim')),false);
});
test('both owner connections receive a bounded driver timeout before any SQL',async()=>{
 const f=fixture();for(const name of ['queue','heartbeat']){const original=f.db[name].execute;f.db[name].execute=async(sql,binds)=>{assert.ok(Number.isInteger(f.db[name].callTimeout)&&f.db[name].callTimeout>0&&f.db[name].callTimeout<=10000,'driver timeout must be set before SQL');return original(sql,binds);};}
 assert.equal((await runControlWorker({...f,engine:options=>successfulEngine(f,options)})).status,'finished');
});
test('Oracle control caps must advertise exactly the supported engine before readiness',async()=>{
 const f=fixture(),original=f.db.queue.execute;f.db.queue.execute=async(sql,binds)=>{const result=await original(sql,binds);if(sql.includes('from apxgen_app_control_config'))result.rows[0].MAX_GENERATIONS=2;return result;};await assert.rejects(runControlWorker({...f,engine:async()=>{throw new Error('must not execute');}}),/capabilit|config|bound/i);assert.equal(f.calls.some(call=>call.sql.includes('worker_heartbeat')),false);
});
test('a real 16-digit Oracle workspace identity is valid without widening application IDs',async()=>{
 const f=fixture(),original=f.db.queue.execute;f.db.queue.execute=async(sql,binds)=>{const result=await original(sql,binds);if(sql.includes('from apxgen_app_control_config'))result.rows[0].WORKSPACE_ID=8303111957118921;return result;};assert.equal((await runControlWorker({...f,engine:options=>successfulEngine(f,options)})).status,'finished');
 const config=configuration();config.pool.applicationIds[0]=8303111957118921;assert.throws(()=>validateControlWorkerConfig(config),/pool/i);
});
test('one exact claim commits before engine, which sees frozen public request and pool only',async()=>{
 const f=fixture();let started=0;const result=await runControlWorker({...f,engine:async options=>{started++;assert.deepEqual(options.request,{id,label:f.claim.label,seed:50000,generations:1,materializationBudget:2});assert.equal(options.capabilityVersion,CONTROL_WORKER_CAPABILITY_VERSION);assert.equal(options.mode,'GA_ONLY');assert.equal(options.paidRequestBudget,0);assert.equal(Object.isFrozen(options.request),true);assert.equal(Object.isFrozen(options.pool.applicationIds),true);assert.equal(JSON.stringify(options).includes(token),false);assert.equal(JSON.stringify(options).includes(binding),false);assert.throws(()=>{options.request.seed=1;});return successfulEngine(f,options);}});
 assert.equal(started,1);assert.deepEqual(result,{status:'finished',requestId:id,runId,queueState:'COMPLETED',oracleState:'COMPLETE'});assert.equal(f.calls.filter(call=>call.sql.includes('worker_claim')).length,1);assert.equal(f.calls.filter(call=>call.sql.includes('worker_attach_run')).length,1);assert.equal(JSON.stringify(result).includes(token),false);
 const finish=f.calls.find(call=>call.sql.includes('worker_finish'));assert.deepEqual(Object.keys(finish.binds).sort(),['binding','request','token']);assert.equal(finish.binds.token,token);
});
test('idle queue returns after one committed claim and does not start the engine',async()=>{
 const f=fixture(),original=f.db.queue.execute;f.db.queue.execute=async(sql,binds)=>sql.includes('worker_claim')?{outBinds:{claim:null}}:original(sql,binds);let started=false;assert.deepEqual(await runControlWorker({...f,engine:async()=>{started=true;}}),{status:'idle'});assert.equal(started,false);
});
test('uncertain claim commit never starts the engine or attempts another claim',async()=>{
 const f=fixture(),original=f.db.queue.commit;let failed=false;f.db.queue.commit=async()=>{if(!failed){failed=true;throw new Error('TEST ONLY commit acknowledgement lost '+token);}return original();};let started=false;
 const result=await runControlWorker({...f,engine:async()=>{started=true;}});assert.equal(started,false);assert.equal(result.status,'uncertain');assert.equal(result.reason,'CLAIM_COMMIT_UNCERTAIN');assert.equal(f.calls.filter(call=>call.sql.includes('worker_claim')).length,1);assert.equal(f.calls.some(call=>call.sql==='ROLLBACK'),true);assert.equal(JSON.stringify(result).includes(token),false);
});
test('unsupported, already-linked or ambiguous claims never reach the engine',async()=>{
 for(const mutate of [c=>{c.seed=1;},c=>{c.generations=2;},c=>{c.materializationBudget=3;},c=>{c.label='';},c=>{c.label='x'.repeat(121);},c=>{c.state='QUEUED';},c=>{c.runId=runId;},c=>{c.claimToken='wrong';},c=>{c.extra='hidden';}]){const f=fixture();mutate(f.claim);let started=false;const result=await runControlWorker({...f,engine:async()=>{started=true;}});assert.equal(started,false);assert.equal(result.status,'uncertain');assert.equal(f.calls.some(call=>call.sql.includes('worker_finish')),false);assert.equal(f.calls.filter(call=>call.sql.includes('worker_claim')).length,1);}
});
test('claim labels use the same 120-byte UTF-8 boundary as native Oracle payload validation',async()=>{
 for(const [label,allowed]of [['a'.repeat(120),true],['é'.repeat(60),true],['é'.repeat(61),false],['x\u0000y',false],['x\u0085y',false]]){const f=fixture();f.claim.label=label;let started=false;const result=await runControlWorker({...f,engine:async options=>{started=true;return successfulEngine(f,options);}});assert.equal(started,allowed);assert.equal(result.status,allowed?'finished':'uncertain');}
});
test('claim fields must equal the current immutable Oracle request before engine invocation',async()=>{
 for(const field of ['LABEL','SEED','MATERIALIZATION_BUDGET','CLAIM_TOKEN','CLAIM_BINDING','LEASE_CURRENT']){const f=fixture(),original=f.db.queue.execute;f.db.queue.execute=async(sql,binds)=>{const result=await original(sql,binds);if(sql.includes('from apxgen_app_control_requests'))result.rows[0][field]=field==='LEASE_CURRENT'?0:'different';return result;};let started=false;const result=await runControlWorker({...f,engine:async()=>{started=true;}});assert.equal(result.status,'uncertain');assert.equal(started,false);}
});
test('run attachment failure aborts the engine before advancing and never finishes or requeues',async()=>{
 const f=fixture();f.state.attachFails=true;let advanced=false;const result=await runControlWorker({...f,engine:async options=>{await assert.rejects(options.onRunCreated(runId));assert.equal(options.signal.aborted,true);if(!options.signal.aborted)advanced=true;throw new Error('TEST ONLY attachment aborted');}});assert.equal(advanced,false);assert.equal(result.status,'uncertain');assert.equal(result.reason,'RUN_ATTACHMENT_FAILED');assert.equal(f.calls.some(call=>call.sql.includes('worker_finish')),false);assert.equal(f.calls.filter(call=>call.sql.includes('worker_claim')).length,1);assert.equal(JSON.stringify(result).includes(token),false);
});
test('lost attachment commit acknowledgement aborts before the callback can permit materialization',async()=>{
 const f=fixture(),original=f.db.queue.commit;let queueCommits=0;f.db.queue.commit=async()=>{queueCommits++;if(queueCommits===2)throw new Error('TEST ONLY attachment commit uncertainty '+token);return original();};let advanced=false;
 const result=await runControlWorker({...f,engine:async options=>{await options.onRunCreated(runId);advanced=true;return {runId};}});assert.equal(advanced,false);assert.equal(result.status,'uncertain');assert.equal(result.reason,'RUN_ATTACHMENT_FAILED');assert.equal(f.calls.some(call=>call.sql.includes('worker_finish')),false);assert.equal(f.calls.filter(call=>call.sql.includes('worker_attach_run')).length,1);
});
test('an engine may attach exactly one fresh Oracle run and must return that identity',async()=>{
 for(const duplicate of [false,true]){const f=fixture();const result=await runControlWorker({...f,engine:async options=>{await options.onRunCreated(runId);if(duplicate)await assert.rejects(options.onRunCreated(runId));f.state.oracleState='COMPLETE';return {runId:duplicate?runId:'d'.repeat(32)};}});assert.equal(result.status,'uncertain');assert.equal(f.calls.filter(call=>call.sql.includes('worker_attach_run')).length,1);assert.equal(f.calls.some(call=>call.sql.includes('worker_finish')),false);}
});
test('engine crash before or after attach never causes a retry or invented terminal result',async()=>{
 for(const attach of [false,true]){const f=fixture();const result=await runControlWorker({...f,engine:async options=>{if(attach)await options.onRunCreated(runId);throw new Error('TEST ONLY private crash '+token);}});assert.equal(result.status,'uncertain');assert.equal(f.calls.filter(call=>call.sql.includes('worker_claim')).length,1);assert.equal(f.state.queueState,'CLAIMED');assert.equal(JSON.stringify(result).includes(token),false);}
});
test('a claimed successful engine result cannot finish without its awaited fresh-run attachment',async()=>{
 const f=fixture(),result=await runControlWorker({...f,engine:async()=>({runId,protocolCompleted:true})});assert.equal(result.status,'uncertain');assert.equal(result.reason,'MISSING_RUN_ATTACHMENT');assert.equal(f.calls.some(call=>call.sql.includes('worker_finish')),false);
});
test('terminal completion comes from Oracle even when the engine reports a different status',async()=>{
 const f=fixture();const result=await runControlWorker({...f,engine:async options=>{await options.onRunCreated(runId);f.state.oracleState='FAILED';return {runId,protocolCompleted:true,state:'COMPLETE'};}});assert.equal(result.oracleState,'FAILED');assert.equal(result.queueState,'FAILED');assert.equal(f.state.queueState,'FAILED');
});
test('lease renewal uses heartbeat connection and exact token, aborting on failure without retry',async()=>{
 const f=fixture();f.state.renewFails=true;const result=await runControlWorker({...f,engine:async options=>{await options.onRunCreated(runId);await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));throw new Error('TEST ONLY lease abort');}});assert.equal(result.status,'uncertain');assert.equal(result.reason,'LEASE_RENEWAL_FAILED');const renews=f.calls.filter(call=>call.sql.includes('worker_renew'));assert.equal(renews.length,1);assert.equal(renews[0].connection,'heartbeat');assert.equal(renews[0].binds.token,token);assert.equal(f.calls.filter(call=>call.sql.includes('worker_claim')).length,1);assert.equal(f.calls.some(call=>call.sql.includes('worker_finish')),false);assert.equal(JSON.stringify(result).includes(token),false);
});
test('a stalled renewal still aborts at the conservative claim lease deadline',async context=>{
 context.mock.timers.enable({apis:['setInterval','setTimeout']});const f=fixture();f.config.leaseSeconds=30;let engineResolve,renewResolve,engineSignal,started;
 const engineStarted=new Promise(resolve=>{started=resolve;}),original=f.db.heartbeat.execute;
 f.db.heartbeat.execute=async(sql,binds)=>{if(sql.includes('worker_renew'))return new Promise(resolve=>{renewResolve=resolve;});return original(sql,binds);};
 const work=runControlWorker({...f,engine:async options=>{await options.onRunCreated(runId);engineSignal=options.signal;started();await new Promise(resolve=>{engineResolve=resolve;});return {runId};}});
 await engineStarted;
 try{context.mock.timers.tick(1000);await new Promise(setImmediate);assert.equal(typeof renewResolve,'function');context.mock.timers.tick(30000);await new Promise(setImmediate);assert.equal(engineSignal.aborted,true,'engine must abort even while Oracle renewal is stalled');}
 finally{renewResolve?.({});engineResolve?.();}
 const result=await work;assert.equal(result.status,'uncertain');assert.equal(result.reason,'LEASE_EXPIRED');assert.equal(f.calls.some(call=>call.sql.includes('worker_finish')),false);
});
test('a renewal that never settles cannot hang the worker after cooperative engine abort',async context=>{
 context.mock.timers.enable({apis:['setInterval','setTimeout']});const f=fixture();f.config.leaseSeconds=30;let started,settled=false;const engineStarted=new Promise(resolve=>{started=resolve;}),original=f.db.heartbeat.execute;
 f.db.heartbeat.execute=async(sql,binds)=>sql.includes('worker_renew')?new Promise(()=>{}):original(sql,binds);
 const work=runControlWorker({...f,engine:async options=>{await options.onRunCreated(runId);started();await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));throw new Error('TEST ONLY cooperative engine stopped');}}).then(value=>{settled=true;return value;});
 await engineStarted;context.mock.timers.tick(1000);await new Promise(setImmediate);context.mock.timers.tick(30000);await new Promise(setImmediate);context.mock.timers.tick(10001);await new Promise(setImmediate);
 assert.equal(settled,true,'worker must settle within the bounded post-abort drain without resolving renewal');const result=await work;assert.equal(result.status,'uncertain');assert.equal(result.reason,'LEASE_EXPIRED');assert.equal(result.cleanupPending,true);assert.equal(f.calls.some(call=>call.sql.includes('worker_finish')),false);assert.equal(f.calls.filter(call=>call.sql.includes('worker_claim')).length,1);
});
