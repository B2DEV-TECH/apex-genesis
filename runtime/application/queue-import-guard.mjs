import assert from 'node:assert/strict';
import oracledb from 'oracledb';

export function assertQueuedImportLease(observed,request){
 assert.ok(observed,'The explicit queued run has no worker claim');
 for(const key of ['runId','requestId','schema','workspaceId'])assert.equal(observed[key],request[key],'Queued import ownership differs');
 assert.equal(observed.state,'CLAIMED');assert.equal(observed.seed,50000);assert.equal(observed.generations,1);assert.equal(observed.materializationBudget,2);
 for(const key of ['enabled','workerEnabled','bindingMatches','leaseCoversImport','heartbeatCurrent'])assert.equal(observed[key],true,'Queued import claim is unavailable, stale or too short');
 return true;
}

// Read on the import guard connection without locking a queue row. Queue workers
// lock config/request before run rows; taking those locks here would invert that
// order. The current claim must cover the whole SQLcl timeout plus 30 seconds.
export async function verifyQueuedImportLease(db,{runId,requestId,policy,timeoutMs}){
 const exists=(await db.execute("select count(*) from user_tables where table_name='APXGEN_APP_CONTROL_REQUESTS'")).rows[0][0];
 if(exists===0){assert.equal(requestId,undefined,'Native queue infrastructure is missing');return null;}
 const rows=(await db.execute(`select r.request_id,r.run_id,r.state,r.seed,r.generations,r.materialization_budget,
  c.schema_name,c.workspace_id,c.enabled,c.worker_enabled,
  case when r.claim_binding=c.worker_binding then 1 else 0 end binding_matches,
  case when r.lease_until>systimestamp+numtodsinterval(:required_seconds,'SECOND') then 1 else 0 end lease_covers_import,
  case when c.worker_seen_at>systimestamp-interval '60' second and c.worker_seen_at<=systimestamp then 1 else 0 end heartbeat_current
  from apxgen_app_control_requests r cross join apxgen_app_control_config c where r.run_id=:run and c.config_id=1`,{run:runId,required_seconds:Math.ceil(timeoutMs/1000)+30},{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
 if(rows.length===0){assert.equal(requestId,undefined,'The native request is not attached to this run');return null;}
 assert.equal(rows.length,1,'Exactly one native worker claim is required');assert.match(requestId??'',/^[a-f0-9]{32}$/,'A queued run cannot use legacy import admission');
 const row=rows[0],observed={requestId:row.REQUEST_ID,runId:row.RUN_ID,state:row.STATE,seed:row.SEED,generations:row.GENERATIONS,materializationBudget:row.MATERIALIZATION_BUDGET,schema:row.SCHEMA_NAME,workspaceId:row.WORKSPACE_ID,enabled:row.ENABLED===1,workerEnabled:row.WORKER_ENABLED===1,bindingMatches:row.BINDING_MATCHES===1,leaseCoversImport:row.LEASE_COVERS_IMPORT===1,heartbeatCurrent:row.HEARTBEAT_CURRENT===1};
 assertQueuedImportLease(observed,{runId,requestId,schema:policy.schema,workspaceId:policy.workspaceId});return observed;
}
