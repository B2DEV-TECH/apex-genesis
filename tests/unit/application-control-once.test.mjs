import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {parseControlOnceArgs,validateControlOnceConfiguration,runControlOnce,retireControlConnections,controlOnceOutput} from '../../scripts/application/run-control-once.mjs';

// TEST ONLY synthetic config/owner connections. Claims are empty or invalid;
// the fixed real engine is never invoked and no Oracle connection is opened.
const binding='TEST_ONLY_NATIVE_BINDING',token='c'.repeat(32),requestId='a'.repeat(32),workspaceId=8303111957118921;
function fixture(){
 const nativePath=resolve('TEST-native-worker.json'),sandboxPath=resolve('TEST-sandbox-worker.json');
 const native={schemaVersion:'1.0',enabled:true,mode:'GA_ONLY',paidRequestBudget:0,binding,pool:{applicationIds:[150,151],canaryApplicationId:152},capabilities:{seed:50000,advances:1,materializations:2},leaseSeconds:300,heartbeatSeconds:30};
 const sandbox={oracleConfigPath:'TEST-oracle.json',sandboxPolicyPath:'TEST-policy.json',sqlclPath:'TEST-sql.cmd'};
 const policy={schemaVersion:'1.0',enabled:true,environment:'development',schema:'APXGEN_ORDER_LAB',workspace:'APXGEN_ORDER_LAB',workspaceId,applicationIds:[150,151,152],protectedApplicationIds:[120,121,130,131,132,133,134],fixtureWritesAuthorized:true,maxConcurrentImports:1,maxMaterializationsPerRun:2};
 const oracle={user:'APXGEN_ORDER_LAB',password:'TEST_ONLY_DATABASE_PASSWORD',connectString:'TEST_ONLY_DATABASE_SERVICE',workspace:'APXGEN_ORDER_LAB',apexUser:'TEST_ONLY_APEX_USER',apexPassword:'TEST_ONLY_APEX_PASSWORD'};
 const logs=[],reads=[],connections=[],claimResponses=[null],state={now:0,connected:0};
 const server={CONFIG_ID:1,ENABLED:1,SCHEMA_NAME:'APXGEN_ORDER_LAB',WORKSPACE_ID:workspaceId,CONTROL_APPLICATION_ID:134,MAX_GENERATIONS:1,MAX_MATERIALIZATIONS:2,WORKER_ENABLED:1,WORKER_BINDING:binding};
 const values=new Map([[nativePath,native],[sandboxPath,sandbox],[resolve(dirname(sandboxPath),sandbox.oracleConfigPath),oracle],[resolve(dirname(sandboxPath),sandbox.sandboxPolicyPath),policy]]);
 const services={async readJson(path){reads.push(path);if(!values.has(path)){const error=new Error('TEST ONLY missing config');error.code='ENOENT';throw error;}return structuredClone(values.get(path));},async connect(credentials){assert.deepEqual(credentials,{user:oracle.user,password:oracle.password,connectString:oracle.connectString});const name=state.connected++===0?'queue':'heartbeat';const client={
  async execute(sql,binds={}){logs.push({name,sql,binds});assert.ok(client.callTimeout>0&&client.callTimeout<=10000,'bound driver before SQL');if(sql.includes('sys_context'))return {rows:[{SCHEMA_NAME:'APXGEN_ORDER_LAB',SESSION_USER:'APXGEN_ORDER_LAB',CURRENT_USER:'APXGEN_ORDER_LAB',DATABASE_NAME:'TEST_DATABASE',CONTAINER_NAME:'TEST_CONTAINER'}]};if(sql.includes('apex_workspace_schemas'))return {rows:[{WORKSPACE:'APXGEN_ORDER_LAB',WORKSPACE_ID:workspaceId}]};if(sql.includes('from apxgen_app_control_config'))return {rows:[structuredClone(server)]};if(sql.includes('worker_heartbeat'))return {};if(sql.includes('worker_claim'))return {outBinds:{claim:JSON.stringify(claimResponses.shift()??null)}};throw new Error('TEST ONLY engine must not execute');},async commit(){logs.push({name,sql:'COMMIT'});},async rollback(){logs.push({name,sql:'ROLLBACK'});},async break(){logs.push({name,sql:'BREAK'});},async close(){logs.push({name,sql:'CLOSE'});}};connections.push(client);return client;},async sleep(ms){logs.push({sql:'SLEEP',ms});state.now+=ms;},now:()=>state.now};
 return {nativePath,sandboxPath,native,sandbox,policy,oracle,server,values,reads,services,state,logs,connections,claimResponses,argv:[nativePath,sandboxPath,'--once']};
}

