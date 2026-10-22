import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTestOnlySubjectPreflight,assertTestOnlyProposalLobStorage,TEST_ONLY_SUBJECT_LAYOUT,TEST_ONLY_SUBJECT_INSTALLED_LAYOUT} from '../../database/optional/application-ai/preflight.mjs';

const observation=()=>({billing:{sessionUser:'APXGEN_AI_BROKER_TEST',currentSchema:'APXGEN_AI_BROKER_TEST',currentUser:'APXGEN_AI_BROKER_TEST',databaseName:'TESTPDB',containerName:'TESTPDB',marker:'TEST_ONLY_APP_AI_BILLING_V1',tables:structuredClone(TEST_ONLY_SUBJECT_LAYOUT.billing),packages:['APXGEN_BUDGET'],otherObjects:[],legacyBudgetSourceMatches:true},application:{sessionUser:'APXGEN_APP_BROKER_TEST',currentSchema:'APXGEN_APP_BROKER_TEST',currentUser:'APXGEN_APP_BROKER_TEST',databaseName:'TESTPDB',containerName:'TESTPDB',marker:'TEST_ONLY_APP_AI_APPLICATION_V1',tables:structuredClone(TEST_ONLY_SUBJECT_LAYOUT.application),packages:[],otherObjects:['TRIGGER:APXGEN_APP_AI_TEST_IDENTITY']},providerEnabled:0,maxConcurrency:1,reservedInvocations:0,legacyRunning:0,applicationRunning:0,workerEnabled:0,queuedOrClaimed:0,attachedApexContext:false});

test('subject installation preflight accepts only the exact disabled synthetic schema pair',()=>{
  assert.equal(assertTestOnlySubjectPreflight(observation(),{databaseName:'TESTPDB',containerName:'TESTPDB'}),true);
});

test('synthetic financial rows preserve the original required creation timestamp before and after subject migration',()=>{
  assert.equal(TEST_ONLY_SUBJECT_LAYOUT.billing.APXGEN_INVOCATIONS.CREATED_AT,'TIMESTAMP_TZ:N');
  assert.equal(TEST_ONLY_SUBJECT_INSTALLED_LAYOUT.billing.APXGEN_INVOCATIONS.CREATED_AT,'TIMESTAMP_TZ:N');
  const value=observation();value.billing.tables.APXGEN_INVOCATIONS.CREATED_AT='TIMESTAMP_TZ:Y';
  assert.throws(()=>assertTestOnlySubjectPreflight(value,{databaseName:'TESTPDB',containerName:'TESTPDB'}));
});

test('installed admission accepts only the complete typed schema while retaining the legacy package',()=>{
 const value=observation();value.billing.tables=structuredClone(TEST_ONLY_SUBJECT_INSTALLED_LAYOUT.billing);value.billing.packages.push('APXGEN_APP_AI_SUBJECTS');value.billing.otherObjects=['TRIGGER:APXGEN_APP_AI_GRANT_GUARD','TRIGGER:APXGEN_APP_AI_INV_GUARD'];
 assert.equal(assertTestOnlySubjectPreflight(value,{databaseName:'TESTPDB',containerName:'TESTPDB'},{installed:true}),true);
 delete value.billing.tables.APXGEN_INVOCATIONS.APP_PARENT_ID;
 assert.throws(()=>assertTestOnlySubjectPreflight(value,{databaseName:'TESTPDB',containerName:'TESTPDB'},{installed:true}));
});

test('subject preflight rejects active LAB identities, unknown prior objects or changed legacy source',()=>{
  for(const change of [o=>o.billing.sessionUser='APXGEN_LAB',o=>o.application.currentSchema='APXGEN_ORDER_LAB',o=>o.billing.marker='PRODUCTION',o=>o.billing.tables.APXGEN_INVOCATIONS.extra='VARCHAR2:1',o=>delete o.application.tables.APXGEN_APP_RUNS,o=>o.billing.packages.push('UNREVIEWED'),o=>o.billing.otherObjects.push('TRIGGER:UNREVIEWED'),o=>o.billing.legacyBudgetSourceMatches=false,o=>o.application.containerName='OTHER']){
    const value=observation();change(value);assert.throws(()=>assertTestOnlySubjectPreflight(value,{databaseName:'TESTPDB',containerName:'TESTPDB'}));
  }
});

