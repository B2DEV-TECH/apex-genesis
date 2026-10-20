// Watchdog: a short-lived check started every few minutes by Task Scheduler.
// It never holds the Oracle lease and never touches runs. It restarts the
// supervisor task only after a crash or hang, never after a deliberate stop
// (STOPPED) or a safe stop (SAFE_STOPPED), and at most N times per hour.
import os from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {connect,rows} from '../scripts/db.mjs';
import {stateDir,loadRuntimeConfig,readJson,writeJsonAtomic,createLogger,pidAlive,VERSION} from './lib.mjs';
import {sanitizeText} from './publisher.mjs';

const cfg=await loadRuntimeConfig();const W=cfg.watchdog;
const log=createLogger('watchdog');
const STATUS=join(stateDir(),'status.json'),HISTORY=join(stateDir(),'watchdog-state.json');
const dryRun=process.argv.includes('--dry-run');

const run=(file,args)=>new Promise(resolveRun=>execFile(file,args,{windowsHide:true,timeout:60000},(error,stdout,stderr)=>resolveRun({code:error?(error.code??1):0,out:String(stdout||'')+String(stderr||'')})));

async function main(){
 const status=await readJson(STATUS,null);
 const history=await readJson(HISTORY,{restarts:[],holdUntil:null});
 const now=Date.now();
 history.restarts=history.restarts.filter(t=>now-Date.parse(t)<3600000);
 const ageSeconds=status?.heartbeat?Math.round((now-Date.parse(status.heartbeat))/1000):null;
 const alive=status?pidAlive(status.pid):false;
 let decision,action=null;

 if(!status)decision='NO_STATUS';                                    // never started on this machine/state
 else if(['STOPPED','SAFE_STOPPED'].includes(status.state)&&!alive)decision='DELIBERATELY_STOPPED';
 else if(alive&&ageSeconds!=null&&ageSeconds<=W.staleHeartbeatSeconds)decision='HEALTHY';
 else if(alive)decision='HUNG';
 else decision='CRASHED';

 if(decision==='HUNG'||decision==='CRASHED'){
  if(history.restarts.length>=W.maxRestartsPerHour){decision+='_RESTART_LIMIT';}
  else if(!dryRun){
   if(decision==='HUNG'){action='terminate pid '+status.pid;await run('taskkill.exe',['/PID',String(status.pid),'/T','/F']);}
   const r=await run('schtasks.exe',['/Run','/TN',W.taskName]);
   action=(action?action+'; ':'')+'schtasks /Run '+W.taskName+' -> '+(r.code===0?'started':'exit '+r.code);
   history.restarts.push(new Date().toISOString());
  }else action='dry run: would restart';
 }
 const report={checkedAt:new Date().toISOString(),decision,action,heartbeatAgeSeconds:ageSeconds,supervisorState:status?.state??null,
  restartsLastHour:history.restarts.length,maxRestartsPerHour:W.maxRestartsPerHour,watchdogVersion:VERSION};
 await writeJsonAtomic(HISTORY,{...history,last:report});
 if(action||!decision.startsWith('HEALTHY'))await log.info('Watchdog check',report);

 // Best effort: record what was observed for the APEX operations panel.
 let db;
 try{
  db=await connect();
  const s=(await rows(db,'select state,round((cast(systimestamp as date)-cast(heartbeat as date))*86400) age from apxgen_supervisor'))[0];
  report.databaseState=s.STATE;report.databaseHeartbeatAgeSeconds=s.AGE==null?null:Number(s.AGE);
  await db.execute('begin apxgen_autonomy.watchdog_report(:r);end;',{r:JSON.stringify(report)});
  if(action||decision.endsWith('RESTART_LIMIT'))await db.execute("begin apxgen_autonomy.log(:l,'WATCHDOG',:m,:d);end;",
   {l:decision.endsWith('RESTART_LIMIT')?'ERROR':'WARN',m:'Watchdog: supervisor '+decision.toLowerCase().replace(/_/g,' ')+(action?': '+action:''),d:JSON.stringify(report)});
 }catch(error){await log.warn('Database unavailable to the watchdog',{error:sanitizeText(error.message)});}
 finally{await db?.close().catch(()=>{});}
 if(process.stdout.isTTY||process.argv.includes('--print'))console.log(JSON.stringify(report,null,1));
 await log.flush();
}
await main();
