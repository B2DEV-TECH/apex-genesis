import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
test('source audit detects sandbox secrets stored in nested ignored configuration',async()=>{
 const scratch=resolve('.local/audit-tests');await mkdir(scratch,{recursive:true});
 const directory=await mkdtemp(join(scratch,'nested-'));
 try{
  execFileSync('git',['init','--quiet'],{cwd:directory,windowsHide:true});
  await mkdir(join(directory,'.local/order-lab'),{recursive:true});
  const secret='SyntheticAuditOnlySecret0123456789';
  await writeFile(join(directory,'.local/order-lab/oracle.json'),JSON.stringify({password:secret}));
  await writeFile(join(directory,'source.txt'),'Accidental secret: '+secret);
  execFileSync('git',['add','source.txt'],{cwd:directory,windowsHide:true});
  const script=fileURLToPath(new URL('../../scripts/audit-source.mjs',import.meta.url));
  assert.throws(()=>execFileSync(process.execPath,[script],{cwd:directory,windowsHide:true,stdio:'pipe'}),error=>error.status===1&&String(error.stderr).includes('source.txt')&&!String(error.stderr).includes(secret));
 }finally{
  const target=resolve(directory);assert.ok(target.startsWith(scratch+sep));await rm(target,{recursive:true,force:true});
 }
});
