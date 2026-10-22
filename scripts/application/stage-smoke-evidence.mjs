// Read-only conversion of one real smoke run into the independent public
// evidence contract. Private logs, identities and browser sessions never copy.
import {readFile,writeFile,mkdir,lstat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,dirname,sep,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {canonicalApplicationGenome} from '../../evolution/application/genome.mjs';
import {validateSandboxPolicy,assertSandboxIdentity} from '../../runtime/application/sandbox.mjs';
import {acceptsCompilerResult} from './validate-definition.mjs';
import {LIVING_VERSIONS,LIVING_TASKS,loadLivingEvidence,safeLivingPath,parseLivingJson} from '../../showcase/living-evidence.mjs';
import {buildPublicEvidence} from './package-evidence.mjs';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const sha=/^[a-f0-9]{64}$/,identifier=/^[a-f0-9]{32}$/;
const digest=value=>createHash('sha256').update(value).digest('hex');
const check=(ok,message)=>{if(!ok)throw new TypeError(message);};
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const jsonBytes=object=>Buffer.from(JSON.stringify(object));
const parse=bytes=>parseLivingJson(bytes.toString('utf8').replace(/^\uFEFF/,''));
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value));
const defaultProtocolPath='experiments/configurations/application-feasibility-v1.json';
const queuedProtocolPath='experiments/configurations/application-queued-feasibility-v1.json';
const evaluatorPaths=new Set(['scripts/application/run-smoke.mjs','runtime/application/tasks.mjs','database/packages/apxgen_app_fitness.sql',defaultProtocolPath,'database/packages/genesis_order_lab.sql','database/migrations/007_order_lab_fixture.sql',queuedProtocolPath,'runtime/application/resources.mjs','runtime/application/queue-import-guard.mjs','runtime/application/control-worker.mjs','scripts/application/run-control-once.mjs']);
const requiredEvaluatorPaths=[...evaluatorPaths].slice(0,3);

/** Digests bind recorded identities, never a fresh checkout relabelled as history. */
export function deriveSmokeHashes(run){
 check(Array.isArray(run?.sourceHashes)&&run.sourceHashes.length>=4&&run.sourceHashes.length<=512,'Recorded source hashes are required');
 const seen=new Set(),sources=run.sourceHashes.map(source=>{check(source&&Object.keys(source).length===2,'Invalid recorded source identity');safeLivingPath(source.path);check(!seen.has(source.path.toLowerCase()),'Duplicate recorded source path');seen.add(source.path.toLowerCase());check(sha.test(source.sha256),'Invalid recorded source hash');return {path:source.path,sha256:source.sha256};}).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 check(sha.test(run.protocolHash)&&typeof run.browserVersion==='string'&&/^\d+(?:\.\d+){2,3}$/.test(run.browserVersion),'Recorded evaluator protocol and browser identity are required');
 const protocolPath=run.protocolSourcePath??defaultProtocolPath;check([defaultProtocolPath,queuedProtocolPath].includes(protocolPath),'Unsupported recorded evaluator protocol source');
 for(const path of [...requiredEvaluatorPaths,protocolPath])check(sources.some(source=>source.path===path),'Missing recorded evaluator source');
 check(sources.find(source=>source.path===protocolPath).sha256===run.protocolHash,'Recorded protocol hash contradicts source identity');
 return {sourceHash:digest(JSON.stringify(sources)),evaluatorHash:digest(JSON.stringify({sources:sources.filter(source=>evaluatorPaths.has(source.path)),protocolHash:run.protocolHash,browserVersion:run.browserVersion}))};
}

function normalizedEvents(events){return events.map(row=>({EVENT_ID:row.EVENT_ID,STATE:row.STATE,DETAIL:row.DETAIL??null,RECORDED_AT:row.RECORDED_AT}));}
function normalizedAttempts(rows){return rows.map(row=>({ATTEMPT_ID:row.ATTEMPT_ID,STATE:row.STATE,ERROR_CODE:row.ERROR_CODE??null,CREATED_AT:row.CREATED_AT,COMPLETED_AT:row.COMPLETED_AT??null}));}
function decision(row){return {STATE:row.state,ELIGIBLE:row.eligible,FITNESS:row.fitness,SELECTED:row.selected,REASON:row.reason};}

