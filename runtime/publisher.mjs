// Live dataset publisher. Builds read-only JSON documents from COMPLETE
// generations only, validates and sanitizes them, uploads content-addressed
// immutable objects, verifies every object by public SHA-256 and moves the
// single mutable pointer (latest.json) last. A failed pointer is rolled back
// to the last-known-good pointer, so visitors never see a partial dataset.
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rename,copyFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import os from 'node:os';
import {oracledb,rows} from '../scripts/db.mjs';
import {validateGenome} from '../showcase/renderer/genome.mjs';
import {ROOT,VERSION,stateDir,writeJsonAtomic,readJson} from './lib.mjs';

export const KEY_ALLOWLIST=/^genesis\/live\/v1\/(latest\.json|catalog\/[0-9]{6}-[a-f0-9]{12}\.json|runs\/[a-f0-9]{32}\/(progress-g[0-9]{4}|final)-[a-f0-9]{12}\.json)$/;
const RUN_SCHEMA='genesis-live-run-1',CATALOG_SCHEMA='genesis-live-catalog-1',POINTER_SCHEMA='genesis-live-pointer-1';
export const sha256=text=>createHash('sha256').update(text).digest('hex');
const iso=v=>v==null?null:new Date(v).toISOString();
const num=v=>v==null?null:Number(v);

