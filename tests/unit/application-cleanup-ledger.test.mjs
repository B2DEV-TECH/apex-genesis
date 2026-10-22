import test from 'node:test';
import assert from 'node:assert/strict';
import {runCleanupLedgerSuite} from '../integration/application-cleanup-ledger.mjs';

const policy={schemaVersion:'1.0',enabled:true,environment:'development',schema:'APXGEN_ORDER_LAB',workspace:'APXGEN_ORDER_LAB',workspaceId:123,applicationIds:[130,131,132,133],protectedApplicationIds:[120,121,134],fixtureWritesAuthorized:true,maxConcurrentImports:1,maxMaterializationsPerRun:22};
const configuration=()=>({user:policy.schema,password:'TEST_ONLY',connectString:'TEST_ONLY',sandbox:structuredClone(policy),expectedDatabase:{databaseName:'FREEPDB1',containerName:'FREEPDB1'}});

test('cleanup ledger suite skips before any configuration read or database connection without its explicit gate',async()=>{
  let reads=0,connections=0;const result=await runCleanupLedgerSuite({}, {read:async()=>{reads++;throw new Error('Must not read');},connect:async()=>{connections++;throw new Error('Must not connect');}});
  assert.equal(result.skipped,true);assert.equal(reads,0);assert.equal(connections,0);
});

test('cleanup ledger suite refuses unauthorized owner, pool, policy or database configuration before connecting',async()=>{
  for(const change of [c=>c.user='SYS',c=>c.sandbox.schema='APXGEN_LAB',c=>c.sandbox.enabled=false,c=>c.sandbox.applicationIds.push(134),c=>c.sandbox.applicationIds=[999],c=>delete c.expectedDatabase,c=>c.expectedDatabase.databaseName='bad endpoint']){
    const config=configuration();change(config);let connections=0;
    await assert.rejects(runCleanupLedgerSuite({configPath:'TEST_ONLY_CONFIG'}, {read:async()=>Buffer.from(JSON.stringify(config)),connect:async()=>{connections++;throw new Error('Must not connect');}}));assert.equal(connections,0);
  }
});

test('an enabled native worker blocks ledger probes and both rollback and close are attempted',async()=>{
  const config=configuration(),sql=[],cleanup=[];let connections=0;
  const db={async execute(text){sql.push(text);if(text.includes("sys_context('USERENV','DB_NAME')"))return {rows:[{USERNAME:config.user,SESSION_USER:config.user,CURRENT_SCHEMA:config.user,CURRENT_USER:config.user,DATABASE_NAME:'FREEPDB1',CONTAINER_NAME:'FREEPDB1'}]};if(text.includes('apex_workspace_schemas'))return {rows:[{WORKSPACE_NAME:policy.workspace,WORKSPACE_ID:policy.workspaceId}]};if(text.includes('apxgen_app_control_config'))return {rows:[{CONFIG_ID:1,WORKER_ENABLED:1}]};return {rows:[]};},async rollback(){cleanup.push('rollback');},async close(){cleanup.push('close');}};
  await assert.rejects(runCleanupLedgerSuite({configPath:'TEST_ONLY_CONFIG'}, {read:async()=>Buffer.from(JSON.stringify(config)),connect:async()=>{connections++;return db;}}),/worker.*disabled/i);
  assert.equal(connections,1);assert.ok(!sql.some(text=>/^\s*(insert|update|delete|create|alter|drop)\b/i.test(text)));assert.deepEqual(cleanup,['rollback','close']);
});