/** Pure reconciliation is separately testable; only stageSmokeEvidence reads DB. */
export function assertSmokeReconciliation(run,snapshot){
 check(identifier.test(run?.runId)&&snapshot?.run?.runId===run.runId&&snapshot.run.fitnessDefinition===LIVING_VERSIONS.fitnessDefinition,'Oracle run identity or fitness definition differs');
 check(Array.isArray(run.candidates)&&run.candidates.length>0&&run.candidates.length<=256&&Array.isArray(snapshot.organisms)&&snapshot.organisms.length===run.candidates.length,'Oracle candidate history is missing or incomplete');
 const seen=new Set();
 for(const candidate of run.candidates){
  check(identifier.test(candidate.organismId)&&!seen.has(candidate.organismId),'Invalid or duplicate candidate identity');seen.add(candidate.organismId);
  const row=snapshot.organisms.find(value=>value.id===candidate.organismId);check(row&&row.runId===run.runId,'Oracle candidate is missing');
  const genome=canonicalApplicationGenome(candidate.genome);check(sha.test(candidate.genomeHash)&&digest(genome)===candidate.genomeHash&&row.genomeHash===candidate.genomeHash&&canonicalApplicationGenome(parseLivingJson(row.genomeJson))===genome,'Oracle canonical genome identity differs');
  check(Number.isSafeInteger(candidate.generation)&&candidate.generation>=0&&row.generation===candidate.generation&&row.parentId===(candidate.parentId??null),'Oracle candidate lineage differs');
  check(row.artifactHash===(candidate.definitionHash??null),'Oracle candidate definition identity differs');
  // A locally planned slot does not prove that an import was attempted.
  check(row.applicationId===null||row.applicationId===candidate.applicationId,'Oracle application identity differs');
  if(candidate.oracleDecision)check(isDeepStrictEqual(candidate.oracleDecision,decision(row)),'Cached Oracle decision differs from authoritative records');
  if(candidate.metrics!==undefined)check(row.metricsJson!==null&&isDeepStrictEqual(candidate.metrics,parseLivingJson(row.metricsJson)),'Cached Oracle metrics differ');
  const events=snapshot.events[row.id]||[],attempts=snapshot.attempts[row.id]||[];
  check(events.every((event,index)=>Number.isSafeInteger(event.EVENT_ID)&&timestamp(event.RECORDED_AT)&&(!index||(event.EVENT_ID>events[index-1].EVENT_ID&&Date.parse(event.RECORDED_AT)>=Date.parse(events[index-1].RECORDED_AT)))),'Oracle phase chronology is invalid');
  if(candidate.oracleEvents)check(isDeepStrictEqual(normalizedEvents(candidate.oracleEvents),normalizedEvents(events)),'Cached Oracle phase history differs');
  if(candidate.importAttempt)check(isDeepStrictEqual(normalizedAttempts(candidate.importAttempt),normalizedAttempts(attempts)),'Cached Oracle import attempt differs');
  check(attempts.length<=1,'Oracle import attempt is not unique');
  for(const attempt of attempts){check(attempt.ORGANISM_ID===row.id&&attempt.RUN_ID===run.runId&&attempt.APPLICATION_ID===row.applicationId&&attempt.DEFINITION_HASH===row.artifactHash&&timestamp(attempt.CREATED_AT)&&(attempt.COMPLETED_AT===null||timestamp(attempt.COMPLETED_AT)&&Date.parse(attempt.COMPLETED_AT)>=Date.parse(attempt.CREATED_AT)),'Oracle import attempt identity or time differs');}
 }
 return true;
}

/** Old .t-Body-content screenshots include the account header and are omitted. */
export function isPrivacySafeCapture(value){
 const clip=value?.clip;
 return Boolean(value?.crop==='visible content below header'&&value.captureMethod==='Playwright browser screenshot with viewport clip; no image editing'&&sha.test(value.sha256||'')&&[390,768,1440].includes(value.width)&&clip&&Object.keys(clip).length===4&&['x','y','width','height'].every(key=>Number.isInteger(clip[key]))&&clip.x===0&&clip.y>0&&clip.width===value.width&&clip.height>0&&clip.y+clip.height===1000);
}