// ---------------------------------------------------------------------------
// Sanitization: public documents must never carry machine or credential detail.
// ---------------------------------------------------------------------------
const FORBIDDEN=[/[A-Za-z]:[\\/](Users|app|Program)/i,/\\\\[a-z0-9_.-]+\\/i,/password/i,/secret/i,/claim_token|lease_token/i,/connectString/i,/BEGIN [A-Z ]*PRIVATE KEY/];
export function sanitizeText(text){
 return String(text??'').replace(/[A-Za-z]:[\\/][^\s'"]*/g,'[local path]').replace(/ORA-\d{5}:[^\n]*/g,m=>m.slice(0,9)+' [database error]').slice(0,600);
}
export function assertPublishable(text){
 const user=os.userInfo().username,host=os.hostname();
 for(const pattern of FORBIDDEN)if(pattern.test(text))throw new Error('Publication blocked: document contains a forbidden pattern '+pattern);
 for(const word of [user,host])if(word&&word.length>=4&&text.toLowerCase().includes(word.toLowerCase()))throw new Error('Publication blocked: document contains local machine identity');
}

// ---------------------------------------------------------------------------
// Document builders (pure Oracle reads; no writes).
// ---------------------------------------------------------------------------
async function runRows(db,where='',binds={}){
 return rows(db,`select a.sequence_no,a.run_id,a.policy,a.seed,a.source_run,a.source_generation,a.recovery_of,a.initial_population_hash,a.fitness_version,a.ga_version,
  a.protocol_version,a.environment_hash,a.environment,a.outcome,a.paused_by,a.stop_reason,a.stagnation,a.stagnation_generation,a.published_generation,a.published_final,
  a.published_at,a.created_at a_created,a.ended_at a_ended,r.label,r.population_mode,r.state,r.population_size,r.target_generations,r.current_generation,r.engine_version,
  r.mutation_rate,r.crossover_rate,r.elite_count,r.tournament_size,r.diversity_threshold,r.stagnation_limit,r.generation_timeout,r.total_timeout,r.fitness_weights,
  r.created_at,r.started_at,r.ended_at,r.failure,
  (select nvl(max(generation),-1) from apxgen_generations g where g.run_id=a.run_id and g.state='COMPLETE') complete_through,
  (select count(*) from apxgen_invocations i where i.run_id=a.run_id) invocations,
  (select max(best_so_far) from apxgen_generations g where g.run_id=a.run_id and g.state='COMPLETE') best_so_far
  from apxgen_autonomy_runs a join apxgen_runs r on r.run_id=a.run_id ${where} order by a.sequence_no`,binds);
}

function runMeta(r){
 return {id:r.RUN_ID,sequence:num(r.SEQUENCE_NO),label:r.LABEL,policy:r.POLICY,mode:r.POPULATION_MODE,dataLabel:r.POPULATION_MODE,aiAssisted:false,
  modelRequests:num(r.INVOCATIONS),seed:num(r.SEED),populationSize:num(r.POPULATION_SIZE),targetGenerations:num(r.TARGET_GENERATIONS),
  engineVersion:r.ENGINE_VERSION,fitnessVersion:r.FITNESS_VERSION,gaVersion:r.GA_VERSION,protocolVersion:r.PROTOCOL_VERSION,
  environmentHash:r.ENVIRONMENT_HASH,environment:JSON.parse(r.ENVIRONMENT),initialPopulationHash:r.INITIAL_POPULATION_HASH,
  provenance:{sourceRun:r.SOURCE_RUN,sourceGeneration:num(r.SOURCE_GENERATION),recoveryOfSequence:num(r.RECOVERY_OF)},
  parameters:{mutationRate:num(r.MUTATION_RATE),crossoverRate:num(r.CROSSOVER_RATE),eliteCount:num(r.ELITE_COUNT),tournamentSize:num(r.TOURNAMENT_SIZE),
   diversityThreshold:num(r.DIVERSITY_THRESHOLD),stagnationLimit:num(r.STAGNATION_LIMIT),generationTimeout:num(r.GENERATION_TIMEOUT),totalTimeout:num(r.TOTAL_TIMEOUT),
   fitnessWeights:JSON.parse(r.FITNESS_WEIGHTS)},
  state:r.STATE,outcome:r.OUTCOME,pausedBy:r.PAUSED_BY,stopReason:r.STOP_REASON,failure:r.FAILURE?sanitizeText(r.FAILURE):null,
  createdAt:iso(r.CREATED_AT),startedAt:iso(r.STARTED_AT),endedAt:iso(r.ENDED_AT||r.A_ENDED),completeThrough:num(r.COMPLETE_THROUGH),bestSoFar:num(r.BEST_SO_FAR),
  stagnation:r.STAGNATION?JSON.parse(r.STAGNATION):null,stagnationGeneration:num(r.STAGNATION_GENERATION)};
}

async function generationSeries(db,run){
 const list=await rows(db,`select g.generation,g.best_fitness,g.mean_fitness,g.median_fitness,g.variance_fitness,g.best_so_far,g.diversity,g.valid_count,g.failed_count,
   g.mutation_count,g.mutation_accepted,g.started_at,g.completed_at,b.organism_id,b.fingerprint,b.method,b.fitness,b.accessibility,b.hierarchy,b.responsiveness,
   b.performance_proxy,b.contrast_ratio,gm.canonical_json
  from apxgen_generations g
  outer apply (select o.organism_id,o.fingerprint,o.method,e.fitness,e.accessibility,e.hierarchy,e.responsiveness,e.performance_proxy,e.contrast_ratio
    from apxgen_organisms o join apxgen_evaluations e on e.organism_id=o.organism_id
    where o.run_id=g.run_id and o.generation=g.generation and e.eligible=1 order by e.fitness desc,o.ordinal fetch first 1 row only) b
  left join apxgen_genomes gm on gm.fingerprint=b.fingerprint
  where g.run_id=:run and g.state='COMPLETE' order by g.generation`,{run});
 return list.map(g=>({generation:num(g.GENERATION),bestFitness:num(g.BEST_FITNESS),meanFitness:num(g.MEAN_FITNESS),medianFitness:num(g.MEDIAN_FITNESS),
  varianceFitness:num(g.VARIANCE_FITNESS),bestSoFar:num(g.BEST_SO_FAR),diversity:num(g.DIVERSITY),validCount:num(g.VALID_COUNT),failedCount:num(g.FAILED_COUNT),
  mutationCount:num(g.MUTATION_COUNT),mutationAccepted:num(g.MUTATION_ACCEPTED),startedAt:iso(g.STARTED_AT),completedAt:iso(g.COMPLETED_AT),
  best:g.ORGANISM_ID==null?null:{id:num(g.ORGANISM_ID),fingerprint:g.FINGERPRINT,method:g.METHOD,fitness:num(g.FITNESS),genome:JSON.parse(g.CANONICAL_JSON),
   objectives:{accessibility:num(g.ACCESSIBILITY),hierarchy:num(g.HIERARCHY),responsiveness:num(g.RESPONSIVENESS),performanceProxy:num(g.PERFORMANCE_PROXY),contrastRatio:num(g.CONTRAST_RATIO)}}}));
}

async function population(db,run,generation){
 const r=await db.execute('select apxgen_export.generation_json(:run,:g) doc from dual',{run,g:generation});
 return JSON.parse(r.rows[0].DOC).organisms;
}

// Ancestry of the run's best organism through PRIMARY parents. Consecutive
// identical phenotypes (elite copies) collapse into one entry with a span.
async function lineage(db,run){
 const best=await rows(db,`select o.organism_id from apxgen_organisms o join apxgen_evaluations e on e.organism_id=o.organism_id
  where o.run_id=:run and e.eligible=1 and o.evaluation_state='COMPLETE' order by e.fitness desc,o.generation,o.ordinal fetch first 1 row only`,{run});
 if(!best.length)return [];
 const chain=await rows(db,`with chain(id,depth) as (select :id,0 from dual union all
   select p.parent_id,c.depth+1 from chain c join apxgen_parents p on p.child_id=c.id and p.parent_role='PRIMARY' where c.depth<600)
  select c.depth,o.organism_id,o.run_id,o.generation,o.method,o.fingerprint,e.fitness,g.canonical_json from chain c
  join apxgen_organisms o on o.organism_id=c.id left join apxgen_evaluations e on e.organism_id=o.organism_id join apxgen_genomes g on g.fingerprint=o.fingerprint
  order by c.depth`,{id:best[0].ORGANISM_ID});
 const out=[];
 for(const x of chain){
  const last=out[out.length-1];
  if(last&&last.fingerprint===x.FINGERPRINT){last.firstSeen={runId:x.RUN_ID,generation:num(x.GENERATION),id:num(x.ORGANISM_ID),method:x.METHOD};continue;}
  out.push({id:num(x.ORGANISM_ID),runId:x.RUN_ID,generation:num(x.GENERATION),method:x.METHOD,fitness:num(x.FITNESS),fingerprint:x.FINGERPRINT,genome:JSON.parse(x.CANONICAL_JSON),
   firstSeen:{runId:x.RUN_ID,generation:num(x.GENERATION),id:num(x.ORGANISM_ID),method:x.METHOD}});
 }
 return out;
}

async function events(db,run,limit=40){
 const list=await rows(db,`select generation,event_type,details,occurred_at from apxgen_events where run_id=:run order by event_id desc fetch first ${Math.min(200,Math.max(1,limit))} rows only`,{run});
 return list.map(e=>({generation:num(e.GENERATION),type:e.EVENT_TYPE,detail:sanitizeText(e.DETAILS),at:iso(e.OCCURRED_AT)}));
}

export async function buildRunDocument(db,runRow,kind){
 const meta=runMeta(runRow);
 if(meta.completeThrough<0)throw new Error('Run has no completed generation');
 const generations=await generationSeries(db,meta.id);
 const doc={schema:RUN_SCHEMA,kind,run:meta,generations,latestPopulation:{generation:meta.completeThrough,organisms:await population(db,meta.id,meta.completeThrough)},
  lineage:await lineage(db,meta.id),events:await events(db,meta.id),
  disclosure:'Recorded by the APEX Genesis supervisor from completed Oracle generations only. GA_ONLY data: zero model requests. Fitness is a declared technical proxy measured in a headless browser; it is not a usability or aesthetic judgement.'};
 if(kind==='final'){
  doc.populations=[];
  for(const g of generations)doc.populations.push({generation:g.generation,organisms:await population(db,meta.id,g.generation)});
 }
 return doc;
}

// Structural validation of a run document before it may leave the machine.
export function validateRunDocument(doc){
 const problems=[];const r=doc.run;
 if(doc.schema!==RUN_SCHEMA)problems.push('schema');
 if(!['progress','final'].includes(doc.kind))problems.push('kind');
 if(!/^[a-f0-9]{32}$/.test(r.id))problems.push('run id');
 if(!['GA_ONLY','RANDOM_SEARCH'].includes(r.mode))problems.push('mode is not an offline mode');
 if(r.aiAssisted!==false||r.modelRequests!==0)problems.push('model requests recorded for an autonomous run');
 if(!/^[a-f0-9]{64}$/.test(r.environmentHash||''))problems.push('environment hash');
 if(doc.kind==='final'&&r.outcome==='ACTIVE')problems.push('final document for an active run');
 if(doc.kind==='progress'&&r.outcome!=='ACTIVE')problems.push('progress document for a finished run');
 const g=doc.generations;
 if(!g.length||g[0].generation!==0)problems.push('generation 0 missing');
 g.forEach((x,i)=>{if(x.generation!==i)problems.push('generation gap at '+i);
  for(const k of ['bestFitness','meanFitness','bestSoFar','diversity'])if(x[k]!=null&&!Number.isFinite(x[k]))problems.push('non-finite '+k+' at '+i);
  if(x.best&&!validateGenome(x.best.genome).valid)problems.push('invalid best genome at '+i);
  if(i>0&&x.bestSoFar!=null&&g[i-1].bestSoFar!=null&&x.bestSoFar+1e-9<g[i-1].bestSoFar)problems.push('best-so-far decreased at '+i);});
 if(g.length&&g[g.length-1].generation!==r.completeThrough)problems.push('series does not end at the completed checkpoint');
 if(doc.latestPopulation.generation!==r.completeThrough)problems.push('population is not the completed checkpoint');
 for(const o of doc.latestPopulation.organisms)if(!validateGenome(o.genome).valid)problems.push('invalid population genome '+o.id);
 for(const l of doc.lineage)if(!validateGenome(l.genome).valid)problems.push('invalid lineage genome '+l.id);
 if(doc.kind==='final'&&doc.populations.length!==g.length)problems.push('final populations incomplete');
 if(problems.length)throw new Error('Run document rejected: '+problems.slice(0,6).join('; '));
 return true;
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------
function spawnText(command,args,{cwd,timeoutMs=120000}={}){
 return new Promise((resolveRun,reject)=>{
  const child=spawn(command,args,{cwd,windowsHide:true,shell:false,env:{...process.env,WRANGLER_SEND_METRICS:'false',NO_COLOR:'1'}});
  let out='';child.stdout.on('data',d=>{out+=d;if(out.length>20000)out=out.slice(-20000);});child.stderr.on('data',d=>{out+=d;if(out.length>20000)out=out.slice(-20000);});
  const timer=setTimeout(()=>{child.kill();reject(new Error('Upload timed out'));},timeoutMs);
  child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',code=>{clearTimeout(timer);code===0?resolveRun(out):reject(new Error('Upload exited '+code+': '+sanitizeText(out.split('\n').filter(l=>/error|✘|failed/i.test(l)).join(' ').slice(0,300))));});
 });
}

export function r2Target(cfg){
 const p=cfg.publication;const wrangler=resolve(ROOT,p.wrangler),cwd=resolve(ROOT,p.wranglerCwd);
 return {name:'R2',
  async put(key,file){await spawnText(process.execPath,[wrangler,'r2','object','put',p.bucket+'/'+key,'--file',file,'--content-type','application/json','--remote'],{cwd});},
  async get(key){
   const response=await fetch(p.publicBase+key+'?v='+Date.now(),{cache:'no-store',headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw new Error('Public read returned HTTP '+response.status);
   return Buffer.from(await response.arrayBuffer()).toString('utf8');
  }};
}
export function directoryTarget(dir){
 return {name:'DIRECTORY',
  async put(key,file){const dest=join(dir,key);await mkdir(dirname(dest),{recursive:true});const tmp=dest+'.'+process.pid+'.tmp';await copyFile(file,tmp);await rename(tmp,dest);},
  async get(key){return readFile(join(dir,key),'utf8');}};
}
export function resolveTarget(cfg,label){
 // Verification data (TEST labels) can never reach the public bucket.
 if(cfg.publication.target==='DIRECTORY'||/^TEST/i.test(label||''))return directoryTarget(resolve(ROOT,cfg.publication.directory||join(stateDir(),'published')));
 return r2Target(cfg);
}

// ---------------------------------------------------------------------------
// Publisher
// ---------------------------------------------------------------------------
export function createPublisher({db,token,cfg,log,faults={}}){
 const p=cfg.publication;const prefix=p.prefix;
 const statePath=join(stateDir(),'publications','state.json');
 let state=null;

 async function loadState(){state=state||await readJson(statePath,{failures:0,nextAttemptAt:null,lastPointer:null,lastPointerText:null,lastPublishAt:null,catalogRevision:0,lastSystemState:null});return state;}
 const saveState=()=>writeJsonAtomic(statePath,state);

 async function bookkeeping(sql,binds){await db.execute(sql,binds);await db.commit();}
 async function begin(run,kind,generation,target,key,sha,bytes){
  const r=await db.execute('begin :id:=apxgen_autonomy.publication_begin(:t,:run,:kind,:g,:target,:k,:sha,:b);end;',
   {id:{dir:oracledb.BIND_OUT,type:oracledb.NUMBER},t:token(),run,kind,g:generation,target,k:key,sha,b:bytes});await db.commit();return r.outBinds.id;
 }
 const end=(id,st,error=null)=>bookkeeping('begin apxgen_autonomy.publication_end(:t,:id,:s,:e);end;',{t:token(),id,s:st,e:error?sanitizeText(error):null});

 // Stage locally, upload, then read back through the public path and compare SHA-256.
 async function putVerified(target,key,text){
  if(!KEY_ALLOWLIST.test(key))throw new Error('Destination key outside the allowlist');
  if(Buffer.byteLength(text)>p.maxDocumentBytes)throw new Error('Document exceeds the publication size limit');
  assertPublishable(text);
  const file=join(stateDir(),'publications','staged',key.replace(/[\\/]/g,'__'));
  await mkdir(dirname(file),{recursive:true});await writeFile(file,text);
  if(faults.failUpload?.test(key))throw new Error('Injected upload failure (test harness)');
  await target.put(key,file);
  let observed=await target.get(key);
  if(faults.corruptVerify?.test(key))observed+=' ';
  if(sha256(observed)!==sha256(text))throw new Error('Verification hash mismatch for '+key.slice(prefix.length));
 }

 // After a lost local state, adopt the pointer that is actually live as last-known-good.
 async function recoverLastGood(target){
  if(state.lastPointerText)return;
  try{const text=await target.get(prefix+'latest.json');const pointer=JSON.parse(text);
   if(pointer.schema===POINTER_SCHEMA){state.lastPointer=pointer;state.lastPointerText=text;state.lastCatalogText=await target.get(prefix+pointer.catalog.key);
    if(sha256(state.lastCatalogText)!==pointer.catalog.sha256)state.lastCatalogText=null;}}catch{/* nothing published yet */}
 }

 async function systemState(){
  const s=(await rows(db,`select s.state,s.heartbeat,s.detail,c.enabled,c.desired_state from apxgen_supervisor s cross join apxgen_autonomy_config c`))[0];
  const active=(await rows(db,`select r.state from apxgen_autonomy_runs a join apxgen_runs r on r.run_id=a.run_id where a.outcome='ACTIVE' fetch first 1 row only`))[0];
  let label;
  if(!Number(s.ENABLED))label='STOPPED';
  else if(s.DESIRED_STATE==='PAUSED'||(active&&/PAUSE/.test(active.STATE)))label='PAUSED';
  else if(active&&(s.STATE==='BACKOFF'||/^Throttled/.test(s.DETAIL||'')))label='AWAITING_EVALUATION';
  else if(active)label='RUNNING';
  else label='AWAITING_NEXT_RUN';
  return {state:label,supervisor:s.STATE,heartbeatAt:iso(s.HEARTBEAT)};
 }

 // Decide what (if anything) is due; returns a plan without side effects.
 async function plan({force=false}={}){
  const config=(await rows(db,'select publish_enabled,publish_every_generations,publish_min_interval_seconds,label_prefix from apxgen_autonomy_config'))[0];
  const all=await runRows(db);
  const st=await loadState();const now=Date.now();
  const sinceLast=st.lastPublishAt?(now-Date.parse(st.lastPublishAt))/1000:Infinity;
  const due=[];
  for(const r of all){
   const complete=num(r.COMPLETE_THROUGH);if(complete<0)continue;
   if(r.OUTCOME!=='ACTIVE'){if(!Number(r.PUBLISHED_FINAL))due.push({row:r,kind:'final'});continue;}
   const fresh=complete-num(r.PUBLISHED_GENERATION);
   if(fresh>0&&(force||(fresh>=Number(config.PUBLISH_EVERY_GENERATIONS)&&sinceLast>=Number(config.PUBLISH_MIN_INTERVAL_SECONDS))||num(r.PUBLISHED_GENERATION)<0))due.push({row:r,kind:'progress'});
  }
  const system=await systemState();
  const heartbeatDue=!st.lastPointer||(now-Date.parse(st.lastPointer.publishedAt))/60000>=p.pointerHeartbeatMinutes||st.lastSystemState!==system.state;
  return {enabled:Number(config.PUBLISH_ENABLED)===1,labelPrefix:config.LABEL_PREFIX,due,system,heartbeatDue,all};
 }

 async function check({force=false}={}){
  await loadState();
  if(!force&&state.nextAttemptAt&&Date.now()<Date.parse(state.nextAttemptAt))return {skipped:'backoff until '+state.nextAttemptAt};
  const pl=await plan({force});
  if(!pl.enabled)return {skipped:'publication disabled in configuration'};
  if(!pl.due.length&&!pl.heartbeatDue&&!force)return {skipped:'nothing due'};
  const target=resolveTarget(cfg,pl.labelPrefix);
  await recoverLastGood(target);
  const published=[];const pending=[];
  try{
   // 1. Immutable run documents.
   for(const item of pl.due){
    const doc=await buildRunDocument(db,item.row,item.kind);validateRunDocument(doc);
    const text=JSON.stringify(doc);const sha=sha256(text);const g=doc.run.completeThrough;
    const key=prefix+'runs/'+doc.run.id+'/'+(item.kind==='final'?'final':'progress-g'+String(g).padStart(4,'0'))+'-'+sha.slice(0,12)+'.json';
    const id=await begin(doc.run.id,item.kind==='final'?'FINAL':'SNAPSHOT',g,target.name,key,sha,Buffer.byteLength(text));
    try{await putVerified(target,key,text);await end(id,'VERIFIED');}catch(error){await end(id,'FAILED',error.message);throw error;}
    pending.push({id,runId:doc.run.id,generation:g,final:item.kind==='final'?1:0,key,sha});
   }
   // 2. Catalog: one entry per autonomous run, pointing at its newest verified
   //    document. Oracle bookkeeping (not local state) is the source of truth.
   const live=await rows(db,`select run_id,object_key,sha256,kind,generation from (select p.*,row_number() over(partition by run_id order by publication_id desc) rn
     from apxgen_publications p where kind in('SNAPSHOT','FINAL') and state='LIVE' and target=:target) where rn=1`,{target:target.name});
   const latestDoc=new Map(live.map(x=>[x.RUN_ID,{key:x.OBJECT_KEY,sha:x.SHA256,generation:num(x.GENERATION),final:x.KIND==='FINAL'}]));
   for(const x of pending)latestDoc.set(x.runId,{key:x.key,sha:x.sha,generation:x.generation,final:!!x.final});
   const entries=[];
   for(const row of pl.all){const d=latestDoc.get(row.RUN_ID);if(!d)continue;const m=runMeta(row);
    entries.push({runId:m.id,sequence:m.sequence,label:m.label,policy:m.policy,mode:m.mode,aiAssisted:false,seed:m.seed,outcome:d.final?m.outcome:'ACTIVE',
     state:d.final?m.state:'RUNNING',completeThrough:d.generation,targetGenerations:m.targetGenerations,bestSoFar:m.bestSoFar,startedAt:m.startedAt,endedAt:d.final?m.endedAt:null,
     final:d.final,key:d.key.slice(prefix.length),sha256:d.sha,fitnessVersion:m.fitnessVersion,environmentHash:m.environmentHash,
     provenance:m.provenance});}
   let catalogKey=state.lastPointer?.catalog?prefix+state.lastPointer.catalog.key:null,catalogSha=state.lastPointer?.catalog?.sha256,catalogText=state.lastCatalogText;
   if(pending.length||!catalogKey||!catalogText){
    const revision=Number((await rows(db,`select count(*) n from apxgen_publications where kind='CATALOG' and state='LIVE' and target=:target`,{target:target.name}))[0].N)+1;
    const catalog={schema:CATALOG_SCHEMA,revision,generatedAt:new Date().toISOString(),
     comparability:'Scores are comparable only between runs with the same fitnessVersion and environmentHash. Archived cohorts use their own recorded definitions.',
     runs:entries,
     archives:[{id:'pilot',title:'Offline pilot (engine 1.0.0)',href:'index.html?dataset=./datasets/pilot/manifest.json',immutable:true},{id:'haiku-paired',title:'Darwin versus Haiku cohort (engine 1.1.0)',href:'index.html',immutable:true}]};
    catalogText=JSON.stringify(catalog);catalogSha=sha256(catalogText);
    catalogKey=prefix+'catalog/'+String(revision).padStart(6,'0')+'-'+catalogSha.slice(0,12)+'.json';
    const id=await begin(null,'CATALOG',null,target.name,catalogKey,catalogSha,Buffer.byteLength(catalogText));
    try{await putVerified(target,catalogKey,catalogText);await end(id,'VERIFIED');}catch(error){await end(id,'FAILED',error.message);throw error;}
    pending.push({id,catalog:true});
   }
   const byRun=new Map(entries.map(e=>[e.runId,e]));
   // 3. Pointer last.
   const active=[...byRun.values()].filter(r=>r.outcome==='ACTIVE').at(-1)||null;
   const pointer={schema:POINTER_SCHEMA,publishedAt:new Date().toISOString(),publisherVersion:VERSION,
    catalog:{key:catalogKey.slice(prefix.length),sha256:catalogSha},
    active:active?{runId:active.runId,key:active.key,sha256:active.sha256,completeThrough:active.completeThrough}:null,
    system:pl.system,previousSha256:state.lastPointer?sha256(state.lastPointerText):null,
    note:'Pointer to immutable, hash-verified Genesis datasets. The experiment runs on a private workstation; this page is a recorded replay of completed generations.'};
   const pointerText=JSON.stringify(pointer);const pointerSha=sha256(pointerText);const pointerKey=prefix+'latest.json';
   const pid=await begin(active?.runId||null,'POINTER',active?.completeThrough??null,target.name,pointerKey,pointerSha,Buffer.byteLength(pointerText));
   try{await putVerified(target,pointerKey,pointerText);}
   catch(error){
    await end(pid,'FAILED',error.message);
    // Roll back to the last-known-good pointer so the public dataset stays consistent.
    if(state.lastPointerText){
     try{await putVerified(target,pointerKey,state.lastPointerText);await log.warn('Pointer rolled back to last-known-good',{sha256:sha256(state.lastPointerText)});
      const rid=await begin(null,'POINTER',null,target.name,pointerKey,sha256(state.lastPointerText),Buffer.byteLength(state.lastPointerText));await end(rid,'ROLLED_BACK','Restored last-known-good after: '+error.message);}
     catch(rollbackError){await log.error('Pointer rollback failed',{error:sanitizeText(rollbackError.message)});}
    }
    throw error;
   }
   // 4. Commit bookkeeping only after the pointer is live.
   for(const x of pending)await end(x.id,'LIVE');
   await end(pid,'LIVE');
   for(const x of pending)if(x.runId)await bookkeeping('begin apxgen_autonomy.mark_published(:t,:run,:g,:f);end;',{t:token(),run:x.runId,g:x.generation,f:x.final});
   Object.assign(state,{failures:0,nextAttemptAt:null,lastPointer:pointer,lastPointerText:pointerText,lastCatalogText:catalogText,lastSystemState:pl.system.state,
    lastPublishAt:pending.some(x=>x.runId)?new Date().toISOString():state.lastPublishAt,lastTarget:target.name});
   await saveState();
   await writeJsonAtomic(join(stateDir(),'publications','last-known-good.json'),pointer);
   published.push(...pending.filter(x=>x.runId).map(x=>({runId:x.runId,generation:x.generation,final:!!x.final,key:x.key})));
   await log.info('Publication live',{target:target.name,objects:pending.length+1,pointer:pointerSha.slice(0,12),runs:published.length});
   return {published,pointer:pointerSha,target:target.name};
  }catch(error){
   state.failures=(state.failures||0)+1;
   const minutes=Math.min(p.maxBackoffMinutes,5*2**(state.failures-1));
   state.nextAttemptAt=new Date(Date.now()+minutes*60000).toISOString();await saveState();
   await log.warn('Publication failed; previous dataset remains live',{error:sanitizeText(error.message),retryInMinutes:minutes,failures:state.failures});
   return {failed:sanitizeText(error.message),retryAt:state.nextAttemptAt};
  }
 }
 return {check,plan,loadState};
}
