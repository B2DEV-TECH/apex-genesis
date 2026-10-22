import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
const moduleUrl=new URL('../update-control.mjs',import.meta.url);
async function implementation(){const value=await import(moduleUrl.href).catch(()=>null);assert.ok(value,'The guarded UPDATE_ONLY workflow must exist');return value;}
const hash=value=>createHash('sha256').update(value).digest('hex');
const oldHash='7351764d60ec6556adb764aff945922e757d1325032dbe7ca3ed89ad716f7eb5';
function policy(){return {schemaVersion:'1.0',purpose:'NATIVE_CONTROL_UPDATE_ONLY',enabled:true,schema:'APXGEN_ORDER_LAB',workspace:'APXGEN_ORDER_LAB',workspaceId:8303111957118921,applicationId:134,alias:'GENESIS-LIVING-CONTROL',protectedApplicationIds:[120,121,130,131,132,133],expectedDatabase:{databaseName:'FREEPDB1',containerName:'FREEPDB1'},oldDefinitionHash:oldHash,newDefinitionHash:'b'.repeat(64),baselineSha256:'c'.repeat(64),originalAttemptSha256:'d'.repeat(64),originalReceiptSha256:'e'.repeat(64),newCompilerEvidenceSha256:'f'.repeat(64),compilerFingerprint:{executableSha256:'1'.repeat(64),compilerJarSha256:'2'.repeat(64)},mmdVersion:'26.2.0+3479',maxCompilerAgeSeconds:3600,timeoutMs:120000,runtimeTimeoutMs:1000,preservedRequestId:'7bcff90329154f549db36272a84dc707',expectedPrincipal:'GENESIS_TEST',reviewedCompilerWarnings:null,sourceHashes:['apex/living-control/update-control.mjs','runtime/application/coordinator-lock.mjs','runtime/application/resources.mjs','scripts/application/build-definition.mjs','scripts/application/import-definition.mjs','scripts/application/validate-definition.mjs','package-lock.json'].map(path=>({path,sha256:'6'.repeat(64)}))};}
const assets=[{fileName:'control-boot.js',mimeType:'text/javascript',charset:'utf-8',bytes:3,sha256:hash(Buffer.from('abc'))}];
function baseline(){return {formatVersion:'1.0',applicationId:134,oldDefinitionHash:oldHash,metadata:{APPLICATION_ID:134,WORKSPACE:'APXGEN_ORDER_LAB',OWNER:'APXGEN_ORDER_LAB',ALIAS:'GENESIS-LIVING-CONTROL',NAME:'Synthetic TEST_ONLY control'},assets,preservationHashes:{apps:'a'.repeat(64),tables:'b'.repeat(64)},sqlExportSha256:'3'.repeat(64)};}
function state(){return {schema:'APXGEN_ORDER_LAB',sessionUser:'APXGEN_ORDER_LAB',currentUser:'APXGEN_ORDER_LAB',workspace:'APXGEN_ORDER_LAB',workspaceId:8303111957118921,databaseName:'FREEPDB1',containerName:'FREEPDB1',apexContext:false,metadata:baseline().metadata,assets,preservationHashes:baseline().preservationHashes,config:{enabled:1,workerEnabled:0,binding:null,heartbeat:null,schema:'APXGEN_ORDER_LAB',workspaceId:8303111957118921,applicationId:134},activeRequests:0,activeRuns:0,activeImports:0,activeCleanups:0,requests:[{id:policy().preservedRequestId,state:'COMPLETED',runId:'a'.repeat(32)}]};}
function sqlExport(content='616263'){return `begin\nwwv_flow_imp.import_begin(p_default_application_id=>134);\nwwv_flow_imp.g_varchar2_table := wwv_flow_imp.empty_varchar2_table;\nwwv_flow_imp.g_varchar2_table(1) := '${content}';\nwwv_flow_imp_shared.create_app_static_file(\n p_id=>wwv_flow_imp.id(1)\n,p_file_name=>'control-boot.js'\n,p_mime_type=>'text/javascript'\n,p_file_charset=>'utf-8'\n,p_file_content=>wwv_flow_imp.varchar2_to_blob(wwv_flow_imp.g_varchar2_table)\n);\nwwv_flow_imp.import_end;\nend;\n/\n`;}
async function fixture(fn){const base=resolve(tmpdir()),directory=await mkdtemp(join(base,'apxgen-control-update-test-'));try{return await fn(directory);}finally{const target=resolve(directory);assert.ok(target.startsWith(base+sep+'apxgen-control-update-test-'));await rm(target,{recursive:true,force:true});}}
async function setup(directory){const {executeControlUpdate}=await implementation();const log=[],observed=state();let imported=false;const backend={
 async observe(){log.push('observe');return structuredClone(observed);},
 async verifySources(){log.push('source');},
 async archive(){log.push('archive');return {verified:true,oldDefinitionHash:oldHash,sqlExportSha256:baseline().sqlExportSha256,manifestSha256:'4'.repeat(64)};},
 async importApplication(){log.push('IMPORT');imported=true;observed.metadata={...observed.metadata,NAME:'Updated TEST_ONLY control'};observed.assets=[{...assets[0],sha256:'5'.repeat(64)}];return {verified:true,applicationId:134};},
 async verifyNewAssets(actual){log.push('new-assets');assert.equal(imported,true);assert.equal(actual.assets[0].sha256,'5'.repeat(64));},
 async verifyRuntime(){log.push('runtime');return {verified:true,applicationId:134,pageId:3,principalMatches:true,serverCanCreate:true,serverCanStart:false,requestId:policy().preservedRequestId,requestState:'COMPLETED',runState:'COMPLETE',mutatingActions:0,runtimeErrors:0,renderedView:{verified:true,pairedApps:[131,132],viewports:[390,768,1440],packageManifestSha256:'9884a0b6070d697a828f24193647878fbce13938ba0279ad69299f3568a5427e',screenshotBindings:await (await implementation()).nativeControlScreenshotInventory(),localOracleCallbacks:0,accessibilityViolations:0}};},
 async rollback(){log.push('rollback');},async close(){log.push('close');},async releaseLock(){log.push('release');}
 };return {executeControlUpdate,backend,log,observed,args:{policy:policy(),baseline:baseline(),backend,evidenceDir:directory,attemptPath:join(directory,'permanent-attempt.json')}};}

