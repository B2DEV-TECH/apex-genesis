// Shared helpers for the Genesis supervisor, watchdog, publisher and CLI.
// No secrets are read here: database credentials stay in scripts/db.mjs.
import {readFile,writeFile,mkdir,rename,stat,appendFile,open,unlink,statfs} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import os from 'node:os';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const VERSION=JSON.parse(await readFile(join(ROOT,'package.json'),'utf8')).version;

// Runtime state lives in the ignored .local folder. A separate folder per
// database owner keeps verification runs away from the production lab state.
export function stateDir(){return join(ROOT,'.local','autonomy',process.env.APXGEN_STATE||'lab');}

export async function loadRuntimeConfig(){
 const defaults=JSON.parse(await readFile(join(ROOT,'config','supervisor.json'),'utf8'));
 let local={};
 try{local=JSON.parse((await readFile(join(stateDir(),'supervisor.json'),'utf8')).replace(/^﻿/,''));}catch(error){if(error.code!=='ENOENT')throw error;}
 return deepMerge(defaults,local);
}
function deepMerge(a,b){const out={...a};for(const [k,v] of Object.entries(b)){out[k]=v&&typeof v==='object'&&!Array.isArray(v)&&a[k]&&typeof a[k]==='object'?deepMerge(a[k],v):v;}return out;}

export const sleep=(ms,signal)=>new Promise(resolveSleep=>{const t=setTimeout(resolveSleep,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);resolveSleep();},{once:true});});

// Atomic JSON write: temp file + rename, so readers never observe a partial file.
export async function writeJsonAtomic(path,value){
 await mkdir(dirname(path),{recursive:true});
 const tmp=path+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(value,null,1));await rename(tmp,path);
}
export async function readJson(path,fallback=null){try{return JSON.parse(await readFile(path,'utf8'));}catch{return fallback;}}

// Line-oriented log with size-based rotation (keeps N previous files).
export function createLogger(name,{maxBytes=5*1024*1024,keep=5}={}){
 const file=join(stateDir(),'logs',name+'.log');
 let queue=Promise.resolve();
 async function rotate(){
  try{const s=await stat(file);if(s.size<maxBytes)return;}catch{return;}
  for(let i=keep-1;i>=1;i--){try{await rename(file+'.'+i,file+'.'+(i+1));}catch{}}
  try{await rename(file,file+'.1');}catch{}
 }
 function write(level,message,details){
  const line=JSON.stringify({at:new Date().toISOString(),level,pid:process.pid,message,...(details?{details}:{})})+'\n';
  queue=queue.then(async()=>{await mkdir(dirname(file),{recursive:true});await rotate();await appendFile(file,line);}).catch(()=>{});
  if(process.stdout.isTTY)process.stdout.write(line);
  return queue;
 }
 return {file,info:(m,d)=>write('INFO',m,d),warn:(m,d)=>write('WARN',m,d),error:(m,d)=>write('ERROR',m,d),flush:()=>queue};
}

export function pidAlive(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}

// Local single-instance lock. It complements, never replaces, the Oracle lease.
export async function acquireLock(path){
 await mkdir(dirname(path),{recursive:true});
 for(let attempt=0;attempt<2;attempt++){
  try{const h=await open(path,'wx');await h.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));await h.close();return true;}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   const holder=await readJson(path,{});
   if(holder.pid&&holder.pid!==process.pid&&pidAlive(holder.pid))return false;
   await unlink(path).catch(()=>{});       // stale lock from a crashed process
  }
 }
 return false;
}
export async function releaseLock(path){const holder=await readJson(path,{});if(holder.pid===process.pid)await unlink(path).catch(()=>{});}

// Process tree resource sample (Windows CIM; one PowerShell call per sample).
export function processTree(rootPid){
 return new Promise(resolveTree=>{
  const script='Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress';
  execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:30000,maxBuffer:32*1024*1024},(error,stdout)=>{
   if(error){resolveTree(null);return;}
   let all;try{all=JSON.parse(stdout);}catch{resolveTree(null);return;}
   const children=new Map();for(const p of all){if(!children.has(p.ParentProcessId))children.set(p.ParentProcessId,[]);children.get(p.ParentProcessId).push(p);}
   const self=all.find(p=>p.ProcessId===rootPid);const tree=[];const stack=self?[self]:[];
   while(stack.length){const p=stack.pop();tree.push(p);for(const c of children.get(p.ProcessId)||[])if(c.ProcessId!==p.ProcessId)stack.push(c);}
   resolveTree({processes:tree.length,workingSetBytes:tree.reduce((s,p)=>s+Number(p.WorkingSetSize||0),0),
    cpu100ns:tree.reduce((s,p)=>s+Number(p.KernelModeTime||0)+Number(p.UserModeTime||0),0),
    browserWorkingSetBytes:tree.filter(p=>/chrom|headless_shell/i.test(p.Name||'')).reduce((s,p)=>s+Number(p.WorkingSetSize||0),0)});
  });
 });
}

export function cpuSnapshot(){return os.cpus().map(c=>c.times);}
export function cpuBusyPercent(before,after){
 let idle=0,total=0;
 after.forEach((t,i)=>{const b=before[i];const d=k=>t[k]-b[k];const sum=d('user')+d('nice')+d('sys')+d('idle')+d('irq');idle+=d('idle');total+=sum;});
 return total>0?Math.round(1000*(1-idle/total))/10:0;
}
export async function diskFreeBytes(path){try{const s=await statfs(path);return Number(s.bavail)*Number(s.bsize);}catch{return null;}}
