// Rollback-only checks for an already installed migration 011. No installer,
// application API, fixture/slot update, run creation, commit or provider call.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import oracledb from 'oracledb';
import {validateSandboxPolicy,assertSandboxIdentity} from '../../runtime/application/sandbox.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>value instanceof Date?stable(value.toJSON()):Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
const identifier=value=>{assert.match(value,/^[A-Z][A-Z0-9_$#]{0,127}$/);return value;};
const uuid=()=>randomUUID().replaceAll('-','');
const options={outFormat:oracledb.OUT_FORMAT_OBJECT,fetchTypeHandler:column=>column.dbType===oracledb.DB_TYPE_CLOB?{type:oracledb.STRING}:undefined};
const preservedTables=['APXGEN_APP_CLEANUP_ATTEMPTS','APXGEN_APP_CONTROL_CONFIG','APXGEN_APP_CONTROL_USERS','APXGEN_APP_CONTROL_REQUESTS','APXGEN_APP_CONTROL_EVENTS','APXGEN_APP_EVENTS','APXGEN_APP_IMPORT_ATTEMPTS','APXGEN_APP_ORGANISMS','APXGEN_APP_RUNS','GENESIS_ORDERS','GENESIS_ORDER_LAB_SLOTS'];

function configuration(config){
  validateSandboxPolicy(config.sandbox);const policy=config.sandbox;
  assert.equal(config.user,policy.schema,'Explicit connection owner and sandbox schema must agree');
  assert.ok(!['APXGEN_LAB','APXGEN_VERIFY'].includes(config.user),'Historical experiment owners are excluded');
  assert.ok(config.workspace===undefined||config.workspace===policy.workspace,'Explicit workspace differs');
  assert.ok(policy.applicationIds.every(id=>[130,131,132,133].includes(id)),'Only the reviewed disposable application pool is supported');
  assert.ok([120,121].every(id=>policy.protectedApplicationIds.includes(id)),'Protected Genesis applications must be explicit');
  assert.ok(typeof config.password==='string'&&config.password.length>0&&typeof config.connectString==='string'&&config.connectString.length>0,'An explicit existing owner connection is required');
  assert.ok(config.expectedDatabase&&Object.keys(config.expectedDatabase).length===2,'Explicit expected database/container required');
  identifier(config.expectedDatabase.databaseName);identifier(config.expectedDatabase.containerName);
  return policy;
}

async function snapshot(db,rows){
  const data={};
  for(const table of preservedTables){
    const columns=await rows('select column_name,data_type from user_tab_columns where table_name=:table_name order by column_id',{table_name:table});assert.ok(columns.length>0,'All reviewed migrations, including control and cleanup ledgers, must already exist');
    const exact=columns.filter(column=>column.DATA_TYPE==='DATE'||column.DATA_TYPE.startsWith('TIMESTAMP')).map(column=>`,to_char(${column.DATA_TYPE==='DATE'?identifier(column.COLUMN_NAME):'sys_extract_utc('+identifier(column.COLUMN_NAME)+')'},'YYYY-MM-DD"T"HH24:MI:SS${column.DATA_TYPE==='DATE'?'':'.FF9'}"Z"') "${identifier(column.COLUMN_NAME)}_EXACT"`).join('');
    data[table]=(await rows('select t.*'+exact+' from '+table+' t')).sort((a,b)=>stable(a).localeCompare(stable(b)));
  }
  data.APEX_APPLICATIONS=(await rows('select a.* from apex_applications a order by application_id')).sort((a,b)=>stable(a).localeCompare(stable(b)));
  return {data,sha256:sha(stable(data))};
}

/** Primitive read/connect seams support local guard tests; synthetic adapters
 * cannot establish actual Oracle evidence. The CLI always uses the real driver.
 */
export async function runCleanupLedgerSuite({configPath}={}, {read=readFile,connect=connection=>oracledb.getConnection(connection)}={}){
  if(!configPath)return {suite:'application-cleanup-ledger',skipped:true,reason:'Set APXGEN_APPLICATION_TEST_CONFIG to an explicitly authorized existing sandbox configuration.'};
  const config=JSON.parse((await read(configPath,'utf8')).toString().replace(/^\uFEFF/,'')),policy=configuration(config);
  const db=await connect({user:config.user,password:config.password,connectString:config.connectString});db.callTimeout=30000;
  const rows=async(sql,binds={})=>(await db.execute(sql,binds,options)).rows;
  const checks=[],skippedChecks=[],resources=[];let result,error,contextChanged=false;
  const rejected=async(label,sql,binds,numbers)=>{await assert.rejects(()=>db.execute(sql,binds),failure=>numbers.includes(failure.errorNum),label);checks.push({label,passed:true});};
  async function idle(){
    const control=await rows('select * from apxgen_app_control_config where config_id=1 for update nowait');assert.equal(control.length,1);assert.equal(control[0].WORKER_ENABLED,0,'Native worker must be disabled before ledger probes');
    assert.equal((await rows("select count(*) n from apxgen_app_control_requests where state in('QUEUED','CLAIMED')"))[0].N,0,'Queued or claimed native work blocks this test');
    assert.equal((await rows("select count(*) n from apxgen_app_runs where state='RUNNING'"))[0].N,0,'Running application experiments block this test');
    await db.execute('lock table genesis_order_lab_slots in exclusive mode nowait');
  }
  try{
    const identity=(await rows("select user username,sys_context('USERENV','SESSION_USER') session_user,sys_context('USERENV','CURRENT_SCHEMA') current_schema,sys_context('USERENV','CURRENT_USER') current_user,sys_context('USERENV','DB_NAME') database_name,sys_context('USERENV','CON_NAME') container_name from dual"))[0];
    for(const key of ['USERNAME','SESSION_USER','CURRENT_SCHEMA','CURRENT_USER'])assert.equal(identity[key],policy.schema,'Direct owner connection required');
    assert.equal(identity.DATABASE_NAME,config.expectedDatabase.databaseName);assert.equal(identity.CONTAINER_NAME,config.expectedDatabase.containerName);
    await db.execute("begin if nvl(apex_application.g_flow_id,0)<>0 or nvl(apex_application.g_instance,0)<>0 or v('APP_ID') is not null or v('APP_USER') is not null then raise_application_error(-20137,'Direct worker context required');end if;end;");
    const mapping=await rows('select workspace_name,workspace_id from apex_workspace_schemas where schema=:schema_name and workspace_name=:workspace_name',{schema_name:policy.schema,workspace_name:policy.workspace});assert.equal(mapping.length,1);
    assertSandboxIdentity(policy,{schema:identity.CURRENT_SCHEMA,workspace:mapping[0].WORKSPACE_NAME,workspaceId:mapping[0].WORKSPACE_ID});
    await idle();
    const objects=await rows("select object_name,object_type,status from user_objects where object_name in('APXGEN_APP_CLEANUP_ATTEMPTS','APXGEN_APP_CLEANUP_IMMUTABLE') order by object_name");assert.equal(objects.length,2);assert.ok(objects.every(object=>object.STATUS==='VALID'),'Install and review migration 011 separately first');
    assert.equal((await rows("select count(*) n from user_errors where name in('APXGEN_APP_CLEANUP_ATTEMPTS','APXGEN_APP_CLEANUP_IMMUTABLE')"))[0].N,0);
    const pool=Object.fromEntries(policy.applicationIds.map((id,index)=>['app'+index,id])),placeholders=Object.keys(pool).map(name=>':'+name).join(',');
    const eligible=`select o.organism_id,o.run_id,o.application_id,o.genome_hash,o.artifact_hash from apxgen_app_organisms o join apxgen_app_runs r on r.run_id=o.run_id where o.application_id in(${placeholders}) and o.state='REJECTED' and r.state in('COMPLETE','FAILED','CANCELLED') and (r.best_organism_id is null or r.best_organism_id<>o.organism_id) and o.artifact_hash is not null and not exists(select 1 from apxgen_app_cleanup_attempts a where a.organism_id=o.organism_id) and not exists(select 1 from apxgen_app_events e where e.organism_id=o.organism_id and e.state in('CLEANUP_STARTED','DISPOSED','CLEANUP_UNCERTAIN'))`;
    const owner=(await rows(eligible+' order by o.organism_id',pool))[0];assert.ok(owner,'An existing terminal REJECTED nonincumbent with no prior cleanup attempt/history is required; this suite never creates one');
    await rows('select run_id from apxgen_app_runs where run_id=:run_id for update nowait',{run_id:owner.RUN_ID});await rows('select organism_id from apxgen_app_organisms where organism_id=:organism_id for update nowait',{organism_id:owner.ORGANISM_ID});
    assert.equal((await rows(eligible+' and o.organism_id=:organism_id',{...pool,organism_id:owner.ORGANISM_ID})).length,1,'Locked terminal ownership changed');
    const before=await snapshot(db,rows),attempt=uuid(),testHash=sha('TEST_ONLY rollback-only cleanup-ledger boundary '+attempt),otherApp=owner.APPLICATION_ID===130?131:130;
    const base={attempt,organism:owner.ORGANISM_ID,run:owner.RUN_ID,app:owner.APPLICATION_ID,genome:owner.GENOME_HASH,artifact:owner.ARTIFACT_HASH,policy:testHash,archive:testHash,snapshot:testHash,evidence:testHash,authorization:testHash,state:'STARTED',completed:null,error:null};
    const insert="insert into apxgen_app_cleanup_attempts(attempt_id,organism_id,run_id,application_id,genome_hash,artifact_hash,policy_hash,archive_hash,snapshot_hash,evidence_hash,authorization_hash,state,completed_at,error_code) values(:attempt,:organism,:run,:app,:genome,:artifact,:policy,:archive,:snapshot,:evidence,:authorization,:state,:completed,:error)";
    await db.execute('savepoint cleanup_test_start');await db.execute(insert,base);checks.push({label:'valid unfinished STARTED accepted for existing rejected terminal owner',passed:true});
    const started=(await rows('select * from apxgen_app_cleanup_attempts where attempt_id=:attempt',{attempt}))[0];assert.equal(started.STATE,'STARTED');assert.equal(started.COMPLETED_AT,null);assert.ok(started.CREATED_AT);checks.push({label:'STARTED has server creation time and unfinished shape',passed:true});
    await rejected('organism uniqueness blocks another attempt',insert,{...base,attempt:uuid()},[1]);
    await rejected('attempt identity is immutable',"update apxgen_app_cleanup_attempts set attempt_id=:changed,state='VERIFIED',completed_at=systimestamp where attempt_id=:attempt",{changed:uuid(),attempt},[20137]);
    for(const column of ['organism_id','run_id','application_id','genome_hash','artifact_hash','policy_hash','archive_hash','snapshot_hash','evidence_hash','authorization_hash'])await rejected(column+' is immutable',`update apxgen_app_cleanup_attempts set ${column}=:changed,state='VERIFIED',completed_at=systimestamp where attempt_id=:attempt`,{changed:column==='application_id'?otherApp:column.endsWith('_id')?uuid():sha('TEST_ONLY changed '+column+attempt),attempt},[20137]);
    await rejected('creation timestamp is immutable',"update apxgen_app_cleanup_attempts set created_at=systimestamp-interval '1' day,state='VERIFIED',completed_at=systimestamp where attempt_id=:attempt",{attempt},[20137]);
    await rejected('STARTED cannot be edited in place',"update apxgen_app_cleanup_attempts set state='STARTED' where attempt_id=:attempt",{attempt},[20137]);
    await rejected('finalization requires completion time',"update apxgen_app_cleanup_attempts set state='VERIFIED' where attempt_id=:attempt",{attempt},[20137]);
    await rejected('arbitrary final states denied',"update apxgen_app_cleanup_attempts set state='FAILED',completed_at=systimestamp where attempt_id=:attempt",{attempt},[20137]);
    await rejected('ledger deletion denied',"delete from apxgen_app_cleanup_attempts where attempt_id=:attempt",{attempt},[20137]);
    await db.execute('savepoint valid_started');await db.execute("update apxgen_app_cleanup_attempts set state='VERIFIED',completed_at=systimestamp where attempt_id=:attempt",{attempt});assert.equal((await rows('select state from apxgen_app_cleanup_attempts where attempt_id=:attempt',{attempt}))[0].STATE,'VERIFIED');checks.push({label:'STARTED to VERIFIED accepted',passed:true});
    await rejected('VERIFIED can be finalized only once',"update apxgen_app_cleanup_attempts set state='UNCERTAIN',completed_at=systimestamp,error_code='TEST_ONLY' where attempt_id=:attempt",{attempt},[20137]);await db.execute('rollback to valid_started');
    await rejected('UNCERTAIN requires an error code',"update apxgen_app_cleanup_attempts set state='UNCERTAIN',completed_at=systimestamp where attempt_id=:attempt",{attempt},[2290]);
    await rejected('UNCERTAIN rejects unsanitized error codes',"update apxgen_app_cleanup_attempts set state='UNCERTAIN',completed_at=systimestamp,error_code='unsafe detail' where attempt_id=:attempt",{attempt},[2290]);
    await db.execute("update apxgen_app_cleanup_attempts set state='UNCERTAIN',completed_at=systimestamp,error_code='TEST_ONLY' where attempt_id=:attempt",{attempt});checks.push({label:'STARTED to sanitized UNCERTAIN accepted',passed:true});
    await rejected('UNCERTAIN permanently blocks another attempt',insert,{...base,attempt:uuid()},[1]);await db.execute('rollback to cleanup_test_start');
    for(const [label,change,numbers]of [
      ['unknown organism',{organism:uuid()},[20137]],['incompatible run',{run:uuid()},[20137]],['incompatible application',{app:otherApp},[20137]],['protected control application',{app:134},[20137,2290]],['incompatible DNA',{genome:sha('TEST_ONLY incompatible DNA '+attempt)},[20137]],['incompatible artifact',{artifact:sha('TEST_ONLY incompatible artifact '+attempt)},[20137]],['malformed policy fingerprint',{policy:'BAD'},[2290]],['missing preservation proof',{archive:null},[1400]],['forbidden initial VERIFIED',{state:'VERIFIED'},[20137]],['forbidden initial completed STARTED',{completed:new Date()},[20137]],['forbidden initial error',{error:'TEST_ONLY'},[20137]]
    ])await rejected(label,insert,{...base,...change},numbers);
    const legacy=(await rows(`select o.organism_id,o.run_id,o.application_id,o.genome_hash,o.artifact_hash from apxgen_app_organisms o join apxgen_app_runs r on r.run_id=o.run_id where o.application_id in(${placeholders}) and o.state='REJECTED' and r.state in('COMPLETE','FAILED','CANCELLED') and o.artifact_hash is not null and not exists(select 1 from apxgen_app_cleanup_attempts a where a.organism_id=o.organism_id) and exists(select 1 from apxgen_app_events e where e.organism_id=o.organism_id and e.state in('CLEANUP_STARTED','DISPOSED','CLEANUP_UNCERTAIN')) order by o.organism_id`,pool))[0];
    if(legacy)await rejected('legacy cleanup history blocks a new attempt despite an empty organism ledger',insert,{...base,organism:legacy.ORGANISM_ID,run:legacy.RUN_ID,app:legacy.APPLICATION_ID,genome:legacy.GENOME_HASH,artifact:legacy.ARTIFACT_HASH},[20137]);
    else skippedChecks.push({label:'legacy cleanup history',reason:'No existing rejected terminal legacy organism without a ledger; no history is invented'});
    contextChanged=true;await db.execute('begin apex_application.g_flow_id:=:app_id;end;',{app_id:owner.APPLICATION_ID});
    try{await rejected('attached APEX context rejected despite direct owner',insert,base,[20137]);}finally{await db.execute('begin apex_application.g_flow_id:=null;apex_application.g_instance:=null;end;');contextChanged=false;}
    await db.rollback();await idle();assert.equal((await rows('select count(*) n from apxgen_app_cleanup_attempts where attempt_id=:attempt',{attempt}))[0].N,0);checks.push({label:'all temporary TEST_ONLY ledger rows rolled back',passed:true});
    const after=await snapshot(db,rows);assert.equal(after.sha256,before.sha256,'Ledger, application metadata, fixture, slot, history or control/DRAFT state changed');
    result={suite:'application-cleanup-ledger',passed:true,rolledBack:true,evidenceClass:'TEST_ONLY',checkCount:checks.length,checks,skippedChecks,applicationId:owner.APPLICATION_ID,organismId:owner.ORGANISM_ID,objects,beforeSha256:before.sha256,afterSha256:after.sha256,existingOwnerStateUnchanged:true,realTaskEvidence:false,imports:0,cleanupPerformed:false,paidRequests:0};
  }catch(failure){error=failure;}
  finally{
    if(contextChanged){try{await db.execute('begin apex_application.g_flow_id:=null;apex_application.g_instance:=null;end;');}catch{resources.push('CONTEXT_RESET_FAILED');}}
    try{await db.rollback();}catch{resources.push('ROLLBACK_FAILED');}
    try{await db.close();}catch{resources.push('CLOSE_FAILED');}
  }
  if(error){if(resources.length)error.resourceCleanupErrors=resources;throw error;}
  assert.deepEqual(resources,[],'Rollback-only test resource cleanup was incomplete; never treat the run as passing');return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await runCleanupLedgerSuite({configPath:process.env.APXGEN_APPLICATION_TEST_CONFIG})));}
  catch(error){console.error(JSON.stringify({suite:'application-cleanup-ledger',passed:false,code:error.code||error.name||'LEDGER_TEST_FAILED',errorNum:error.errorNum??null,resourceCleanupErrors:error.resourceCleanupErrors||[],realTaskEvidence:false}));process.exitCode=1;}
}