test('update policy defaults disabled and cannot authorize another app, owner, MMD or extra behavior',async()=>{
 const {assertControlUpdatePolicy}=await implementation();assert.equal(assertControlUpdatePolicy({...policy(),enabled:false}),true);assert.throws(()=>assertControlUpdatePolicy({...policy(),enabled:false},{execute:true}));assert.equal(assertControlUpdatePolicy(policy(),{execute:true}),true);
 for(const change of [p=>p.applicationId=120,p=>p.schema='APXGEN_LAB',p=>p.workspaceId=1,p=>p.protectedApplicationIds=[120,121],p=>p.oldDefinitionHash='0'.repeat(64),p=>p.newDefinitionHash=oldHash,p=>p.mmdVersion='other',p=>p.timeoutMs=999999,p=>p.autoRetry=true]){const bad=policy();change(bad);assert.throws(()=>assertControlUpdatePolicy(bad,{execute:true}));}
});
test('old app identity, static bytes, quiescence and completed-request baseline must all match',async()=>{
 const {assertControlUpdateState}=await implementation();assert.equal(assertControlUpdateState(policy(),state(),baseline()),true);
 for(const change of [s=>s.apexContext=true,s=>s.config.workerEnabled=1,s=>s.config.binding='ANY',s=>s.config.heartbeat='NOW',s=>s.activeRequests=1,s=>s.activeRuns=1,s=>s.activeImports=1,s=>s.activeCleanups=1,s=>s.metadata.OWNER='OTHER',s=>s.assets[0].sha256='0'.repeat(64),s=>s.preservationHashes.tables='0'.repeat(64),s=>s.requests[0].state='DRAFT']){const bad=structuredClone(state());change(bad);assert.throws(()=>assertControlUpdateState(policy(),bad,baseline()));}
});
test('full SQL archive must include exact static BLOB payloads and the original application',async()=>{
 const {assertSqlArchiveAssets}=await implementation();assert.equal(assertSqlArchiveAssets(sqlExport(),assets),true);assert.equal(assertSqlArchiveAssets(sqlExport().replace('import_begin(','import_begin ('),assets),true);
 for(const bad of [sqlExport('616264'),sqlExport().replace('application_id=>134','application_id=>120'),sqlExport().replace("p_file_name=>'control-boot.js'","p_file_name=>'other.js'"),sqlExport().replace('wwv_flow_imp.import_end;',''),sqlExport()+sqlExport()])assert.throws(()=>assertSqlArchiveAssets(bad,assets));
});
test('archive and permanent attempt precede the single import, and readback/runtime precede success',async()=>fixture(async directory=>{
 const {executeControlUpdate,args,log}=await setup(directory);const result=await executeControlUpdate(args);assert.equal(result.verified,true);assert.equal(result.updateAttempted,true);
 const marker=JSON.parse(await readFile(args.attemptPath,'utf8'));assert.equal(marker.oldDefinitionHash,oldHash);assert.equal(marker.newDefinitionHash,policy().newDefinitionHash);assert.equal(marker.archiveManifestSha256,'4'.repeat(64));
 assert.ok(log.indexOf('archive')<log.indexOf('IMPORT'));assert.ok(log.indexOf('runtime')<log.indexOf('rollback'));assert.ok(log.indexOf('close')<log.indexOf('release'));assert.equal(log.filter(x=>x==='IMPORT').length,1);
}));
test('failed archive refuses before the permanent attempt and never calls import',async()=>fixture(async directory=>{
 const {executeControlUpdate,args,backend,log}=await setup(directory);backend.archive=async()=>({verified:false});const result=await executeControlUpdate(args);assert.equal(result.verified,false);assert.equal(result.updateAttempted,false);assert.ok(!log.includes('IMPORT'));await assert.rejects(readFile(args.attemptPath));assert.ok(log.includes('release'));
}));
test('post-marker uncertainty retains the permanent marker and lock and blocks any retry',async()=>fixture(async directory=>{
 const {executeControlUpdate,args,backend,log}=await setup(directory);backend.importApplication=async()=>{log.push('IMPORT');throw Error('Synthetic uncertain external outcome');};const first=await executeControlUpdate(args);assert.equal(first.verified,false);assert.equal(first.noRetry,true);assert.equal(first.coordinatorLockRetained,true);assert.ok(!log.includes('release'));
 const second=await executeControlUpdate({...args,evidenceDir:join(directory,'retry')});assert.equal(second.verified,false);assert.equal(log.filter(x=>x==='IMPORT').length,1);assert.equal((await readFile(args.attemptPath,'utf8')).includes('native-control-update-attempt'),true);
}));
test('resource failures cannot skip other closes or release the shared lock',async()=>fixture(async directory=>{
 const {executeControlUpdate,args,backend,log}=await setup(directory);backend.rollback=async()=>{log.push('rollback');throw Error('Synthetic rollback failure');};backend.close=async()=>{log.push('close');throw Error('Synthetic close failure');};const result=await executeControlUpdate(args);assert.equal(result.verified,false);assert.equal(result.coordinatorLockRetained,true);assert.ok(log.includes('rollback'));assert.ok(log.includes('close'));assert.ok(!log.includes('release'));
}));
test('unexpected preserved-state change, wrong authenticated page or substituted image proof cannot be successful',async()=>{
 for(const kind of ['state','page','image'])await fixture(async directory=>{const {executeControlUpdate,args,backend,observed}=await setup(directory);const runtime=backend.verifyRuntime;backend.verifyRuntime=async()=>{const result=await runtime();if(kind==='state')observed.preservationHashes.tables='0'.repeat(64);else if(kind==='page')result.pageId=1;else result.renderedView.screenshotBindings[3].sha256=result.renderedView.screenshotBindings[2].sha256;return result;};const result=await executeControlUpdate(args);assert.equal(result.verified,false);assert.equal(result.noRetry,true);assert.equal(result.coordinatorLockRetained,true);});
});
test('fresh compiler admission rejects stale, future, warning, version and library substitutions',async()=>{
 const {assertControlUpdateCompiler}=await implementation(),p=policy(),now=Date.now(),sqlclPath=resolve('synthetic-sql.exe'),output='Validation successful.\n',current={definitionHash:p.newDefinitionHash,files:[{path:'application.apx',sha256:'a'.repeat(64)}]};
 const evidence={compilerValid:true,status:'compiler_validated',runtimeVerified:false,connected:false,definitionHash:current.definitionHash,files:current.files,observedAt:new Date(now-1000).toISOString(),outputSha256:hash(output),compiler:{version:'SQLcl: Release 26.3.0 Production',executable:sqlclPath,...p.compilerFingerprint,exitCode:0}};
 const options={fingerprint:p.compilerFingerprint,sqlclPath,output,now};assert.equal(assertControlUpdateCompiler(p,evidence,current,options),true);
 for(const change of [e=>e.observedAt=new Date(now-3600001).toISOString(),e=>e.observedAt=new Date(now+1).toISOString(),e=>e.compiler.version='SQLcl: Release 26.2.0',e=>e.compiler.compilerJarSha256='9'.repeat(64),e=>e.compilerValid=false]){const bad=structuredClone(evidence);change(bad);assert.throws(()=>assertControlUpdateCompiler(p,bad,current,options));}
 const warning='Warning: TEST_ONLY\n'+output;assert.throws(()=>assertControlUpdateCompiler(p,{...evidence,outputSha256:hash(warning)},current,{...options,output:warning}));
});
test('owner update SQL requires the old exact static bytes inside SQLcl and cannot create/remove another app',async()=>{
 const {buildControlUpdateSql}=await implementation(),oracle={user:'APXGEN_ORDER_LAB',workspace:'APXGEN_ORDER_LAB',connectString:'localhost:1521/FREEPDB1',password:'SYNTHETIC_TEST_ONLY'};
 const sql=buildControlUpdateSql(policy(),oracle,resolve('synthetic-new-definition'),baseline());assert.match(sql,/Exact existing control target required/);assert.match(sql,/apex_application_static_files/);assert.match(sql,/dbms_crypto\.hash\(file_content,4\)/);assert.match(sql,/disabled worker|required/i);assert.match(sql,/-id 134 -alias GENESIS-LIVING-CONTROL/);assert.ok(!/remove_application|create table|sysdba/i.test(sql));
 assert.throws(()=>buildControlUpdateSql({...policy(),applicationId:130},oracle,resolve('synthetic-new-definition'),baseline()));assert.throws(()=>buildControlUpdateSql(policy(),{...oracle,password:'bad"SQL'},resolve('synthetic-new-definition'),baseline()));
});
test('global update preflight requires exactly one target in the approved workspace and database',async()=>{
 const {parseControlUpdateGlobal}=await implementation(),stdout='CONTROL_COUNT=1\nCONTROL_OWNED=1\nCONTROL_DB=FREEPDB1\nCONTROL_CONTAINER=FREEPDB1\n';const good={stdout,stderr:'',exitCode:0,timedOut:false,spawnError:null};assert.equal(parseControlUpdateGlobal(good).verified,true);
 for(const bad of [{...good,stdout:stdout.replace('COUNT=1','COUNT=0')},{...good,stdout:stdout.replace('OWNED=1','OWNED=0')},{...good,stdout:stdout+'CONTROL_COUNT=1\n'},{...good,timedOut:true}])assert.throws(()=>parseControlUpdateGlobal(bad));
});
test('only the reviewed twenty manifested ignored-source warnings are admissible',async()=>{
 const {assertReviewedNativeWarnings}=await implementation();assert.equal(typeof assertReviewedNativeWarnings,'function');
 const evidence=JSON.parse(await readFile(new URL('../evidence/native-ui-v1/offline-validation.json',import.meta.url),'utf8')),output=await readFile(new URL('../evidence/native-ui-v1/compiler-output.txt',import.meta.url),'utf8');
 const prefix='shared-components/static-files/',packagePrefix=prefix+'evidence/c46d109a8952417ea277daa0696ed698/';
 const packageManifestBytes=await readFile(new URL('../template/'+packagePrefix+'manifest.json',import.meta.url));
 const inventory=await Promise.all(evidence.files.filter(row=>row.path.startsWith(prefix)).map(async row=>({fileName:row.path.slice(prefix.length),bytes:(await readFile(new URL('../template/'+row.path,import.meta.url))).length,sha256:row.sha256})));
 const declarations=await readFile(new URL('../template/shared-components/static-files.apx',import.meta.url),'utf8'),declaredNames=[...declarations.matchAll(/^file "([^"]+)" \(/gm)].map(row=>row[1]);
 const p={...policy(),newDefinitionHash:evidence.definitionHash,reviewedCompilerWarnings:{kind:'IMMUTABLE_NATIVE_SOURCE_ASSETS',packageManifestSha256:hash(packageManifestBytes),outputSha256:hash(output),files:evidence.warningReview.records.map(row=>({path:row.path,sha256:evidence.files.find(file=>file.path===row.path).sha256})).sort((a,b)=>a.path.localeCompare(b.path))}};
 const context={current:{definitionHash:evidence.definitionHash,files:evidence.files},packageManifestBytes,assets:inventory,declaredNames};assert.equal(assertReviewedNativeWarnings(p,output,context).length,20);
 const blocks=[...output.replaceAll('\r\n','\n').matchAll(/^File: [^\n]+\nLine: 0\nColumn: 0\nType: FILE_IGNORED\nWarning: APEXlang source file ignored\.\n/gm)].map(row=>row[0]);
 const imported='Importing application ID: 134 into workspace: APXGEN_ORDER_LAB\nAPEXlang Compile Warnings:\n'+blocks.reverse().join('\n')+'\nImport successful.\n';assert.equal(assertReviewedNativeWarnings(p,imported,context,{importOutput:true}).length,20);
 assert.throws(()=>assertReviewedNativeWarnings(p,imported+'Warning: DB-dependent problem\n',context,{importOutput:true}));assert.throws(()=>assertReviewedNativeWarnings(p,'APEXlang Compile Warnings:\nFile: unknown\nType: NEW\nMessage: changed\nImport successful.\n',context,{importOutput:true}));
 for(const bad of [output.replace('Line: 0','Line: 1'),output.replace('FILE_IGNORED','OTHER_WARNING'),output+'Warning: arbitrary\n',output.replace(/File: [^\r\n]+/,'File: pages/p00001-create.apx')])assert.throws(()=>assertReviewedNativeWarnings(p,bad,context));
 assert.throws(()=>assertReviewedNativeWarnings({...p,reviewedCompilerWarnings:null},output,context));assert.throws(()=>assertReviewedNativeWarnings(p,output,{...context,declaredNames:declaredNames.slice(1)}));assert.throws(()=>assertReviewedNativeWarnings(p,output,{...context,assets:inventory.slice(1)}));
 const changed=structuredClone(p);changed.reviewedCompilerWarnings.files[0].sha256='0'.repeat(64);assert.throws(()=>assertReviewedNativeWarnings(changed,output,context));
});
test('installed MIME and charset must match every trusted static declaration',async()=>{
 const {parseControlStaticDeclarations,assertInstalledControlAssets}=await implementation();assert.equal(typeof parseControlStaticDeclarations,'function');const declaration=parseControlStaticDeclarations('file "module.mjs" (\n mimeType: text/javascript\n charSet: utf-8\n)\nfile "capture.png" (\n mimeType: image/png\n)\n');assert.deepEqual(declaration,[{fileName:'module.mjs',mimeType:'text/javascript',charset:'utf-8'},{fileName:'capture.png',mimeType:'image/png',charset:null}]);const good=declaration.map(row=>({...row,bytes:3,sha256:'a'.repeat(64)}));assert.equal(assertInstalledControlAssets(good,good),true);assert.throws(()=>assertInstalledControlAssets([{...good[0],mimeType:'text/plain'},good[1]],good));assert.throws(()=>assertInstalledControlAssets([{...good[0],charset:null},good[1]],good));
});
test('uncertain auxiliary observer retirement before the marker retains the shared lock',async()=>fixture(async directory=>{
 const {executeControlUpdate,args,backend,log}=await setup(directory);backend.observe=async()=>{const error=Error('Synthetic auxiliary close uncertainty');error.retainLock=true;throw error;};const result=await executeControlUpdate(args);assert.equal(result.verified,false);assert.equal(result.updateAttempted,false);assert.equal(result.coordinatorLockRetained,true);assert.ok(!log.includes('IMPORT'));assert.ok(!log.includes('release'));await assert.rejects(readFile(args.attemptPath));
}));
test('observer rollback failure does not skip close and is propagated as a retained-lock condition',async()=>{
 const {retireControlObserver}=await implementation();assert.equal(typeof retireControlObserver,'function');const calls=[];await assert.rejects(retireControlObserver({rollback:async()=>{calls.push('rollback');throw Error('TEST_ONLY rollback failed');},close:async()=>{calls.push('close');}}),error=>error.retainLock===true);assert.deepEqual(calls,['rollback','close']);
});
test('a hanging owned-browser callback reaches bounded cleanup and retains the permanent attempt',async()=>fixture(async directory=>{
 const {executeControlUpdate,args,backend,log}=await setup(directory);backend.verifyRuntime=async()=>new Promise(()=>{});const started=Date.now(),result=await executeControlUpdate(args);assert.ok(Date.now()-started<5000);assert.equal(result.verified,false);assert.equal(result.failureStage,'AUTHENTICATED_READ_ONLY_WATCH');assert.equal(result.coordinatorLockRetained,true);assert.equal(result.permanentAttemptRetained,true);assert.ok(log.includes('rollback'));assert.ok(log.includes('close'));assert.ok(!log.includes('release'));
}));
