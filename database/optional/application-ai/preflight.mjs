// Pure admission checks for synthetic migration fixtures. No connection or DDL.
import assert from 'node:assert/strict';

// Oracle-generated names are not authority. Bind the only permitted LOB pair to
// its exact USER_LOBS column and to the actual object/index metadata.
export function assertTestOnlyProposalLobStorage({owner,lobs,objects,indexes}){
 assert.ok(['APXGEN_AI_BROKER_TEST','APXGEN_APP_BROKER_TEST'].includes(owner));
 for(const value of [lobs,objects,indexes])assert.ok(Array.isArray(value));
 const segments=objects.filter(object=>object.OBJECT_TYPE==='LOB'),lobIndexes=indexes.filter(index=>index.INDEX_TYPE==='LOB');
 if(owner==='APXGEN_APP_BROKER_TEST'){
  assert.deepEqual(lobs,[],'Application fixture has no LOB columns');assert.deepEqual(segments,[]);assert.deepEqual(lobIndexes,[]);return null;
 }
 assert.equal(lobs.length,1,'Only the PROPOSAL LOB may exist');const lob=lobs[0];
 assert.equal(lob.TABLE_NAME,'APXGEN_INVOCATIONS');assert.equal(lob.COLUMN_NAME,'PROPOSAL');
 for(const name of [lob.SEGMENT_NAME,lob.INDEX_NAME])assert.match(name,/^[A-Z][A-Z0-9_$#]{0,127}$/);
 assert.deepEqual(segments,[{OBJECT_NAME:lob.SEGMENT_NAME,OBJECT_TYPE:'LOB',STATUS:'VALID'}],'LOB segment must match the actual object');
 assert.deepEqual(objects.filter(object=>object.OBJECT_NAME===lob.INDEX_NAME&&object.OBJECT_TYPE==='INDEX'),[{OBJECT_NAME:lob.INDEX_NAME,OBJECT_TYPE:'INDEX',STATUS:'VALID'}],'LOB index must match the actual object');
 assert.deepEqual(lobIndexes,[{INDEX_NAME:lob.INDEX_NAME,TABLE_NAME:lob.TABLE_NAME,INDEX_TYPE:'LOB'}],'Only the exact PROPOSAL LOB index may exist');
 assert.equal(indexes.filter(index=>index.INDEX_NAME===lob.INDEX_NAME).length,1);
 return {segmentName:lob.SEGMENT_NAME,indexName:lob.INDEX_NAME};
}

const table=definition=>Object.freeze(Object.fromEntries(definition.split('|').map(value=>{const [name,type,nullable]=value.trim().split(' ');return [name,type+':'+nullable];})));
export const TEST_ONLY_SUBJECT_LAYOUT=Object.freeze({
 billing:Object.freeze({
  APXGEN_APP_AI_TEST_MARKER:table('KIND VARCHAR2(64) N'),
  APXGEN_RUNS:table('RUN_ID VARCHAR2(32) N|POPULATION_MODE VARCHAR2(20) N|STATE VARCHAR2(24) N|LABEL VARCHAR2(160) N'),
  APXGEN_ORGANISMS:table('ORGANISM_ID NUMBER N|RUN_ID VARCHAR2(32) N|GENERATION NUMBER N|EVALUATION_STATE VARCHAR2(24) N'),
  APXGEN_RUN_BUDGETS:table('RUN_ID VARCHAR2(32) N|ENABLED NUMBER N|LIMIT_USD NUMBER N|STOPPED NUMBER N'),
  APXGEN_PROVIDER_CONFIG:table('SINGLETON NUMBER N|ENABLED NUMBER N|CREDENTIAL_STATIC_ID VARCHAR2(255) Y|MODEL_ID VARCHAR2(128) Y|VERIFIED_MODEL_ID VARCHAR2(128) Y|INPUT_USD_PER_MILLION NUMBER Y|OUTPUT_USD_PER_MILLION NUMBER Y|PRICING_REVIEWED_AT TIMESTAMP_TZ Y|MODEL_VERIFIED_AT TIMESTAMP_TZ Y|DAILY_LIMIT_USD NUMBER N|MAX_INPUT_TOKENS NUMBER N|MAX_OUTPUT_TOKENS NUMBER N|MAX_REQUESTS_PER_RUN NUMBER N|REQUEST_INTERVAL NUMBER N|MAX_CONCURRENCY NUMBER N|TOTAL_LIMIT_USD NUMBER N'),
  APXGEN_INVOCATIONS:table('INVOCATION_ID VARCHAR2(32) N|RUN_ID VARCHAR2(32) N|GENERATION NUMBER N|ORGANISM_ID NUMBER Y|STATE VARCHAR2(16) N|RESERVED_USD NUMBER N|ACTUAL_USD NUMBER Y|INPUT_RATE NUMBER N|OUTPUT_RATE NUMBER N|MAX_INPUT_TOKENS NUMBER N|MAX_OUTPUT_TOKENS NUMBER N|INPUT_TOKENS NUMBER Y|OUTPUT_TOKENS NUMBER Y|MODEL_ID VARCHAR2(128) N|PROPOSAL CLOB Y|ERROR_CODE VARCHAR2(80) Y|CREATED_AT TIMESTAMP_TZ N|COMPLETED_AT TIMESTAMP_TZ Y|APPLIED_ORGANISM NUMBER Y')
 }),
 application:Object.freeze({
  APXGEN_APP_AI_TEST_MARKER:table('KIND VARCHAR2(64) N'),
  APXGEN_APP_RUNS:table('RUN_ID VARCHAR2(32) N|POPULATION_MODE VARCHAR2(12) N|STATE VARCHAR2(16) N|BEST_ORGANISM_ID VARCHAR2(32) Y'),
  APXGEN_APP_ORGANISMS:table('ORGANISM_ID VARCHAR2(32) N|RUN_ID VARCHAR2(32) N|GENERATION NUMBER N|PARENT_ID VARCHAR2(32) Y|GENOME_HASH VARCHAR2(64) N|METHOD VARCHAR2(12) N|STATE VARCHAR2(24) N|ELIGIBLE NUMBER Y|SELECTED NUMBER N|AI_INVOCATION_ID VARCHAR2(32) Y'),
  APXGEN_APP_CONTROL_CONFIG:table('CONFIG_ID NUMBER N|WORKER_ENABLED NUMBER N'),
  APXGEN_APP_CONTROL_REQUESTS:table('REQUEST_ID VARCHAR2(32) N|STATE VARCHAR2(12) N')
 })
});
export const TEST_ONLY_SUBJECT_INSTALLED_LAYOUT=Object.freeze({
 billing:Object.freeze({...TEST_ONLY_SUBJECT_LAYOUT.billing,
  APXGEN_INVOCATIONS:Object.freeze({...TEST_ONLY_SUBJECT_LAYOUT.billing.APXGEN_INVOCATIONS,RUN_ID:'VARCHAR2(32):Y',...table('SUBJECT_KIND VARCHAR2(12) N|APP_RUN_ID VARCHAR2(32) Y|APP_PARENT_ID VARCHAR2(32) Y|APPLIED_APP_ORGANISM_ID VARCHAR2(32) Y|APP_AUTHORIZATION_ID VARCHAR2(32) Y|APP_PARENT_GENOME_HASH VARCHAR2(64) Y|APP_PROTOCOL_HASH VARCHAR2(64) Y|APP_SOURCE_HASH VARCHAR2(64) Y|APP_EVALUATOR_HASH VARCHAR2(64) Y|APP_MAPPING_HASH VARCHAR2(64) Y|CREDENTIAL_STATIC_ID VARCHAR2(255) Y|REQUEST_HASH VARCHAR2(64) Y|RESPONSE_HASH VARCHAR2(64) Y')}),
  APXGEN_APP_AI_BUDGETS:table('APP_RUN_ID VARCHAR2(32) N|AUTHORIZATION_ID VARCHAR2(32) N|SCHEMA_NAME VARCHAR2(128) N|WORKSPACE_ID NUMBER N|AUTHORIZED_BY VARCHAR2(255) N|AUTHORIZED_AT TIMESTAMP_TZ N|EXPIRES_AT TIMESTAMP_TZ N|ENABLED NUMBER N|STOPPED NUMBER N|LIMIT_USD NUMBER N|MAX_REQUESTS NUMBER N|MAX_INPUT_TOKENS NUMBER N|MAX_OUTPUT_TOKENS NUMBER N|MODEL_ID VARCHAR2(128) N|PROTOCOL_HASH VARCHAR2(64) N|SOURCE_HASH VARCHAR2(64) N|EVALUATOR_HASH VARCHAR2(64) N|MAPPING_HASH VARCHAR2(64) N')
 }),application:TEST_ONLY_SUBJECT_LAYOUT.application
});

export function assertTestOnlySubjectPreflight(observed,expectedDatabase,{installed=false}={}){
 assert.ok(expectedDatabase);assert.deepEqual(Object.keys(expectedDatabase).sort(),['containerName','databaseName']);for(const value of Object.values(expectedDatabase))assert.match(value,/^[A-Z][A-Z0-9_$#]{0,127}$/);
 for(const [name,owner,marker,packages]of [['billing','APXGEN_AI_BROKER_TEST','TEST_ONLY_APP_AI_BILLING_V1',['APXGEN_BUDGET']],['application','APXGEN_APP_BROKER_TEST','TEST_ONLY_APP_AI_APPLICATION_V1',[]]]){
  const value=observed?.[name];assert.ok(value,'Both explicit TEST_ONLY schema observations are required');
  for(const key of ['sessionUser','currentSchema','currentUser'])assert.equal(value[key],owner,'Only the fixed isolated TEST_ONLY owner may install subjects');
  assert.equal(value.databaseName,expectedDatabase.databaseName);assert.equal(value.containerName,expectedDatabase.containerName);assert.equal(value.marker,marker);
  const expectedPackages=installed&&name==='billing'?['APXGEN_APP_AI_SUBJECTS',...packages]:packages;
  assert.deepEqual(value.tables,(installed?TEST_ONLY_SUBJECT_INSTALLED_LAYOUT:TEST_ONLY_SUBJECT_LAYOUT)[name],'Unknown or changed prior fixture schema');assert.deepEqual([...value.packages].sort(),expectedPackages);assert.deepEqual([...value.otherObjects].sort(),name==='application'?['TRIGGER:APXGEN_APP_AI_TEST_IDENTITY']:installed?['TRIGGER:APXGEN_APP_AI_GRANT_GUARD','TRIGGER:APXGEN_APP_AI_INV_GUARD']:[],'Unknown prior schema objects');
 }
 assert.equal(observed.billing.legacyBudgetSourceMatches,true,'Original APXGEN_BUDGET source must match');
 for(const field of ['providerEnabled','reservedInvocations','legacyRunning','applicationRunning','workerEnabled','queuedOrClaimed'])assert.equal(observed[field],0,'Active provider/reservation/worker/run blocks installation');
 assert.equal(observed.maxConcurrency,1);assert.equal(observed.attachedApexContext,false);return true;
}
