// Synthetic filesystem fixtures only; these tests create no Oracle authority.
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { APPLICATION_BASELINE, canonicalApplicationGenome } from '../../evolution/application/genome.mjs';
import { hashApplicationDefinition } from '../../scripts/application/build-definition.mjs';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const policy = {schemaVersion:'1.0',enabled:true,environment:'development',schema:'GENESIS_TEST_OWNER',workspace:'GENESIS_TEST_WS',workspaceId:98765,applicationIds:[130,131,132,133],protectedApplicationIds:[120,121],fixtureWritesAuthorized:true,maxConcurrentImports:1,maxMaterializationsPerRun:22};
export const runId = '1'.repeat(32), organismId = '2'.repeat(32), attemptId = '4'.repeat(32), otherId = '5'.repeat(32);
export const json = value => Buffer.from(JSON.stringify(value));
export async function put(root, path, value) { await mkdir(join(root, path, '..'), {recursive:true}); const bytes = Buffer.isBuffer(value) ? value : json(value); await writeFile(join(root,path), bytes); return {path,sha256:sha(bytes),bytes:bytes.length}; }
export async function fixture(fn, {applicationId=133,runState='COMPLETE',bestOrganismId=organismId} = {}) {
  const local = resolve('.local'); await mkdir(local,{recursive:true}); const root = await mkdtemp(join(local,'recycle-policy-test-'));
  try {
    const evidenceDir=join(root,'evidence'),archiveDir=join(root,'archive'),snapshotDir=join(root,'snapshot'),originalDefinitionPath=join(evidenceDir,'definition/application');
    await mkdir(originalDefinitionPath,{recursive:true});
    await put(originalDefinitionPath,'application.apx',Buffer.from('app GENESIS-ORDER-LAB (\n    name: Synthetic fixture\n)\n'));
    const definition=await hashApplicationDefinition(originalDefinitionPath),genome=structuredClone(APPLICATION_BASELINE),genomeHash=sha(canonicalApplicationGenome(genome));
    const request={mode:'RECYCLE_OWNED_APPLICATION',applicationId,runId,organismId,genomeHash,definitionHash:definition.definitionHash};
    const archiveRequest={mode:'ARCHIVE_ONLY',applicationId,runId,organismId,definitionHash:definition.definitionHash};
    const observed={
      identity:{schema:policy.schema,sessionUser:policy.schema,workspace:policy.workspace,workspaceId:policy.workspaceId},
      application:{applicationId,workspace:policy.workspace,schema:policy.schema},
      slot:{applicationId,workspaceId:policy.workspaceId,runId,organismId,state:'RELEASED',leaseCurrent:false},
      run:{runId,state:runState,bestOrganismId,currentGeneration:1,materializations:2,materializationBudget:22},
      organism:{organismId,runId,applicationId,genome,genomeHash,artifactHash:definition.definitionHash,state:'SELECTED'},
      attempts:[{attemptId,organismId,runId,applicationId,definitionHash:definition.definitionHash,state:'VERIFIED',completed:true}],
      activity:{browserStopped:true,pendingEvaluations:0,activeEvaluationLeases:0,activeBrowserLeases:0,activeImportLeases:0},
      cleanupAttempts:[],
      locks:{slotTableExclusive:true,runRow:true,organismRow:true,slotRow:true}
    };
    const definitionManifest={...definition,genome,genomeHash}; await put(evidenceDir,'definition/definition-manifest.json',definitionManifest);
    const compilerOutput=Buffer.from('Validation successful.\n'),compiler={compilerValid:true,definitionHash:definition.definitionHash,outputSha256:sha(compilerOutput)};
    const compilerBytes=json(compiler),importOutput=Buffer.from('Synthetic import evidence fixture only\n');
    await put(evidenceDir,'compiler/compiler-validation.json',compilerBytes); await put(evidenceDir,'compiler/compiler-output.txt',compilerOutput);
    await put(evidenceDir,'import/import-evidence.json',{importVerified:true,applicationId,runId,organismId,definitionHash:definition.definitionHash,attemptId,compilerEvidenceSha256:sha(compilerBytes),outputSha256:sha(importOutput)});
    await put(evidenceDir,'import/import-output.txt',importOutput);
    await put(evidenceDir,'candidate-evidence.json',{organismId,applicationId,genomeHash,definitionHash:definition.definitionHash,browserMeasurements:{screenshots:[]}});
    const evidenceFiles=[]; for(const path of ['definition/application/application.apx','definition/definition-manifest.json','compiler/compiler-validation.json','compiler/compiler-output.txt','import/import-evidence.json','import/import-output.txt','candidate-evidence.json']) {const bytes=await readFile(join(evidenceDir,path));evidenceFiles.push({path,sha256:sha(bytes),bytes:bytes.length});}
    const evidenceManifest={kind:'owned-application-evidence-1',request,roles:{candidate:'candidate-evidence.json',compiler:'compiler/compiler-validation.json',compilerOutput:'compiler/compiler-output.txt',import:'import/import-evidence.json',importOutput:'import/import-output.txt'},files:evidenceFiles};
    const evidenceManifestBytes=json(evidenceManifest);await put(evidenceDir,'evidence-manifest.json',evidenceManifestBytes);
    const archiveFiles=[]; archiveFiles.push(await put(archiveDir,'definition/application.apx',await readFile(join(originalDefinitionPath,'application.apx'))));archiveFiles.push(await put(archiveDir,'definition-manifest.json',definitionManifest));
    archiveFiles.push(await put(archiveDir,`sql/f${applicationId}.sql`,Buffer.from(`begin wwv_flow_imp.import_begin(p_default_application_id=>${applicationId});end;\n/\n`)));
    const archiveManifest={mode:'ARCHIVE_ONLY',archiveVerified:true,cleanupPerformed:false,request:archiveRequest,files:archiveFiles}; const archiveManifestBytes=json(archiveManifest);await put(archiveDir,'archive-manifest.json',archiveManifestBytes);
    const snapshotFiles=[];
    for(const [path,value] of [
      ['registry.json',[{APPLICATION_ID:applicationId,WORKSPACE_ID:policy.workspaceId,OWNER_RUN_ID:runId,OWNER_ORGANISM_ID:organismId}]],
      ['orders.json',Array.from({length:40},(_,i)=>({APPLICATION_ID:applicationId,ORDER_ID:1001+i}))],
      ['run.json',[{RUN_ID:runId,STATE:runState,BEST_ORGANISM_ID:bestOrganismId,CURRENT_GENERATION:1,MATERIALIZATIONS:2,MATERIALIZATION_BUDGET:22}]],
      ['organism.json',[{ORGANISM_ID:organismId,RUN_ID:runId,APPLICATION_ID:applicationId,GENOME_JSON:canonicalApplicationGenome(genome),GENOME_HASH:genomeHash,ARTIFACT_HASH:definition.definitionHash,STATE:'SELECTED'}]],
      ['events.json',[{ORGANISM_ID:organismId,STATE:'SELECTED'}]],
      ['import-attempts.json',[{ATTEMPT_ID:attemptId,ORGANISM_ID:organismId,RUN_ID:runId,APPLICATION_ID:applicationId,DEFINITION_HASH:definition.definitionHash,STATE:'VERIFIED'}]],
      ['canaries.json',{applications:[],orders:[]}]
    ]) snapshotFiles.push(await put(snapshotDir,path,value));
    const snapshotManifest={kind:'owned-slot-pre-release-snapshot',request:archiveRequest,identity:observed.identity,files:snapshotFiles};const snapshotManifestBytes=json(snapshotManifest);await put(snapshotDir,'snapshot-manifest.json',snapshotManifestBytes);
    const preservation={archiveDir,archiveManifestSha256:sha(archiveManifestBytes),snapshotDir,snapshotManifestSha256:sha(snapshotManifestBytes),originalDefinitionPath,evidenceDir,evidenceManifestSha256:sha(evidenceManifestBytes)};
    await fn({root,policy:structuredClone(policy),request,observed,preservation,archiveManifest,snapshotManifest,evidenceManifest});
  } finally { if(!resolve(root).startsWith(local+sep))throw new Error('Unsafe synthetic fixture cleanup');await rm(root,{recursive:true,force:true}); }
}