// reject() stores bookkeeping zeros even when evaluate() never ran. Preserve
// that rejection without turning its defaults into an observed public score.
export function oracleFitnessFromEvidence(row,events){
 const evaluated=events.filter(event=>event.STATE==='EVALUATED');check(evaluated.length<=1,'Duplicate Oracle evaluation event');
 if(evaluated.length===0){check(row.metricsJson===null&&row.selected===0&&((row.fitness===null&&row.eligible===null)||(row.state==='REJECTED'&&row.fitness===0&&row.eligible===0)),'Oracle decision asserts an unrecorded evaluation');return null;}
 const metrics=row.metricsJson===null?null:parseLivingJson(row.metricsJson);
 check(metrics&&metrics.fitnessDefinition===LIVING_VERSIONS.fitnessDefinition&&metrics.genomeFingerprint===row.genomeHash&&[0,1].includes(row.eligible)&&Number.isFinite(row.fitness)&&row.fitness>=0&&row.fitness<=100&&(row.eligible===1||row.fitness===0)&&timestamp(evaluated[0].RECORDED_AT),'Oracle scoring evidence is incomplete');
 return {eligible:row.eligible===1,score:row.fitness,completedAt:evaluated[0].RECORDED_AT};
}

async function privateFile(path,root){
 const absolute=resolve(path),base=await realpath(root);check(inside(base,absolute)&&absolute!==base,'Private evidence escapes its recorded root');
 let cursor=base;for(const part of relative(base,absolute).split(sep)){cursor=join(cursor,part);const info=await lstat(cursor);check(!info.isSymbolicLink(),'Symbolic links are forbidden in staged evidence');}
 const actual=await realpath(absolute),info=await lstat(actual);check(inside(base,actual)&&info.isFile()&&info.size>0&&info.size<=8*1024*1024,'Invalid private evidence file');return readFile(actual);
}

