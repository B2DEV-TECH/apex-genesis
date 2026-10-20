// Operator CLI. Every control goes through the same durable command channel
// as the APEX operations panel, so the supervisor applies it under its lease.
//
//   node runtime/genesisctl.mjs status [--json]
//   node runtime/genesisctl.mjs enable | disable | pause | resume | stop-run | publish
//   node runtime/genesisctl.mjs shutdown [--wait]       graceful supervisor stop
//   node runtime/genesisctl.mjs start                   start the scheduled task
//   node runtime/genesisctl.mjs run                     run the supervisor in this console
//   node runtime/genesisctl.mjs log [N] | publications [N]
//   node runtime/genesisctl.mjs configure '{"generationIntervalSeconds":60}'
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {connect,rows,oracledb} from '../scripts/db.mjs';
import {ROOT,stateDir,loadRuntimeConfig,readJson,sleep} from './lib.mjs';

const [command='status',...rest]=process.argv.slice(2);
const flags=new Set(rest.filter(a=>a.startsWith('--')));const args=rest.filter(a=>!a.startsWith('--'));
const COMMANDS={enable:'ENABLE',disable:'DISABLE',pause:'PAUSE',resume:'RESUME','stop-run':'STOP_RUN',publish:'PUBLISH_NOW',shutdown:'SHUTDOWN'};
const cfg=await loadRuntimeConfig();

async function withDb(fn){const db=await connect();try{return await fn(db);}finally{await db.close();}}
async function clob(db,sql,binds={}){const r=await db.execute(sql,{...binds,v:{dir:oracledb.BIND_OUT,type:oracledb.CLOB}});return r.outBinds.v.getData?await r.outBinds.v.getData():r.outBinds.v;}

async function enqueue(name){
 return withDb(async db=>{
  const r=await db.execute('begin :id:=apxgen_autonomy.enqueue(:c,:a);end;',{id:{dir:oracledb.BIND_OUT,type:oracledb.NUMBER},c:name,a:'CLI'});await db.commit();
  const id=r.outBinds.id;console.log('Queued '+name+' as command #'+id);
  // Wait briefly for the supervisor to apply it so the operator sees the result.
  for(let i=0;i<40;i++){
   const c=(await rows(db,'select state,result from apxgen_commands where command_id=:id',{id}))[0];
   if(c.STATE!=='PENDING'){console.log(c.STATE+': '+(c.RESULT||''));return c.STATE==='DONE'?0:4;}
   await sleep(1500);
  }
  console.log('Still pending: the supervisor applies commands while it holds the lease. Check `status`.');return 5;
 });
}

