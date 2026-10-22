import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assertCleanupAuthorization,verifyOwnedArchive} from '../../scripts/application/dispose-application.mjs';
import {hashApplicationDefinition} from '../../scripts/application/build-definition.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const policy={schemaVersion:'1.0',enabled:true,environment:'development',schema:'APXGEN_ORDER_LAB',workspace:'APXGEN_ORDER_LAB',workspaceId:123456,applicationIds:[130,131,132,133],protectedApplicationIds:[120,121],fixtureWritesAuthorized:true,maxConcurrentImports:1,maxMaterializationsPerRun:22};
const request={mode:'ARCHIVE_ONLY',applicationId:130,runId:'1'.repeat(32),organismId:'2'.repeat(32),definitionHash:'3'.repeat(64)};
const authorization={mode:'DISPOSE_ARCHIVED_OWNED_APPLICATION',schema:policy.schema,workspace:policy.workspace,workspaceId:policy.workspaceId,applicationIds:[130],runId:request.runId,organismId:request.organismId,definitionHash:request.definitionHash};

test('cleanup authorization permits only the explicitly bound old130 owner and excludes every other app',()=>{
 assert.equal(assertCleanupAuthorization(policy,authorization,request),true);
 for(const change of [a=>a.applicationIds=[131],a=>a.applicationIds=[130,131],a=>a.runId='4'.repeat(32),a=>a.organismId='4'.repeat(32),a=>a.workspaceId=999,a=>a.mode='ANY_APP',a=>a.definitionHash='4'.repeat(64)]){const a=structuredClone(authorization);change(a);assert.throws(()=>assertCleanupAuthorization(policy,a,request));}
 for(const app of [120,121,131,132,133])assert.throws(()=>assertCleanupAuthorization(policy,authorization,{...request,applicationId:app}));
});

test('cleanup requires original DNA plus every actual SQL export/archive hash and refuses edited archives',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'genesis-dispose-test-'));
 try{
  const original=join(directory,'original'),archive=join(directory,'archive');await mkdir(original);await mkdir(join(archive,'definition'),{recursive:true});await mkdir(join(archive,'sql'));
  const dna=Buffer.from('application (name: Synthetic Test)\n');await writeFile(join(original,'application.apx'),dna);await writeFile(join(archive,'definition/application.apx'),dna);
  const definition=await hashApplicationDefinition(original),r={...request,definitionHash:definition.definitionHash};
  const sourceManifest=Buffer.from(JSON.stringify(definition));await writeFile(join(archive,'definition-manifest.json'),sourceManifest);
  const sql=Buffer.from('begin wwv_flow_imp.import_begin(p_default_application_id=>130); end;\n/\n');await writeFile(join(archive,'sql/f130.sql'),sql);
  const files=[['definition/application.apx',dna],['definition-manifest.json',sourceManifest],['sql/f130.sql',sql]].map(([path,bytes])=>({path,sha256:sha(bytes),bytes:bytes.length}));
  const manifest=Buffer.from(JSON.stringify({mode:'ARCHIVE_ONLY',archiveVerified:true,cleanupPerformed:false,request:r,files}));await writeFile(join(archive,'archive-manifest.json'),manifest);
  assert.equal((await verifyOwnedArchive({archiveDir:archive,manifestSha256:sha(manifest),request:r,originalDefinitionPath:original})).archiveVerified,true);
  await writeFile(join(archive,'sql/f130.sql'),Buffer.from('tampered'));
  await assert.rejects(()=>verifyOwnedArchive({archiveDir:archive,manifestSha256:sha(manifest),request:r,originalDefinitionPath:original}));
  await writeFile(join(archive,'sql/f130.sql'),sql);await writeFile(join(original,'application.apx'),Buffer.from('changed original'));
  await assert.rejects(()=>verifyOwnedArchive({archiveDir:archive,manifestSha256:sha(manifest),request:r,originalDefinitionPath:original}));
  assert.equal(await readFile(join(archive,'sql/f130.sql'),'utf8'),sql.toString());
 }finally{/* Retain these synthetic test artifacts; this task authorizes no file deletion. */}
});
