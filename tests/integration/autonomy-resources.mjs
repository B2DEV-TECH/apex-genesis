// Acceptance test 11: resource and admission limits are enforced by the real
// supervisor, not just configured.
//
// Runs against the VERIFY schema only, with the supervisor stopped. Each phase
// starts the real supervisor with a deliberately tight limit, observes it, and
// stops it gracefully. The per-machine override and the database policy are
// restored afterwards whatever happens.
//
//   APXGEN_CONFIG=.local/verify-oracle.json APXGEN_STATE=verify node tests/integration/autonomy-resources.mjs
import {join} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {mkdir,readFile,writeFile,unlink,open} from 'node:fs/promises';
import {connect,rows} from '../../scripts/db.mjs';
import {ROOT,VERSION,stateDir,readJson,pidAlive,sleep} from '../../runtime/lib.mjs';

const assert=(ok,message)=>{if(!ok)throw new Error('Assertion failed: '+message);};
const OVERRIDE=join(stateDir(),'supervisor.json'),STATUS=join(stateDir(),'status.json'),STOP=join(stateDir(),'stop.request');
const db=await connect();
const evidence={test:'autonomy-resources',version:VERSION,startedAt:new Date().toISOString(),phases:[]};
const status=()=>readJson(STATUS,{});
const configure=async json=>{await db.execute('begin apxgen_autonomy.set_config(:j,:a);end;',{j:JSON.stringify(json),a:'TEST'});await db.commit();};
const ps=command=>new Promise(r=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true},(e,o)=>r(String(o||'').trim())));
async function waitFor(fn,seconds,label){for(let i=0;i<seconds;i++){const v=await fn();if(v)return v;await sleep(1000);}throw new Error('Timed out waiting for '+label);}

let child=null;
async function startSupervisor(phase){
 await unlink(STOP).catch(()=>{});
 const out=await open(join(stateDir(),'logs','resources-test-'+phase+'.out'),'w');
 child=spawn(process.execPath,[join(ROOT,'runtime','supervisor.mjs')],{cwd:ROOT,env:process.env,stdio:['ignore',out.fd,out.fd],windowsHide:true});
 child.exited=new Promise(r=>child.on('exit',code=>{out.close().catch(()=>{});r(code);}));
 await waitFor(async()=>{const s=await status();return s.pid===child.pid&&s.leaseHeld;},240,'the supervisor to hold the lease');
}
async function stopSupervisor(){
 if(!child)return null;
 await writeFile(STOP,new Date().toISOString());
 const code=await Promise.race([child.exited,sleep(120000).then(()=>'timeout')]);
 child=null;return code;
}
const dbLogSince=async(since,like)=>rows(db,`select apxgen_autonomy.utc_text(logged_at) at,message from apxgen_supervisor_log where logged_at>from_tz(to_timestamp(:t,'YYYY-MM-DD"T"HH24:MI:SS'),'UTC') and message like :m order by log_id`,{t:since.slice(0,19),m:like});
const runCount=async()=>Number((await rows(db,'select count(*) n from apxgen_autonomy_runs'))[0].N);
const evaluatedCount=async()=>Number((await rows(db,`select count(*) n from apxgen_evaluations e join apxgen_organisms o on o.organism_id=e.organism_id join apxgen_autonomy_runs a on a.run_id=o.run_id`))[0].N);

const originalOverride=await readFile(OVERRIDE,'utf8').catch(()=>null);
const baseOverride=originalOverride?JSON.parse(originalOverride.replace(/^﻿/,'')):{};
const original=(await rows(db,'select storage_budget_mb,daily_generation_cap,label_prefix from apxgen_autonomy_config'))[0];
const writeOverride=extra=>writeFile(OVERRIDE,JSON.stringify({...baseOverride,...extra,limits:{...(baseOverride.limits||{}),...(extra.limits||{})}},null,1)+'\n');