test('subject preflight rejects any live provider, reservation, worker, run or attached browser context',()=>{
  for(const field of ['providerEnabled','reservedInvocations','legacyRunning','applicationRunning','workerEnabled','queuedOrClaimed','attachedApexContext']){const value=observation();value[field]=field==='attachedApexContext'?true:1;assert.throws(()=>assertTestOnlySubjectPreflight(value,{databaseName:'TESTPDB',containerName:'TESTPDB'}));}
  const value=observation();value.maxConcurrency=2;assert.throws(()=>assertTestOnlySubjectPreflight(value,{databaseName:'TESTPDB',containerName:'TESTPDB'}));
});

const proposalStorage=()=>({owner:'APXGEN_AI_BROKER_TEST',lobs:[{TABLE_NAME:'APXGEN_INVOCATIONS',COLUMN_NAME:'PROPOSAL',SEGMENT_NAME:'EXACT_PROPOSAL_SEGMENT',INDEX_NAME:'EXACT_PROPOSAL_INDEX'}],objects:[{OBJECT_NAME:'EXACT_PROPOSAL_SEGMENT',OBJECT_TYPE:'LOB',STATUS:'VALID'},{OBJECT_NAME:'EXACT_PROPOSAL_INDEX',OBJECT_TYPE:'INDEX',STATUS:'VALID'}],indexes:[{INDEX_NAME:'EXACT_PROPOSAL_INDEX',TABLE_NAME:'APXGEN_INVOCATIONS',INDEX_TYPE:'LOB'}]});

test('PROPOSAL storage is admitted by exact USER_LOBS relationships rather than a generated name prefix',()=>{
 assert.deepEqual(assertTestOnlyProposalLobStorage(proposalStorage()),{segmentName:'EXACT_PROPOSAL_SEGMENT',indexName:'EXACT_PROPOSAL_INDEX'});
 assert.equal(assertTestOnlyProposalLobStorage({owner:'APXGEN_APP_BROKER_TEST',lobs:[],objects:[],indexes:[]}),null);
});

test('LOB admission rejects extra, missing, unbound and falsely attributed segments or indexes',()=>{
 for(const change of [
  value=>value.owner='APXGEN_LAB',value=>value.lobs=[],value=>value.lobs.push({...value.lobs[0]}),
  value=>value.lobs[0].TABLE_NAME='OTHER_TABLE',value=>value.lobs[0].COLUMN_NAME='OTHER_COLUMN',
  value=>value.lobs[0].SEGMENT_NAME='SYS_LOB_UNBOUND',value=>value.lobs[0].INDEX_NAME='SYS_IL_UNBOUND',
  value=>value.objects.pop(),value=>value.objects[0].STATUS='INVALID',value=>value.objects[1].OBJECT_TYPE='TABLE',
  value=>value.objects.push({OBJECT_NAME:'SYS_LOB_EXTRA',OBJECT_TYPE:'LOB',STATUS:'VALID'}),
  value=>value.indexes=[],value=>value.indexes[0].TABLE_NAME='OTHER_TABLE',value=>value.indexes[0].INDEX_TYPE='NORMAL',
  value=>value.indexes.push({INDEX_NAME:'SYS_IL_EXTRA',TABLE_NAME:'OTHER_TABLE',INDEX_TYPE:'LOB'}),
  value=>value.owner='APXGEN_APP_BROKER_TEST'
 ]){const value=proposalStorage();change(value);assert.throws(()=>assertTestOnlyProposalLobStorage(value));}
});
