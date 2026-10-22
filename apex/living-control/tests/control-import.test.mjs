import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile,unlink,rmdir,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
const moduleUrl=new URL('../import-control.mjs',import.meta.url);
async function implementation(){const value=await import(moduleUrl.href).catch(()=>null);assert.ok(value,'Guarded native-control importer must exist');return value;}
function policy(){return {schemaVersion:'1.0',purpose:'NATIVE_CONTROL_CREATE_ONLY',enabled:true,schema:'APXGEN_ORDER_LAB',workspace:'APXGEN_ORDER_LAB',workspaceId:123456789,applicationId:134,alias:'GENESIS-LIVING-CONTROL',protectedApplicationIds:[120,121,130,131,132,133],expectedDatabase:{databaseName:'FREEPDB1',containerName:'FREEPDB1'},definitionHash:'a'.repeat(64),compilerEvidenceSha256:'b'.repeat(64),configEnabled:false,workerEnabled:false};}
test('native import policy can authorize only new disabled control134',async()=>{
 const {assertControlImportPolicy}=await implementation();const good=policy();assert.equal(assertControlImportPolicy(good),true);
 for(const bad of [{...good,applicationId:130},{...good,applicationId:120},{...good,schema:'APXGEN_LAB'},{...good,configEnabled:true},{...good,workerEnabled:true},{...good,protectedApplicationIds:[120,121]},{...good,genomeHash:'c'.repeat(64)},{...good,definitionHash:null}])assert.throws(()=>assertControlImportPolicy(bad));
});
test('global ID preflight requires exact container and unused target',async()=>{
 const {parseGlobalControlObservation}=await implementation();const good='CONTROL_ID_134_COUNT=0\nCONTROL_DB=FREEPDB1\nCONTROL_CONTAINER=FREEPDB1\n';
 assert.equal(parseGlobalControlObservation({stdout:good,stderr:'',exitCode:0,timedOut:false,spawnError:null},policy()).count,0);
 for(const result of [{stdout:good.replace('COUNT=0','COUNT=1')},{stdout:good.replaceAll('FREEPDB1','OTHER')},{stdout:good+'ORA-00001: denied'},{stdout:good,exitCode:1},{stdout:''},{stdout:good,timedOut:true}])assert.throws(()=>parseGlobalControlObservation({stdout:good,stderr:'',exitCode:0,timedOut:false,spawnError:null,...result},policy()));
});
test('same-name adoption, roles and enabled configuration refuse native import',async()=>{
 const {assertControlImportState}=await implementation();const good={schema:'APXGEN_ORDER_LAB',workspace:'APXGEN_ORDER_LAB',workspaceId:123456789,databaseName:'FREEPDB1',containerName:'FREEPDB1',applicationExists:false,enabled:false,workerEnabled:false,roles:0,requests:0,events:0,registeredSchema:null,registeredWorkspaceId:null,registeredApplicationId:null,workerBinding:null};
 assert.equal(assertControlImportState(policy(),good),true);
 for(const bad of [{...good,applicationExists:true},{...good,enabled:true},{...good,roles:1},{...good,requests:1},{...good,registeredApplicationId:134},{...good,registeredSchema:'APXGEN_ORDER_LAB'},{...good,workerBinding:'ANY'}])assert.throws(()=>assertControlImportState(policy(),bad));
});
test('a durable exclusive attempt blocks retries even when the first process did not finish',async()=>{
 const {claimControlImportAttempt}=await implementation();const directory=new URL('../../../.local/control-import-test-'+randomUUID()+'/',import.meta.url);await mkdir(directory,{recursive:true});
 const path=new URL('attempt.json',directory);const record={attemptId:'c'.repeat(32),applicationId:134,state:'RESERVED'};
 try{
  await claimControlImportAttempt(path,record);await assert.rejects(()=>claimControlImportAttempt(path,{...record,state:'RETRY'}));
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),record);
 }finally{
  const actual=await realpath(directory),privateRoot=resolve(fileURLToPath(new URL('../../../.local/',import.meta.url)));
  assert.ok(actual.startsWith(privateRoot+sep+'control-import-test-'));
  // Only this known fake file and its now-empty test directory are removed.
  await unlink(path);await rmdir(directory);
 }
});
