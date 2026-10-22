// One private coordinator lock shared by owned workers and slot recycling.
// Never reclaims another process's marker, including after uncertain cleanup.
import * as fs from 'node:fs/promises';
import {dirname,isAbsolute,join} from 'node:path';
import {randomBytes} from 'node:crypto';

const leases=new WeakMap();
function failure(code,retained=false){const error=new Error(code);error.code=code;if(retained)error.lockRetained=true;return error;}
function fileIo(io){if(!io||!['realpath','open','readFile','unlink'].every(key=>typeof io[key]==='function'))throw failure('COORDINATOR_LOCK_UNCERTAIN');return io;}

/** Canonical config location, never the current directory or a caller path. */
export async function coordinatorLockPath(sandboxConfigPath,{io=fs}={}){
 fileIo(io);if(typeof sandboxConfigPath!=='string'||!isAbsolute(sandboxConfigPath))throw failure('COORDINATOR_LOCK_UNCERTAIN');
 const canonical=await io.realpath(sandboxConfigPath);if(typeof canonical!=='string'||!isAbsolute(canonical))throw failure('COORDINATOR_LOCK_UNCERTAIN');
 return join(dirname(canonical),'owned-worker.lock');
}

/** io is a primitive filesystem seam for synthetic unit tests only. */
export async function acquireCoordinatorLock(sandboxConfigPath,{io=fs}={}){
 let path;try{path=await coordinatorLockPath(sandboxConfigPath,{io});}catch{throw failure('COORDINATOR_LOCK_UNCERTAIN');}
 let handle;try{handle=await io.open(path,'wx',0o600);}catch(error){throw failure(error.code==='EEXIST'?'COORDINATOR_LOCKED':'COORDINATOR_LOCK_UNCERTAIN',error.code==='EEXIST');}
 const bytes=JSON.stringify({pid:process.pid,nonce:randomBytes(16).toString('hex')})+'\n';
 try{await handle.writeFile(bytes,'utf8');await handle.sync();await handle.close();}
 catch{try{await handle.close();}catch{}throw failure('COORDINATOR_LOCK_UNCERTAIN',true);}
 const lease=Object.freeze({});leases.set(lease,{io,path,bytes});return lease;
}

/** Caller must first verify terminal/idle work and close every owned resource. */
export async function releaseCoordinatorLock(lease){
 const owned=lease&&leases.get(lease);if(!owned)throw failure('COORDINATOR_LOCK_UNCERTAIN');
 try{if(await owned.io.readFile(owned.path,'utf8')!==owned.bytes)throw failure('COORDINATOR_LOCK_UNCERTAIN');await owned.io.unlink(owned.path);leases.delete(lease);}
 catch{throw failure('COORDINATOR_LOCK_UNCERTAIN',true);}
}
