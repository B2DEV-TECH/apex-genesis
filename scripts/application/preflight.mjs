// Read-only admission inspection. This command never imports an application.
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import oracledb from 'oracledb';
import {validateSandboxPolicy,assertSandboxIdentity} from '../../runtime/application/sandbox.mjs';

const readJson=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
export async function preflightApplicationSandbox(configPath){
 if(!configPath) throw new Error('APXGEN_APPLICATION_CONFIG must explicitly identify an application sandbox configuration; no LAB fallback is permitted');
 const path=resolve(configPath),config=await readJson(path);
 const keys=['oracleConfigPath','sandboxPolicyPath','sqlclPath'];
 if(Object.keys(config).length!==keys.length||!keys.every(key=>typeof config[key]==='string'&&config[key].length>0)) throw new Error('Application configuration requires exactly oracleConfigPath, sandboxPolicyPath and sqlclPath');
 const policy=await readJson(resolve(dirname(path),config.sandboxPolicyPath));
 validateSandboxPolicy(policy);
 const oracle=await readJson(resolve(dirname(path),config.oracleConfigPath));
 if(oracle.user!==policy.schema||oracle.workspace!==policy.workspace) throw new Error('Oracle connection configuration differs from the authorized sandbox');
 const sqlcl=await new Promise((done,fail)=>execFile(resolve(dirname(path),config.sqlclPath),['-version'],{windowsHide:true,timeout:30000,maxBuffer:65536},(error,stdout,stderr)=>error?fail(new Error('Configured SQLcl executable could not report its version')):done((stdout+'\n'+stderr).trim())));
 if(!/SQLcl: Release 26\.(?:[2-9]|[1-9][0-9])\./.test(sqlcl)) throw new Error('This implementation requires a verified SQLcl 26.2 or later 26.x runtime');
 const db=await oracledb.getConnection({user:oracle.user,password:oracle.password,connectString:oracle.connectString});
 try{
  const row=(await db.execute("select sys_context('USERENV','CURRENT_SCHEMA') schema_name,sys_context('USERENV','SESSION_USER') session_user from dual",{}, {outFormat:oracledb.OUT_FORMAT_OBJECT})).rows[0];
  if(row.SESSION_USER!==policy.schema) throw new Error('Session owner differs from authorized parsing schema');
  const mapped=(await db.execute('select w.workspace,w.workspace_id from apex_workspaces w join apex_workspace_schemas s on s.workspace_id=w.workspace_id where s.schema=:schema and w.workspace=:workspace',{schema:policy.schema,workspace:policy.workspace},{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
  if(mapped.length!==1) throw new Error('Exactly one authorized workspace/schema mapping must exist');
  assertSandboxIdentity(policy,{schema:row.SCHEMA_NAME,workspace:mapped[0].WORKSPACE,workspaceId:mapped[0].WORKSPACE_ID});
  const occupied=[];
  for(const app of policy.applicationIds){
   const exists=(await db.execute('select application_id from apex_applications where application_id=:app',{app})).rows;
   if(exists.length) occupied.push(app);
  }
  return {readOnly:true,identityVerified:true,sqlclVersion:sqlcl.split(/\r?\n/).find(line=>line.includes('SQLcl: Release')),authorizedSlots:policy.applicationIds,occupiedSlots:occupied,allSlotsUnused:occupied.length===0,importsPerformed:0,paidRequests:0,releaseReady:false};
 }finally{await db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await preflightApplicationSandbox(process.env.APXGEN_APPLICATION_CONFIG),null,2));}
 catch(error){console.error(error.message.startsWith('ORA-')?'Oracle preflight failed; inspect the private connection and workspace mapping':error.message);process.exitCode=1;}
}
