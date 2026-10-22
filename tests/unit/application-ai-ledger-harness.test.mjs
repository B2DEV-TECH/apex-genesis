import test from 'node:test';
import assert from 'node:assert/strict';
import {runApplicationAiLedgerSuite,observeTestOnlySubjectSchema} from '../integration/application-ai-ledger.mjs';
import {acquireTestOnlyConnection,closeTestOnlyConnections} from '../../database/optional/application-ai/test-resources.mjs';
test('optional AI subject harness skips before credentials or connections without its explicit gate',async()=>{
 let reads=0,connections=0;const result=await runApplicationAiLedgerSuite({}, {read:async()=>{reads++;throw new Error('No credential read');},connect:async()=>{connections++;throw new Error('No DB');}});assert.equal(result.skipped,true);assert.equal(reads,0);assert.equal(connections,0);
});
test('synthetic harness bounds acquisition, closes late clients and attempts every rollback/close independently',async()=>{
 const credentials={user:'TEST_ONLY',password:'TEST_ONLY',connectString:'TEST_ONLY'},errors=[];let finish,lateClosed=0;
 const pending=acquireTestOnlyConnection(options=>{assert.equal(options.connectTimeout,10);assert.equal(options.transportConnectTimeout,5);assert.equal(options.retryCount,0);return new Promise(resolve=>{finish=resolve;});},credentials,errors,{timeoutMs:5});
 await assert.rejects(pending,/acquisition timed out/);finish({async close(){lateClosed++;}});await new Promise(resolve=>setImmediate(resolve));assert.equal(lateClosed,1);
 const calls=[],a={async rollback(){calls.push('a rollback');throw new Error('Synthetic rollback failure');},async close(){calls.push('a close');throw new Error('Synthetic close failure');}},b={async rollback(){calls.push('b rollback');},async close(){calls.push('b close');}};
 await closeTestOnlyConnections([a,b],errors);assert.deepEqual(calls.sort(),['a close','a rollback','b close','b rollback']);assert.ok(errors.includes('ROLLBACK_FAILED'));assert.ok(errors.includes('CLOSE_FAILED'));
});
test('optional AI subject harness refuses real owners and unapproved committed-fixture mode before connecting',async()=>{
 const config={testOnly:true,billing:{user:'APXGEN_AI_BROKER_TEST',password:'TEST_ONLY',connectString:'TEST_ONLY'},application:{user:'APXGEN_APP_BROKER_TEST',password:'TEST_ONLY',connectString:'TEST_ONLY'},expectedDatabase:{databaseName:'TESTPDB',containerName:'TESTPDB'}};
 for(const change of [c=>c.testOnly=false,c=>c.billing.user='APXGEN_LAB',c=>c.application.user='APXGEN_ORDER_LAB',c=>delete c.expectedDatabase,c=>c.expectedDatabase={unknownDatabase:'TESTPDB',unknownContainer:'TESTPDB'}]){let connections=0;const value=structuredClone(config);change(value);await assert.rejects(runApplicationAiLedgerSuite({configPath:'TEST_ONLY'}, {read:async()=>Buffer.from(JSON.stringify(value)),connect:async()=>{connections++;throw new Error('No DB');}}));assert.equal(connections,0);}
 let connections=0;await assert.rejects(runApplicationAiLedgerSuite({configPath:'TEST_ONLY',mode:'contract'},{read:async()=>Buffer.from(JSON.stringify(config)),connect:async()=>{connections++;throw new Error('No DB');}}),/committed.*synthetic/i);assert.equal(connections,0);
});

test('schema observer excludes only the exact dictionary-bound PROPOSAL LOB objects and index',async()=>{
 const metadata=()=>({objects:[{OBJECT_NAME:'EXACT_SEGMENT',OBJECT_TYPE:'LOB',STATUS:'VALID'},{OBJECT_NAME:'EXACT_INDEX',OBJECT_TYPE:'INDEX',STATUS:'VALID'}],indexes:[{INDEX_NAME:'EXACT_INDEX',TABLE_NAME:'APXGEN_INVOCATIONS',INDEX_TYPE:'LOB'}],lobs:[{TABLE_NAME:'APXGEN_INVOCATIONS',COLUMN_NAME:'PROPOSAL',SEGMENT_NAME:'EXACT_SEGMENT',INDEX_NAME:'EXACT_INDEX'}]});
 const connection=value=>({async execute(sql){let rows;
  if(sql.includes('current_schema'))rows=[{SESSION_USER:'APXGEN_AI_BROKER_TEST',CURRENT_SCHEMA:'APXGEN_AI_BROKER_TEST',CURRENT_USER:'APXGEN_AI_BROKER_TEST',DATABASE_NAME:'TESTPDB',CONTAINER_NAME:'TESTPDB'}];
  else if(sql==='select kind from apxgen_app_ai_test_marker')rows=[{KIND:'TEST_ONLY_APP_AI_BILLING_V1'}];
  else if(sql.includes('from user_tab_columns'))rows=[];
  else if(sql.includes('from user_objects'))rows=value.objects;
  else if(sql.includes('from user_indexes'))rows=value.indexes;
  else if(sql.includes('from user_lobs'))rows=value.lobs;
  else if(sql.includes('from user_constraints'))rows=[];
  else throw Error('Unexpected metadata query');
  return {rows};
 }});
 assert.deepEqual((await observeTestOnlySubjectSchema(connection(metadata()))).otherObjects,[]);
 const spoof=metadata();spoof.objects.push({OBJECT_NAME:'SYS_IL_SPOOF',OBJECT_TYPE:'INDEX',STATUS:'VALID'});spoof.indexes.push({INDEX_NAME:'SYS_IL_SPOOF',TABLE_NAME:'APXGEN_INVOCATIONS',INDEX_TYPE:'NORMAL'});
 assert.deepEqual((await observeTestOnlySubjectSchema(connection(spoof))).otherObjects,['INDEX:SYS_IL_SPOOF']);
 const unbound=metadata();unbound.indexes.push({INDEX_NAME:'SYS_IL_UNBOUND',TABLE_NAME:'APXGEN_INVOCATIONS',INDEX_TYPE:'LOB'});await assert.rejects(()=>observeTestOnlySubjectSchema(connection(unbound)));
 const premature=metadata();premature.indexes.push({INDEX_NAME:'APP_AI_GENERATION_UQ',TABLE_NAME:'APXGEN_INVOCATIONS',INDEX_TYPE:'NORMAL'});assert.deepEqual((await observeTestOnlySubjectSchema(connection(premature))).otherObjects,['INDEX:APP_AI_GENERATION_UQ']);
});