try{
 assert(/^TEST/.test(original.LABEL_PREFIX),'this test only runs where labelPrefix starts with TEST');
 const s0=await status();assert(!s0.pid||!pidAlive(s0.pid),'the supervisor is stopped before the test');
 await mkdir(join(stateDir(),'logs'),{recursive:true});

 // 1. Storage budget below current usage plus the per-run margin: no new run
 //    is admitted.
 {
  const runsBefore=await runCount();
  await configure({storageBudgetMb:10,dailyGenerationCap:100000});
  await writeOverride({});await startSupervisor('storage');
  const s=await waitFor(async()=>{const x=await status();return /Storage budget reached/.test(x.detail||'')&&x;},90,'storage admission refusal');
  await sleep(10000);
  const runsAfter=await runCount();
  assert(runsAfter===runsBefore,'no run created while the storage budget is exhausted');
  const exit=await stopSupervisor();
  evidence.phases.push({phase:'storage-budget',limit:'storageBudgetMb=10 (current use plus the 16 MiB run margin exceeds it)',observedState:s.state,observedDetail:s.detail,runsBefore,runsAfter,supervisorExit:exit});
  await configure({storageBudgetMb:Number(original.STORAGE_BUDGET_MB)});
 }

 // 2. Daily generation cap below what a run needs: no run is admitted. The
 //    cap is an admission rule, so this runs while no run is active.
 {
  const runsBefore=await runCount();
  await configure({dailyGenerationCap:1});await writeOverride({});await startSupervisor('daily-cap');
  const s=await waitFor(async()=>{const x=await status();return /Daily generation cap/.test(x.detail||'')&&!x.activeRun&&x;},240,'daily cap refusal');
  await sleep(10000);const runsAfter=await runCount();
  assert(runsAfter===runsBefore,'no run created over the daily cap');
  const exit=await stopSupervisor();
  await configure({dailyGenerationCap:100000});
  evidence.phases.push({phase:'daily-generation-cap',limit:'dailyGenerationCap=1',observedDetail:s.detail,runsBefore,runsAfter,supervisorExit:exit});
 }
 // 3. Free-disk floor above the real free space: evaluation is throttled and
 //    no organism is evaluated while the condition holds.
 {
  await writeOverride({resourceSampleSeconds:5,limits:{minFreeDiskMb:100000000,throttleSeconds:20}});await startSupervisor('disk');
  const first=await waitFor(async()=>{const x=await status();return x.metrics?.throttles>=1&&x;},120,'a throttle');
  const evaluatedAtThrottle=await evaluatedCount();
  await sleep(30000);
  const s=await status();const evaluatedAfter=await evaluatedCount();
  assert(s.metrics.throttles>first.metrics.throttles,'throttle renewed while the condition holds');
  assert(evaluatedAfter===evaluatedAtThrottle,'no evaluations completed during 30 s of throttling');
  assert(/Throttled: free disk/.test(s.detail||''),'status names the free-disk reason');
  const exit=await stopSupervisor();
  evidence.phases.push({phase:'disk-floor-throttle',limit:'minFreeDiskMb=100000000',diskFreeMb:s.resource?.diskFreeMb,throttles:s.metrics.throttles,
   evaluatedAtThrottle,evaluatedAfter30s:evaluatedAfter,observedDetail:s.detail,supervisorExit:exit});
 }

 // 4. Browser memory ceiling below the browser's real footprint: the browser
 //    is recycled and evaluation continues. Also records process priority.
 {
  const since=new Date().toISOString();const evaluatedBefore=await evaluatedCount();
  await writeOverride({resourceSampleSeconds:5,limits:{maxBrowserWorkingSetMb:40}});await startSupervisor('memory');
  const s=await waitFor(async()=>{const x=await status();return x.metrics?.browserRecycles>=2&&x;},180,'two memory recycles');
  const priority=await ps(`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${child.pid}";$k=Get-CimInstance Win32_Process -Filter "ParentProcessId=${child.pid}";@{supervisor=(Get-Process -Id ${child.pid}).PriorityClass.ToString();children=@($k|%{ $_.Name+':'+(Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).PriorityClass })}|ConvertTo-Json -Compress`);
  await sleep(10000);
  const evaluatedAfter=await evaluatedCount();const logged=await dbLogSince(since,'Memory limit exceeded%');
  assert(logged.length>=1,'memory recycle recorded in the database log');
  assert(evaluatedAfter>evaluatedBefore,'evaluation continues across browser recycles');
  const prio=JSON.parse(priority||'{}');
  assert(prio.supervisor==='BelowNormal','supervisor runs at BelowNormal priority');
  const exit=await stopSupervisor();
  evidence.phases.push({phase:'browser-memory-recycle',limit:'maxBrowserWorkingSetMb=40',browserWorkingSetMb:s.resource?.browserWorkingSetMb,treeWorkingSetMb:s.resource?.treeWorkingSetMb,
   browserRecycles:s.metrics.browserRecycles,databaseLogEntries:logged.length,firstLogged:logged[0],evaluatedBefore,evaluatedAfter,priority:prio,supervisorExit:exit});
 }

 evidence.outcome='PASSED';
}catch(error){evidence.outcome='FAILED';evidence.error=error.message;process.exitCode=1;}
finally{
 await stopSupervisor().catch(()=>{});
 if(originalOverride==null)await unlink(OVERRIDE).catch(()=>{});else await writeFile(OVERRIDE,originalOverride);
 await configure({storageBudgetMb:Number(original.STORAGE_BUDGET_MB),dailyGenerationCap:Number(original.DAILY_GENERATION_CAP)}).catch(()=>{});
 evidence.restored={override:originalOverride==null?'removed':'restored',storageBudgetMb:Number(original.STORAGE_BUDGET_MB),dailyGenerationCap:Number(original.DAILY_GENERATION_CAP)};
 await db.close();
 evidence.finishedAt=new Date().toISOString();
 await mkdir(join(ROOT,'docs','testing'),{recursive:true});
 await writeFile(join(ROOT,'docs','testing','autonomy-resources-evidence.json'),JSON.stringify(evidence,null,1)+'\n');
 console.log(JSON.stringify(evidence,null,1));
}