test('only two explicit JSON paths, --once and a bounded optional wait are accepted',()=>{
 const f=fixture();assert.deepEqual(parseControlOnceArgs([...f.argv,'--wait-seconds=120']),{nativeConfigPath:f.nativePath,sandboxConfigPath:f.sandboxPath,waitSeconds:120});assert.equal(parseControlOnceArgs(f.argv).waitSeconds,0);
 for(const argv of [[],[...f.argv,'--loop'],[...f.argv,'--engine=other.mjs'],[...f.argv,'--wait-seconds=121'],[...f.argv,'--wait-seconds=-1'],[...f.argv,'--wait-seconds=1.5'],[...f.argv,'--wait-seconds=5','--once'],[f.nativePath,f.sandboxPath,'--watch'],[f.nativePath,'--once']])assert.throws(()=>parseControlOnceArgs(argv),/usage|once|argument|wait/i);
});
test('missing or disabled native configuration opens no database and reads no private credentials',async()=>{
 const f=fixture();f.native.enabled=false;assert.deepEqual(await runControlOnce(f.argv,f.services),{status:'disabled'});assert.equal(f.state.connected,0);assert.deepEqual(f.reads,[f.nativePath]);
 const g=fixture();g.values.delete(g.nativePath);assert.deepEqual(await runControlOnce(g.argv,g.services),{status:'disabled'});assert.equal(g.state.connected,0);
});
test('source example stays disabled with no live binding or credentials',async()=>{
 const config=JSON.parse(await readFile(new URL('../../experiments/configurations/application-control-worker.example.json',import.meta.url),'utf8'));assert.equal(config.enabled,false);assert.equal(config.binding,'DISABLED_NOT_A_BINDING');assert.equal(config.paidRequestBudget,0);assert.equal(config.leaseSeconds,300);assert.equal(/password|connectString|engineModule|executable/.test(JSON.stringify(config)),false);
});
test('native pool, workspace and credentials must match the dedicated sandbox before connecting',async()=>{
 for(const mutate of [f=>{f.policy.applicationIds=[150,151,153];},f=>{f.policy.protectedApplicationIds.push(150);},f=>{f.policy.schema='APXGEN_LAB';f.oracle.user='APXGEN_LAB';},f=>{f.oracle.workspace='OTHER_WORKSPACE';},f=>{f.policy.workspace='OTHER_WORKSPACE';f.oracle.workspace='OTHER_WORKSPACE';},f=>{f.native.leaseSeconds=150;},f=>{f.sandbox.extra='unreviewed';}]){const f=fixture();mutate(f);await assert.rejects(runControlOnce(f.argv,f.services),/pool|sandbox|owner|workspace|lease|configuration/i);assert.equal(f.state.connected,0);}
});
test('the wrapper permits no configurable or injected alternate engine',async()=>{
 const f=fixture();f.native.engineModule='TEST_unreviewed.mjs';await assert.rejects(runControlOnce(f.argv,f.services),/unknown|configuration/i);assert.equal(f.state.connected,0);
 const g=fixture();await assert.rejects(runControlOnce(g.argv,{...g.services,engine:async()=>{throw new Error('must not run');}}),/service|engine|unknown/i);assert.equal(g.state.connected,0);
});
test('idle polling opens exactly two clients, waits in five-second steps and closes both',async()=>{
 const f=fixture(),result=await runControlOnce([...f.argv,'--wait-seconds=12'],f.services);assert.deepEqual(result,{status:'idle'});assert.equal(f.state.connected,2);assert.equal(f.logs.filter(log=>log.sql.includes('worker_claim')).length,3);assert.deepEqual(f.logs.filter(log=>log.sql==='SLEEP').map(log=>log.ms),[5000,5000,2000]);assert.equal(f.state.now,12000);assert.deepEqual(f.logs.filter(log=>log.sql==='CLOSE').map(log=>log.name).sort(),['heartbeat','queue']);assert.equal(f.logs.some(log=>log.sql==='BREAK'),false);
});
test('an uncertain claim ends polling immediately and retires both clients without leaking private values',async()=>{
 const f=fixture();f.claimResponses.push({id:requestId,label:'TEST ONLY private request label',state:'CLAIMED',seed:1,generations:1,materializationBudget:2,runId:null,claimToken:token});const result=await runControlOnce([...f.argv,'--wait-seconds=120'],f.services);
 assert.equal(result.status,'uncertain');assert.equal(result.reason,'INVALID_REQUEST');assert.equal(f.logs.filter(log=>log.sql.includes('worker_claim')).length,2);assert.equal(f.state.now,5000);for(const name of ['queue','heartbeat'])assert.ok(f.logs.findIndex(log=>log.name===name&&log.sql==='BREAK')<f.logs.findIndex(log=>log.name===name&&log.sql==='CLOSE'));
 const printed=JSON.stringify(controlOnceOutput(result));for(const value of [binding,token,f.oracle.password,f.oracle.connectString,'TEST ONLY private request label'])assert.equal(printed.includes(value),false);assert.equal(printed.includes(requestId),true);
});
test('server binding/workspace mismatch or disabled worker prevents heartbeat and claims',async()=>{
 for(const mutate of [f=>{f.server.WORKER_BINDING='OTHER_BINDING';},f=>{f.server.WORKSPACE_ID=123;},f=>{f.server.MAX_GENERATIONS=2;}]){const f=fixture();mutate(f);const result=await runControlOnce(f.argv,f.services);assert.equal(result.status,'uncertain');assert.equal(f.logs.some(log=>log.sql.includes('worker_heartbeat')||log.sql.includes('worker_claim')),false);assert.equal(f.logs.filter(log=>log.sql==='CLOSE').length,2);}
 const f=fixture();f.server.WORKER_ENABLED=0;assert.equal((await runControlOnce(f.argv,f.services)).status,'disabled');assert.equal(f.logs.some(log=>log.sql.includes('worker_heartbeat')),false);
});
test('failure opening the second client still attempts closing the first',async()=>{
 const f=fixture(),connect=f.services.connect;f.services.connect=async credentials=>{if(f.state.connected===1)throw new Error('TEST ONLY private connection failure '+f.oracle.password);return connect(credentials);};const result=await runControlOnce(f.argv,f.services);assert.equal(result.status,'uncertain');assert.equal(f.logs.filter(log=>log.sql==='CLOSE').length,1);assert.equal(JSON.stringify(controlOnceOutput(result)).includes(f.oracle.password),false);
});
test('one close failure cannot skip the other client or masquerade as success',async()=>{
 const f=fixture(),connect=f.services.connect;f.services.connect=async credentials=>{const client=await connect(credentials);if(f.state.connected===1)client.close=async()=>{f.logs.push({name:'queue',sql:'CLOSE'});throw new Error('TEST ONLY close failure '+f.oracle.password);};return client;};const result=await runControlOnce(f.argv,f.services);assert.equal(result.status,'uncertain');assert.equal(result.reason,'RESOURCE_CLEANUP_UNCERTAIN');assert.equal(result.cleanupPending,true);assert.equal(f.logs.filter(log=>log.sql==='CLOSE').length,2);
});
test('forced retirement bounds stalled break and still attempts close on both clients',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});const calls=[],client=()=>({async break(){calls.push('BREAK');return new Promise(()=>{});},async close(){calls.push('CLOSE');}});const work=retireControlConnections([client(),client()],{force:true});await new Promise(setImmediate);context.mock.timers.tick(5001);await new Promise(setImmediate);assert.equal(await work,false);assert.equal(calls.filter(call=>call==='CLOSE').length,2);
});
test('CLI output is a strict static state and ID projection',()=>{
 const output=controlOnceOutput({status:'uncertain',requestId,runId:'b'.repeat(32),reason:'arbitrary '+token,binding,claimToken:token,label:'PRIVATE',password:'PRIVATE'});assert.deepEqual(output,{status:'uncertain',requestId,runId:'b'.repeat(32),reason:'CONTROL_WORKER_UNAVAILABLE'});
});
