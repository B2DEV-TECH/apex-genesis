import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {coordinatorLockPath,acquireCoordinatorLock,releaseCoordinatorLock} from '../../runtime/application/coordinator-lock.mjs';

// TEST ONLY private filesystem fixtures. Never touches the actual worker lock.
async function fixture(context){const localRoot=await fs.realpath(resolve('.local')),directory=await fs.mkdtemp(join(localRoot,'TEST-coordinator-lock-'));context.after(async()=>{const target=await fs.realpath(directory);assert.equal(dirname(target),localRoot);assert.ok(target.startsWith(localRoot+sep)&&basename(target).startsWith('TEST-coordinator-lock-'));await fs.rm(target,{recursive:true,force:true});});const config=join(directory,'worker.json');await fs.writeFile(config,'{"TEST_ONLY":true}');return {directory,config,path:join(directory,'owned-worker.lock')};}
test('fixed lock path follows the canonical sandbox config location, independent of aliases',async context=>{
 const f=await fixture(context);assert.equal(await coordinatorLockPath(f.config),f.path);
 const io={...fs,async realpath(){return f.config;}};assert.equal(await coordinatorLockPath(resolve('TEST-config-alias.json'),{io}),f.path);
});
test('atomic contention never reclaims another live or stale-looking lock',async context=>{
 const f=await fixture(context),lease=await acquireCoordinatorLock(f.config),bytes=await fs.readFile(f.path,'utf8');assert.deepEqual(Object.keys(JSON.parse(bytes)).sort(),['nonce','pid']);assert.equal(JSON.parse(bytes).pid,process.pid);assert.match(JSON.parse(bytes).nonce,/^[a-f0-9]{32}$/);
 await assert.rejects(acquireCoordinatorLock(f.config),{code:'COORDINATOR_LOCKED'});assert.equal(await fs.readFile(f.path,'utf8'),bytes);await releaseCoordinatorLock(lease);
 await fs.writeFile(f.path,'{"pid":1,"nonce":"TEST_ONLY_STALE"}');await assert.rejects(acquireCoordinatorLock(f.config),{code:'COORDINATOR_LOCKED'});assert.equal(await fs.readFile(f.path,'utf8'),'{"pid":1,"nonce":"TEST_ONLY_STALE"}');
});
test('release accepts only its live opaque lease and never removes replacement metadata',async context=>{
 const f=await fixture(context),lease=await acquireCoordinatorLock(f.config);await assert.rejects(releaseCoordinatorLock({...lease}),{code:'COORDINATOR_LOCK_UNCERTAIN'});const replacement='{"pid":1,"nonce":"TEST_ONLY_FOREIGN"}';await fs.writeFile(f.path,replacement);await assert.rejects(releaseCoordinatorLock(lease),{code:'COORDINATOR_LOCK_UNCERTAIN'});assert.equal(await fs.readFile(f.path,'utf8'),replacement);
});
test('successful release cannot be reused to unlock a subsequent owner',async context=>{
 const f=await fixture(context),first=await acquireCoordinatorLock(f.config);await releaseCoordinatorLock(first);const second=await acquireCoordinatorLock(f.config),bytes=await fs.readFile(f.path,'utf8');await assert.rejects(releaseCoordinatorLock(first),{code:'COORDINATOR_LOCK_UNCERTAIN'});assert.equal(await fs.readFile(f.path,'utf8'),bytes);await releaseCoordinatorLock(second);await assert.rejects(fs.stat(f.path),{code:'ENOENT'});
});
test('failure writing or closing acquired metadata retains the marker and never unlinks it',async context=>{
 const f=await fixture(context);let closed=false;const io={...fs,async open(path,flags){assert.equal(flags,'wx');const handle=await fs.open(path,flags);return {async writeFile(){throw new Error('TEST ONLY write failure');},async sync(){},async close(){closed=true;await handle.close();}};}};await assert.rejects(acquireCoordinatorLock(f.config,{io}),{code:'COORDINATOR_LOCK_UNCERTAIN',lockRetained:true});assert.equal(closed,true);assert.equal((await fs.stat(f.path)).isFile(),true);
});