async function readonlySnapshot(run,configPath){
 check(typeof configPath==='string'&&configPath.trim(),'Explicit application worker configPath or APXGEN_APPLICATION_CONFIG is required; no LAB fallback');
 const configurationPath=resolve(configPath),configuration=parse(await readFile(configurationPath));
 const keys=['oracleConfigPath','sandboxPolicyPath','sqlclPath'];check(Object.keys(configuration).length===keys.length&&keys.every(key=>typeof configuration[key]==='string'&&configuration[key].trim()&&!/[\x00-\x1f"]/.test(configuration[key])),'Explicit application worker configuration is required');
 const policy=parse(await readFile(resolve(dirname(configurationPath),configuration.sandboxPolicyPath)));validateSandboxPolicy(policy);
 const oracle=parse(await readFile(resolve(dirname(configurationPath),configuration.oracleConfigPath)));
 check(oracle.user===policy.schema&&oracle.workspace===policy.workspace&&typeof oracle.password==='string'&&oracle.password.length>0&&typeof oracle.connectString==='string'&&oracle.connectString.length>0,'Connection configuration differs from the approved application sandbox');
 const {default:oracledb}=await import('oracledb');let db;
 try{
  db=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});
  await db.execute('set transaction read only');
  const options={outFormat:oracledb.OUT_FORMAT_OBJECT};
  const context=(await db.execute("select sys_context('USERENV','CURRENT_SCHEMA') schema_name,sys_context('USERENV','SESSION_USER') session_user from dual",{},options)).rows[0];
  const mappings=(await db.execute('select w.workspace,w.workspace_id from apex_workspaces w join apex_workspace_schemas s on s.workspace_id=w.workspace_id where s.schema=:schema and w.workspace=:workspace',{schema:policy.schema,workspace:policy.workspace},options)).rows;
  check(mappings.length===1&&context.SESSION_USER===policy.schema,'Oracle sandbox identity is ambiguous');assertSandboxIdentity(policy,{schema:context.SCHEMA_NAME,workspace:mappings[0].WORKSPACE,workspaceId:mappings[0].WORKSPACE_ID});
  const runs=(await db.execute('select run_id,fitness_definition,state from apxgen_app_runs where run_id=:id',{id:run.runId},options)).rows;check(runs.length===1,'Oracle run is missing');check(['COMPLETE','FAILED','CANCELLED'].includes(runs[0].STATE),'Only a finished Oracle run can be staged');
  const rows=(await db.execute('select organism_id,run_id,generation,parent_id,genome_json,genome_hash,artifact_hash,application_id,state,metrics_json,eligible,fitness,selected,reason from apxgen_app_organisms where run_id=:id order by generation,organism_id',{id:run.runId},{...options,fetchInfo:{GENOME_JSON:{type:oracledb.STRING},METRICS_JSON:{type:oracledb.STRING}}})).rows;
  const organisms=rows.map(row=>({id:row.ORGANISM_ID,runId:row.RUN_ID,generation:row.GENERATION,parentId:row.PARENT_ID,genomeJson:row.GENOME_JSON,genomeHash:row.GENOME_HASH,artifactHash:row.ARTIFACT_HASH,applicationId:row.APPLICATION_ID,state:row.STATE,metricsJson:row.METRICS_JSON,eligible:row.ELIGIBLE,fitness:row.FITNESS,selected:row.SELECTED,reason:row.REASON})),events={},attempts={};
  for(const row of organisms){
   check(['SELECTED','REJECTED'].includes(row.state),'Only immutable terminal Oracle candidates can be staged');check(row.applicationId===null||policy.applicationIds.includes(row.applicationId)&&!policy.protectedApplicationIds.includes(row.applicationId),'Oracle candidate uses an application outside the authorized pool');
   events[row.id]=(await db.execute("select event_id,state,detail,to_char(sys_extract_utc(recorded_at),'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"') recorded_at from apxgen_app_events where organism_id=:id order by event_id",{id:row.id},options)).rows;
   attempts[row.id]=(await db.execute("select attempt_id,organism_id,run_id,application_id,definition_hash,state,error_code,to_char(sys_extract_utc(created_at),'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"') created_at,to_char(sys_extract_utc(completed_at),'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"') completed_at from apxgen_app_import_attempts where organism_id=:id",{id:row.id},options)).rows;
  }
  return {snapshot:{run:{runId:runs[0].RUN_ID,fitnessDefinition:runs[0].FITNESS_DEFINITION,state:runs[0].STATE},organisms,events,attempts},privateValues:[oracle.user,oracle.apexUser,oracle.password,oracle.apexPassword,oracle.connectString,policy.workspace].filter(value=>typeof value==='string'&&value.length>=4)};
 }catch(error){if(/^(?:ORA|NJS)-\d+$/.test(error.code||''))throw new TypeError('Read-only Oracle reconciliation failed: '+error.code);throw error;}
 finally{if(db){try{await db.rollback();}finally{await db.close();}}}
}

async function verifyDefinition(candidate,runRoot){
 if(!candidate.definitionManifest){check(candidate.definitionHash===undefined||candidate.definitionHash===null,'A recorded definition hash needs its original manifest');return null;}
 safeLivingPath(candidate.definitionManifest);const manifestPath=resolve(repository,...candidate.definitionManifest.split('/'));
 const bytes=await privateFile(manifestPath,runRoot),manifest=parse(bytes),appPath=join(dirname(manifestPath),'application');
 check(manifest.kind==='apexlang-application-definition'&&manifest.formatVersion==='1.0'&&manifest.application==='GENESIS_ORDER_LAB'&&manifest.genomeHash===candidate.genomeHash&&canonicalApplicationGenome(manifest.genome)===canonicalApplicationGenome(candidate.genome),'Original definition manifest genome differs');
 const files=[];async function walk(prefix=''){for(const entry of await readdir(join(appPath,prefix),{withFileTypes:true})){const path=prefix?prefix+'/'+entry.name:entry.name;check(!entry.isSymbolicLink(),'Definition source contains symbolic links');if(entry.isDirectory())await walk(path);else{check(entry.isFile(),'Invalid definition source entry');safeLivingPath(path);files.push({path,bytes:await privateFile(join(appPath,path),runRoot)});}}}await walk();files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const identities=files.map(({path,bytes})=>({path,sha256:digest(bytes)})),definitionHash=digest(JSON.stringify(identities));
 check(isDeepStrictEqual(identities,manifest.files)&&definitionHash===manifest.definitionHash&&definitionHash===candidate.definitionHash,'Recorded definition source hashes differ');
 return {manifest,files,identities,definitionHash};
}

/**
 * outputRoot must be a new private staging directory. This never publishes,
 * imports an app, attaches an APEX session, or executes the recorded app source.
 */
export async function stageSmokeEvidence({runEvidencePath,outputRoot,configPath=process.env.APXGEN_APPLICATION_CONFIG}={}){
 check(typeof runEvidencePath==='string'&&typeof outputRoot==='string'&&runEvidencePath&&outputRoot,'Recorded run and new staging directory are required');
 const raw=await readFile(resolve(runEvidencePath));check(raw.length<=8*1024*1024,'Run evidence is too large');const run=parse(raw);
 check(run.testOnly!==true&&run.kind==='real-apex-feasibility'&&identifier.test(run.runId),'Only a real recorded run is accepted; TEST evidence cannot be staged');
 const runRoot=await realpath(join(repository,'.local/order-lab/runs',run.runId)),actualPath=await realpath(resolve(runEvidencePath));check(actualPath===join(runRoot,'run-evidence.json'),'Run evidence must be its original immutable run record');await privateFile(actualPath,runRoot);
 const output=resolve(outputRoot);check(!inside(runRoot,output)&&!inside(output,runRoot),'Staging must be outside original run evidence');try{await lstat(output);throw new TypeError('A new staging directory is required');}catch(error){if(error.code!=='ENOENT')throw error;}
 const hashes=deriveSmokeHashes(run),{snapshot,privateValues}=await readonlySnapshot(run,configPath);assertSmokeReconciliation(run,snapshot);
 const files=new Map(),candidates=[];
 function assertNoPrivateIdentity(bytes){const text=bytes.toString('utf8').toLowerCase();check(!privateValues.some(value=>text.includes(value.toLowerCase())),'Public evidence contains a private connection or account identity');}
 function add(path,bytes){safeLivingPath(path);check(!files.has(path),'Conflicting staging file');if(!/\.png$/.test(path))assertNoPrivateIdentity(bytes);files.set(path,bytes);return path;}
 for(const observed of run.candidates){
  const row=snapshot.organisms.find(value=>value.id===observed.organismId),events=snapshot.events[row.id],attempts=snapshot.attempts[row.id];
  const event=state=>{const found=events.filter(value=>value.STATE===state);check(found.length<=1,'Duplicate Oracle stage event');return found[0]??null;};
  const candidateRoot=join(runRoot,row.id),definition=await verifyDefinition(observed,candidateRoot),prefix='organisms/'+row.id;
  const genomePath=add(prefix+'/genome.json',Buffer.from(canonicalApplicationGenome(observed.genome)));
  let artifactPath=null,artifactHash=null;
  if(definition){const components=[];for(const file of definition.files.filter(file=>/\.(?:apx|css)$/.test(file.path)))components.push(add(prefix+'/source/'+file.path,file.bytes));check(components.some(path=>path.endsWith('.apx')),'Original application source is missing');const bytes=jsonBytes({files:components});artifactPath=add(prefix+'/artifact.json',bytes);artifactHash=digest(bytes);}
  const candidate={id:row.id,runId:run.runId,generation:row.generation,parentId:row.parentId,genomePath,artifactPath,genomeHash:row.genomeHash,artifactHash,applicationId:row.applicationId,...hashes,selected:row.selected===1,fitness:null,fitnessEvidence:null,validation:null,import:null,runtime:null,tasks:Object.fromEntries(LIVING_TASKS.map(name=>[name,null])),screenshots:[]};
  const binding={candidateId:row.id,runId:run.runId,applicationId:row.applicationId,genomeHash:row.genomeHash,artifactHash,...hashes};
  function stage(name,success,completedAt,extra={}){check(timestamp(completedAt),'An actual recorded stage completion time is required');const path=add(prefix+'/evidence/'+name.replace(':','-')+'.json',jsonBytes({...binding,stage:name,success,completedAt,...extra}));return {success,evidence:path};}
  if(observed.compilerEvidence){check(definition,'Compiler evidence is missing its original definition');safeLivingPath(observed.compilerEvidence);const compilerPath=resolve(repository,...observed.compilerEvidence.split('/')),compilerBytes=await privateFile(compilerPath,candidateRoot),compiler=parse(compilerBytes),outputBytes=await privateFile(join(dirname(compilerPath),'compiler-output.txt'),candidateRoot);
   check(compiler.definitionHash===definition.definitionHash&&isDeepStrictEqual(compiler.files,definition.identities)&&compiler.outputSha256===digest(outputBytes),'Compiler source or output binding differs');
   if(compiler.compilerValid===true){check(compiler.status==='compiler_validated'&&compiler.connected===false&&compiler.runtimeVerified===false&&sha.test(compiler.compiler?.executableSha256||'')&&sha.test(compiler.compiler?.compilerJarSha256||'')&&acceptsCompilerResult({exitCode:compiler.compiler.exitCode,stdout:outputBytes.toString('utf8'),stderr:''})&&event('VALIDATED'),'Positive compiler validation lacks recorded proof');candidate.validation=stage('validation',true,event('VALIDATED').RECORDED_AT);}
   else if(compiler.compilerValid===false&&event('VALIDATION_STARTED'))candidate.validation=stage('validation',false,compiler.observedAt);
  }
  if(observed.importEvidence){check(definition&&candidate.validation?.success===true,'Import evidence lacks genuine validation');safeLivingPath(observed.importEvidence);const importPath=resolve(repository,...observed.importEvidence.split('/')),imported=parse(await privateFile(importPath,candidateRoot)),outputBytes=await privateFile(join(dirname(importPath),'import-output.txt'),candidateRoot);
   check(imported.organismId===row.id&&imported.runId===run.runId&&imported.applicationId===row.applicationId&&imported.definitionHash===definition.definitionHash&&imported.outputSha256===digest(outputBytes),'Guarded import identity or output binding differs');
   check(imported.compilerEvidenceSha256===digest(await privateFile(resolve(repository,...observed.compilerEvidence.split('/')),candidateRoot)),'Guarded import compiler binding differs');
   if(imported.importVerified===true){check(imported.status==='import_verified'&&imported.importAttempted===true&&imported.metadataVerified===true&&imported.definitionAndCompilerUnchanged===true&&imported.identityVerified===true&&imported.processExitCode===0&&imported.processTimedOut===false&&attempts.length===1&&attempts[0].STATE==='VERIFIED'&&imported.attemptId===attempts[0].ATTEMPT_ID&&event('IMPORTED'),'Positive import lacks original guarded proof');candidate.import=stage('import',true,event('IMPORTED').RECORDED_AT);}
   else if(imported.importVerified===false&&imported.importAttempted===true&&attempts.length===1&&attempts[0].STATE==='FAILED')candidate.import=stage('import',false,attempts[0].COMPLETED_AT);
  }
  if(observed.runtimeVerified===true){check(candidate.import?.success===true&&observed.authenticationVerified===true&&observed.anonymousAccessBlocked===true&&event('RUNTIME_VERIFIED'),'Runtime verification lacks authenticated recorded proof');candidate.runtime=stage('runtime',true,event('RUNTIME_VERIFIED').RECORDED_AT);}
  const metrics=row.metricsJson===null?null:parseLivingJson(row.metricsJson);
  for(const name of LIVING_TASKS){const task=observed.taskEvidence?.tasks?.[name];if(task!==undefined){check(candidate.runtime?.success===true&&event('TESTING')&&task&&[true,false,null].includes(task.success)&&timestamp(task.completedAt)&&Date.parse(task.completedAt)>=Date.parse(event('TESTING').RECORDED_AT),'Task observation lacks its actual runtime or completion time');
    const extra={};for(const key of ['actions','navigationSteps','elapsedMs'])if(task[key]!==undefined)extra[key]=task[key];
    if(metrics){const recorded=metrics.tasks?.[name];check(recorded&&['success','actions','navigationSteps'].every(key=>recorded[key]===task[key]),'Oracle task metrics contradict recorded browser actions');}
    candidate.tasks[name]=stage('task:'+name,task.success,task.completedAt,extra);
  }}
  const fitness=oracleFitnessFromEvidence(row,events);
  if(fitness){candidate.fitness=fitness.score;candidate.fitnessEvidence=stage('fitness',true,fitness.completedAt,{authority:'ORACLE',definition:LIVING_VERSIONS.fitnessDefinition,eligible:fitness.eligible,score:fitness.score}).evidence;}
  if(row.selected!==1&&row.reason!==null){check(typeof row.reason==='string'&&row.reason.length>0&&row.reason.length<=240,'Oracle rejection reason is invalid');candidate.rejectionReason=row.reason;}
  for(const capture of observed.browserMeasurements?.screenshots||[]){if(!isPrivacySafeCapture(capture))continue;check(candidate.runtime?.success===true,'Screenshots lack verified application runtime');safeLivingPath(capture.path);const bytes=await privateFile(resolve(repository,...capture.path.split('/')),candidateRoot);check(digest(bytes)===capture.sha256,'Recorded screenshot hash differs');check(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.readUInt32BE(16)===capture.clip.width&&bytes.readUInt32BE(20)===capture.clip.height,'Screenshot pixels differ from their recorded viewport clip');candidate.screenshots.push({path:add(prefix+'/screenshots/orders-'+capture.width+'.png',bytes),viewport:{width:capture.width,height:1000},alt:'Recorded application '+row.applicationId+' order report at '+capture.width+' pixels; account header excluded during browser capture.'});}
  check(!candidate.selected||candidate.screenshots.length>0,'A selected historical candidate has no privacy-safe recorded screenshots');candidates.push(candidate);
 }
 const request={candidates,...hashes},manifest={...LIVING_VERSIONS,...hashes,candidates:candidates.map(value=>'records/'+value.id+'.json'),files:[]};assertNoPrivateIdentity(jsonBytes(request));
 // Use the same fail-closed reader as the browser before writing any staging.
 const verifyFiles=new Map(files);for(const candidate of candidates)verifyFiles.set('records/'+candidate.id+'.json',jsonBytes(candidate));manifest.files=[...verifyFiles].map(([path,bytes])=>({path,sha256:digest(bytes),bytes:bytes.length}));const manifestBytes=jsonBytes(manifest);
 await loadLivingEvidence('evidence/manifest.json',{baseUrl:'https://staging.invalid/living.html',expectedManifestSha256:digest(manifestBytes),fetcher:async url=>{const target=new URL(url);check(target.origin==='https://staging.invalid'&&target.pathname.startsWith('/evidence/'),'Invalid private staging verification path');const path=target.pathname.slice('/evidence/'.length),bytes=path==='manifest.json'?manifestBytes:verifyFiles.get(path);check(bytes,'Missing private staging verification file');return new Response(bytes,{status:200,headers:{'content-length':String(bytes.length)}});}});
 await mkdir(dirname(output),{recursive:true});await mkdir(output);const inputRoot=join(output,'input');await mkdir(inputRoot);
 for(const [path,bytes]of files){const destination=join(inputRoot,...path.split('/'));await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes,{flag:'wx'});}
 const requestPath=join(output,'request.json');await writeFile(requestPath,jsonBytes(request),{flag:'wx'});
 return {request,inputRoot,requestPath,runId:run.runId,candidates:candidates.length,files:files.size};
}

export async function packageSmokeEvidence({outputDir,...options}={}){const staged=await stageSmokeEvidence(options);return {...staged,publication:await buildPublicEvidence({...staged.request,inputRoot:staged.inputRoot,outputDir})};}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const [runEvidencePath,outputRoot,configPath]=process.argv.slice(2),staged=await stageSmokeEvidence({runEvidencePath,outputRoot,configPath});console.log(JSON.stringify({runId:staged.runId,inputRoot:staged.inputRoot,requestPath:staged.requestPath,candidates:staged.candidates,files:staged.files},null,2));}catch(error){console.error(error instanceof TypeError?error.message:'Private staging failed; inspect the recorded evidence without copying private logs');process.exitCode=1;}}