function printStatus(s,local){
 const a=s.activeRun,sv=s.supervisor,c=s.config,b=s.budgets,p=s.publication;
 const line=(k,v)=>console.log((k+':').padEnd(26)+(v??'—'));
 line('Supervisor',`${sv.state}${sv.leaseHeld?' (lease held)':''} — ${sv.detail||''}`);
 line('Heartbeat',sv.heartbeat?`${sv.heartbeat} (${sv.heartbeatAgeSeconds}s ago)`:null);
 line('Autonomy',`${c.enabled?'ENABLED':'DISABLED'}, desired ${c.desiredState}, ${c.populationMode}, paid AI ${c.paidAi?'ON':'off'}`);
 line('Policy',`${c.researchPolicy} (independent quota ${c.independentQuota}), ${c.generationsPerRun} generations x ${c.populationSize}, interval ${c.generationIntervalSeconds}s, stagnation ${c.stagnationWindow}/${c.stagnationAction}`);
 line('Active run',a?`#${a.sequence} ${a.runId} ${a.state} generation ${a.generation}/${a.target} (${a.policy}, seed ${a.seed})`:null);
 if(a)line('Checkpoint',`generation ${a.lastCheckpointGeneration} at ${a.lastCheckpointAt}; pending ${a.pendingEvaluations}, failed ${a.failedEvaluations}; best-so-far ${a.bestSoFar}`);
 if(a?.stagnation)line('Stagnation',`${a.stagnation.generationsWithoutImprovement} generations without improvement; diversity ${a.stagnation.meanDiversity}; repeated ${a.stagnation.repeatedPhenotypeFrequency}`);
 line('Budget today',`${b.generationsToday}/${b.dailyCap} generations; ${b.admission}: ${b.admissionDetail}`);
 line('Storage',`${Math.round(b.storageBytes/1048576)} MiB of ${Math.round(b.storageBudgetBytes/1048576)} MiB budget (quota ${b.quotaBytes?Math.round(b.quotaBytes/1048576)+' MiB':'n/a'})`);
 line('Runs',`${b.autonomousRuns} autonomous, ${b.finishedRuns} finished, ${b.recoveredRuns} recovered, ${b.failedRuns} failed`);
 line('AI',`autonomous invocations ${s.ai.autonomousInvocations}; ledger ${s.ai.ledgerInvocations} requests, USD ${s.ai.ledgerUsageUsd}`);
 line('Publication',`${c.publishEnabled?'enabled':'disabled'}; last live ${p.lastLive?p.lastLive.completedAt+' '+p.lastLive.sha256.slice(0,12):'never'}; unpublished runs ${p.runsWithUnpublishedProgress}`);
 if(p.lastError)line('Last publication error',`${p.lastError.createdAt} ${p.lastError.error}`);
 line('Scheduler job',`${s.scheduler.job} ${s.scheduler.state}`);
 line('Pending commands',s.pendingCommands);
 if(local)line('Local status',`pid ${local.pid} ${local.state} at ${local.heartbeat}; ${local.resource?.treeWorkingSetMb??'?'} MB tree, ${local.resource?.browserWorkingSetMb??'?'} MB browser`);
 for(const w of s.warnings)line('WARNING',w);
}

async function main(){
 if(COMMANDS[command]){
  if(command==='shutdown'){
   // The stop file also works when Oracle is unreachable.
   await writeFile(join(stateDir(),'stop.request'),new Date().toISOString()).catch(()=>{});
   let code=0;try{code=await enqueue('SHUTDOWN');}catch(error){console.log('Database unavailable; stop file written. '+error.message);}
   if(flags.has('--wait'))for(let i=0;i<60;i++){const s=await readJson(join(stateDir(),'status.json'),{});if(['STOPPED','SAFE_STOPPED'].includes(s.state)){console.log('Supervisor '+s.state);break;}await sleep(2000);}
   return code;
  }
  return enqueue(COMMANDS[command]);
 }
 if(command==='status'){
  const local=await readJson(join(stateDir(),'status.json'),null);
  const s=JSON.parse(await withDb(db=>clob(db,'begin :v:=apxgen_autonomy.status_json;end;')));
  if(flags.has('--json'))console.log(JSON.stringify({database:s,local},null,1));else printStatus(s,local);
  return 0;
 }
 if(command==='log'||command==='publications'){
  const n=Number(args[0]||30);
  const list=JSON.parse(await withDb(db=>clob(db,`begin :v:=apxgen_autonomy.${command==='log'?'log_json':'publications_json'}(:n);end;`,{n})));
  for(const x of list.reverse())console.log(command==='log'?`${x.at} ${x.level.padEnd(5)} ${x.source.padEnd(10)} ${x.message}`:`${x.createdAt} ${x.kind.padEnd(8)} ${x.state.padEnd(11)} ${x.target} ${x.key||''} ${x.error||''}`);
  return 0;
 }
 if(command==='configure'){
  if(!args[0])throw new Error('configure requires a JSON object');
  await withDb(async db=>{await db.execute('begin apxgen_autonomy.set_config(:j,:a);end;',{j:args[0],a:'CLI'});await db.commit();});
  console.log('Configuration updated');return 0;
 }
 if(command==='start'){
  return new Promise(r=>execFile('schtasks.exe',['/Run','/TN',cfg.watchdog.taskName],{windowsHide:true},(e,o,er)=>{console.log(String(o||er).trim());r(e?1:0);}));
 }
 if(command==='run'){
  return new Promise(r=>{const child=spawn(process.execPath,[join(ROOT,'runtime','supervisor.mjs')],{stdio:'inherit',cwd:ROOT});child.on('exit',c=>r(c??1));});
 }
 console.error('Unknown command: '+command);return 64;
}
process.exitCode=await main();
