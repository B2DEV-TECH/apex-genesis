import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
async function auditFixture(configuration,source,callback,{rawConfiguration=false,otherFiles={}}={}){
 const scratch=resolve('.local/audit-tests');await mkdir(scratch,{recursive:true});
 const directory=await mkdtemp(join(scratch,'nested-'));
 try{
  execFileSync('git',['init','--quiet'],{cwd:directory,windowsHide:true});
  await mkdir(join(directory,'.local/order-lab'),{recursive:true});
  await writeFile(join(directory,'.local/order-lab/oracle-application-ai-test.json'),rawConfiguration?configuration:JSON.stringify(configuration));
  for(const[name,content]of Object.entries(otherFiles))await writeFile(join(directory,'.local/order-lab',name),content);
  await writeFile(join(directory,'source.txt'),source);
  execFileSync('git',['add','source.txt'],{cwd:directory,windowsHide:true});
  execFileSync('git',['-c','user.name=Source Audit Test','-c','user.email=audit@example.invalid','commit','--quiet','-m','Synthetic source audit fixture'],{cwd:directory,windowsHide:true});
  const script=fileURLToPath(new URL('../../scripts/audit-source.mjs',import.meta.url));
  return await callback(spawnSync(process.execPath,[script],{cwd:directory,windowsHide:true,encoding:'utf8'}));
 }finally{
  const localRoot=resolve('.local'),target=resolve(directory);assert.ok(scratch.startsWith(localRoot+sep));assert.ok(target.startsWith(scratch+sep+'nested-'));await rm(target,{recursive:true,force:true});
 }
}
function assertPrivateFailure(result,secret,expected){
 assert.equal(result.status,1);assert.ok(result.stderr.includes(expected));assert.ok(!result.stderr.includes(secret));assert.ok(!result.stdout.includes(secret));
}
test('source audit preserves top-level password and APEX password detection',async()=>{
 for(const key of ['password','apexPassword']){
  const secret='SyntheticTopLevelAuditOnlySecret0123456789';
  await auditFixture({[key]:secret},'Accidental secret: '+secret,result=>assertPrivateFailure(result,secret,'source.txt'));
 }
});
test('source audit rejects tracked billing credentials in nested Oracle configuration',async()=>{
 const secret='SyntheticBillingAuditOnlySecret0123456789';
 await auditFixture({billing:{password:secret}},'Accidental secret: '+secret,result=>assertPrivateFailure(result,secret,'source.txt'));
});
test('source audit rejects tracked application credentials through nested objects and arrays',async()=>{
 const secret='SyntheticApplicationAuditOnlySecret0123456789';
 await auditFixture({profiles:[{application:{password:secret}}]},'Accidental secret: '+secret,result=>assertPrivateFailure(result,secret,'source.txt'));
});
test('source audit accepts clean nested configuration and does not inspect unrelated logs or free text as credentials',async()=>{
 const freeText='SyntheticNonCredentialText0123456789';
 await auditFixture({billing:{password:'SyntheticUnleakedBillingSecret0123456789'},application:{apexPassword:'SyntheticUnleakedApexSecret0123456789'},notes:freeText},freeText,result=>{
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).passed,true);
 },{otherFiles:{'run-evidence.json':'malformed unrelated log','events.log':'{"password":"'+freeText+'"}'}});
});
test('malformed Oracle configuration fails without echoing private JSON content',async()=>{
 const secret='SyntheticMalformedAuditOnlySecret0123456789';
 await auditFixture('{"billing":{"password":"'+secret+'"},}', 'Clean source',result=>assertPrivateFailure(result,secret,'Local Oracle configuration is invalid'),{rawConfiguration:true});
});
