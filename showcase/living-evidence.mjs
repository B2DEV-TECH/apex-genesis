// Independent application evidence boundary. Historical dashboard schemas,
// scores and renderer are deliberately not used by this reader.
export const LIVING_VERSIONS=Object.freeze({schemaVersion:'1.0',experimentType:'APEX_APPLICATION',genomeSchemaVersion:'2.0',fitnessDefinition:'order-lab-task-proxy/2.0.0'});
export const LIVING_TASKS=Object.freeze(['locateOrder','filterOrders','updateOrder']);
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_-]{1,80}$/;
const MAX_FILE_BYTES=8*1024*1024,MAX_TOTAL_BYTES=64*1024*1024;
const decoder=new TextDecoder('utf-8',{fatal:true});
const traits=Object.freeze({report:['classicReport','interactiveReport'],edit:['page','modal'],filters:['above','beside'],summary:['before','after'],navigation:['side','top'],density:['comfortable','compact']});

function requireValue(ok,message){if(!ok)throw new Error(message);}
function object(value,label){requireValue(value&&typeof value==='object'&&!Array.isArray(value),label+' must be an object');return value;}
function keys(value,required,optional=[],label='Document'){
 object(value,label);const actual=Object.keys(value);
 requireValue(required.every(key=>Object.hasOwn(value,key)),label+' is missing required evidence fields');
 requireValue(actual.every(key=>required.includes(key)||optional.includes(key)),label+' contains an unknown field');
}
function hash(value,label){requireValue(typeof value==='string'&&SHA.test(value),'Invalid '+label+' hash');}
function id(value,label){requireValue(typeof value==='string'&&ID.test(value),'Invalid '+label);}
function publicText(text){
 requireValue(!/https?:\/\/|[A-Za-z]:[\\/]|(?:[?&]|\b)(?:session|p_instance|access_token|claim_token|lease_token)=|BEGIN [A-Z ]*PRIVATE KEY|"(?:password|secret|token|session|cookies|storageState)"\s*:/i.test(text),'Evidence contains a private path, URL, session or credential; public evidence must be sanitized');
}
export function safeLivingPath(path){
 requireValue(typeof path==='string'&&path.length>0&&path.length<=240&&!path.startsWith('/')&&/^[-A-Za-z0-9_./]+$/.test(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Unsafe evidence path');return path;
}
export async function livingDigest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}

// JSON.parse silently discards earlier duplicate properties. Check the bounded
// JSON token tree first so contradictory success/binding fields fail closed.
export function parseLivingJson(text){
 const lexer=/\s+|"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/gy,tokens=[];let cursor=0;
 while(cursor<text.length){lexer.lastIndex=cursor;const match=lexer.exec(text);requireValue(match&&match.index===cursor,'Invalid evidence JSON');cursor=lexer.lastIndex;if(!/^\s+$/.test(match[0]))tokens.push(match[0]);requireValue(tokens.length<=200000,'Evidence JSON token limit exceeded');}
 let index=0;
 function value(depth){
  requireValue(depth<=32,'Evidence JSON nesting limit exceeded');const token=tokens[index++];
  if(token==='{'){
   const seen=new Set();if(tokens[index]==='}'){index++;return;}
   for(;;){const keyToken=tokens[index++];requireValue(keyToken?.startsWith('"'),'Invalid evidence JSON property');const key=JSON.parse(keyToken);requireValue(!seen.has(key),'Duplicate evidence JSON property');seen.add(key);requireValue(tokens[index++]===':','Invalid evidence JSON object');value(depth+1);const next=tokens[index++];if(next==='}')return;requireValue(next===',','Invalid evidence JSON object');}
  }
  if(token==='['){if(tokens[index]===']'){index++;return;}for(;;){value(depth+1);const next=tokens[index++];if(next===']')return;requireValue(next===',','Invalid evidence JSON array');}}
  requireValue(typeof token==='string'&&(token.startsWith('"')||/^(?:true|false|null|-?\d)/.test(token)),'Invalid evidence JSON value');
 }
 value(0);requireValue(index===tokens.length,'Invalid trailing evidence JSON');return JSON.parse(text);
}

// Kept explicit so public static assets need no access outside showcase. The
// unit suite cross-checks this grammar against the private canonical module.
export function canonicalLivingGenome(genome){
 keys(genome,['schemaVersion','application','dataSource','tasks','traits'],[],'Application genome');
 requireValue(genome.schemaVersion==='2.0'&&genome.application==='GENESIS_ORDER_LAB'&&genome.dataSource==='GENESIS_ORDERS_SAFE_V','Unsupported application genome version or boundary');
 requireValue(Array.isArray(genome.tasks)&&genome.tasks.length===3&&LIVING_TASKS.every((task,index)=>genome.tasks[index]===task),'The three fixed tasks must remain unchanged');
 keys(genome.traits,Object.keys(traits),[],'Genome traits');
 for(const [trait,values]of Object.entries(traits))requireValue(values.includes(genome.traits[trait]),'Unsupported genome trait '+trait);
 return JSON.stringify({schemaVersion:'2.0',application:'GENESIS_ORDER_LAB',dataSource:'GENESIS_ORDERS_SAFE_V',tasks:[...LIVING_TASKS],traits:Object.fromEntries(Object.keys(traits).map(key=>[key,genome.traits[key]]))});
}

export function validateLivingManifest(manifest,{allowTestFixtures=false}={}){
 keys(manifest,[...Object.keys(LIVING_VERSIONS),'sourceHash','evaluatorHash','files','candidates'],['testOnly'],'Living manifest');
 for(const [key,value]of Object.entries(LIVING_VERSIONS))requireValue(manifest[key]===value,'Unsupported Living Applications version, experiment type or fitness definition: '+key);
 requireValue(manifest.testOnly===undefined||typeof manifest.testOnly==='boolean','Invalid TEST marker');
 requireValue(!manifest.testOnly||allowTestFixtures,'TEST fixture evidence cannot be published or loaded by the public exhibition');
 hash(manifest.sourceHash,'source');hash(manifest.evaluatorHash,'evaluator');
 requireValue(Array.isArray(manifest.files)&&manifest.files.length<=4096,'Invalid evidence file manifest');
 requireValue(Array.isArray(manifest.candidates)&&manifest.candidates.length<=256,'Invalid candidate manifest');
 const seen=new Set();let total=0;
 for(const file of manifest.files){keys(file,['path','sha256','bytes'],[],'Manifest file');safeLivingPath(file.path);hash(file.sha256,'file');requireValue(!seen.has(file.path),'Duplicate manifest file');seen.add(file.path);requireValue(Number.isInteger(file.bytes)&&file.bytes>0&&file.bytes<=MAX_FILE_BYTES,'Invalid evidence file size');total+=file.bytes;}
 requireValue(total<=MAX_TOTAL_BYTES,'Evidence dataset exceeds the byte limit');
 const candidates=new Set();
 for(const path of manifest.candidates){safeLivingPath(path);requireValue(path.endsWith('.json'),'Candidate evidence path must be JSON');requireValue(seen.has(path),'Candidate evidence file is unlisted');requireValue(!candidates.has(path),'Duplicate candidate evidence path');candidates.add(path);}
 return manifest;
}

const requiredCandidate=['id','runId','generation','parentId','genomePath','artifactPath','genomeHash','artifactHash','applicationId','sourceHash','evaluatorHash','selected','fitness','fitnessEvidence','validation','import','runtime','tasks','screenshots'];
const bindingKeys=['candidateId','runId','applicationId','genomeHash','artifactHash','sourceHash','evaluatorHash'];
function validateCandidate(candidate,manifest){
 keys(candidate,requiredCandidate,['rejectionReason'],'Candidate');id(candidate.id,'candidate id');id(candidate.runId,'run id');
 requireValue(manifest.testOnly===true||!/^TEST(?:[-_]|$)/i.test(candidate.id)&&!/^TEST(?:[-_]|$)/i.test(candidate.runId),'TEST candidate evidence cannot enter a public publication');
 requireValue(Number.isInteger(candidate.generation)&&candidate.generation>=0&&candidate.generation<=1000,'Invalid candidate generation');
 if(candidate.parentId!==null)id(candidate.parentId,'parent id');
 requireValue(candidate.applicationId===null||Number.isInteger(candidate.applicationId)&&candidate.applicationId>0&&candidate.applicationId<=2147483647,'Invalid materialized application id');
 requireValue(typeof candidate.selected==='boolean','Selection must be an explicit boolean');
 requireValue(candidate.fitness===null||(Number.isFinite(candidate.fitness)&&candidate.fitness>=0&&candidate.fitness<=100),'Invalid fitness score');
 for(const key of ['genomeHash','sourceHash','evaluatorHash'])hash(candidate[key],key);
 requireValue(candidate.sourceHash===manifest.sourceHash&&candidate.evaluatorHash===manifest.evaluatorHash,'Candidate source/evaluator hash binding differs from manifest');
 safeLivingPath(candidate.genomePath);requireValue(candidate.genomePath.endsWith('.json'),'Invalid genome path');
 keys(candidate.tasks,LIVING_TASKS,[],'Task results');
 requireValue(Array.isArray(candidate.screenshots)&&candidate.screenshots.length<=6,'Invalid screenshots');
 const unattempted=candidate.import===null&&candidate.runtime===null&&LIVING_TASKS.every(task=>candidate.tasks[task]===null)&&candidate.selected===false&&candidate.fitness===null&&candidate.fitnessEvidence===null&&candidate.screenshots.length===0;
 if(candidate.applicationId===null)requireValue(unattempted,'An import/runtime/task chain requires its allocated application identity');
 if(candidate.artifactPath===null||candidate.artifactHash===null)requireValue(candidate.artifactPath===null&&candidate.artifactHash===null&&candidate.applicationId===null&&candidate.validation===null&&unattempted,'An unattempted genome-only candidate must not claim an application or later evidence');
 else{hash(candidate.artifactHash,'artifactHash');safeLivingPath(candidate.artifactPath);requireValue(/\.(?:apx|json)$/.test(candidate.artifactPath),'Invalid sanitized artifact path');}
 if(candidate.rejectionReason!==undefined&&candidate.rejectionReason!==null){requireValue(typeof candidate.rejectionReason==='string'&&candidate.rejectionReason.length>0&&candidate.rejectionReason.length<=240&&candidate.selected===false,'A rejection reason requires an unselected candidate and bounded text');publicText(candidate.rejectionReason);}
 for(const screenshot of candidate.screenshots){
  keys(screenshot,['path','viewport','alt'],[],'Screenshot');safeLivingPath(screenshot.path);requireValue(/\.(?:png|jpg|jpeg|webp)$/.test(screenshot.path),'Unsupported screenshot format');keys(screenshot.viewport,['width','height'],[],'Screenshot viewport');
  for(const value of Object.values(screenshot.viewport))requireValue(Number.isInteger(value)&&value>=1&&value<=10000,'Invalid screenshot viewport');
  requireValue(typeof screenshot.alt==='string'&&screenshot.alt.length>0&&screenshot.alt.length<=240,'Screenshot needs a bounded description');publicText(screenshot.alt);
 }
}
function evidenceStage(record,observation,stage,candidate){
 const fitness=stage==='fitness',task=stage.startsWith('task:');
 keys(record,[...bindingKeys,'stage','success','completedAt',...(fitness?['authority','definition','eligible','score']:[])],task?['actions','navigationSteps','elapsedMs']:[],'Stage evidence');
 const binding={candidateId:candidate.id,runId:candidate.runId,applicationId:candidate.applicationId,genomeHash:candidate.genomeHash,artifactHash:candidate.artifactHash,sourceHash:candidate.sourceHash,evaluatorHash:candidate.evaluatorHash};
 for(const [key,value]of Object.entries(binding))requireValue(record[key]===value,'Stage evidence binding mismatch: '+key);
 requireValue(record.stage===stage,'Stage evidence has the wrong stage');
 requireValue([true,false,null].includes(record.success)&&record.success===observation.success,'Stage success must match its explicit recorded observation');
 requireValue(typeof record.completedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(record.completedAt)&&Number.isFinite(Date.parse(record.completedAt)),'Stage evidence needs a valid completion time');
 if(fitness){requireValue(record.authority==='ORACLE','Fitness evidence authority must be Oracle');requireValue(record.definition===LIVING_VERSIONS.fitnessDefinition,'Wrong fitness definition');requireValue(typeof record.eligible==='boolean'&&Number.isFinite(record.score)&&record.score>=0&&record.score<=100,'Invalid Oracle fitness evidence');}
 if(task){
  for(const key of ['actions','navigationSteps','elapsedMs'])if(Object.hasOwn(record,key))requireValue(Number.isSafeInteger(record[key])&&record[key]>=0&&record[key]<=(key==='elapsedMs'?3600000:100000),'Invalid measured task counter');
  requireValue(Object.hasOwn(record,'actions')===Object.hasOwn(record,'navigationSteps'),'Task action and navigation counters must be recorded together');
  if(Object.hasOwn(record,'actions'))requireValue(record.navigationSteps<=record.actions&&(record.success!==true||record.actions>0),'Contradictory measured task navigation/action counters');
 }
 return record;
}
function imageType(bytes,path){
 const a=new Uint8Array(bytes),prefix=String.fromCharCode(...a.slice(0,12));
 if(a.length>=24&&a[0]===137&&prefix.slice(1,4)==='PNG'&&path.endsWith('.png'))return 'image/png';
 if(a.length>=4&&a[0]===255&&a[1]===216&&a[2]===255&&/\.jpe?g$/.test(path))return 'image/jpeg';
 if(a.length>=16&&prefix.startsWith('RIFF')&&prefix.slice(8,12)==='WEBP'&&path.endsWith('.webp'))return 'image/webp';
 throw new Error('Screenshot bytes do not match their image format');
}
function statusOf(candidate){
 for(const [key,successStatus]of [['validation','generated'],['import','validated'],['runtime','imported']]){
  const stage=candidate[key];if(stage===null)return successStatus;if(stage.success===false)return key+'-failed';if(stage.success===null)return 'ambiguous';
 }
 const tasks=LIVING_TASKS.map(task=>candidate.tasks[task]);
 if(tasks.some(task=>task?.success===false))return 'task-failed';
 if(tasks.some(task=>task!==null&&task.success===null))return 'ambiguous';
 if(tasks.some(task=>task===null))return 'runtime-verified';
 return 'verified';
}

export async function loadLivingEvidence(manifestPath,{baseUrl=globalThis.location?.href,fetcher=globalThis.fetch,allowTestFixtures=false,expectedManifestSha256}={}){
 safeLivingPath(manifestPath);requireValue(manifestPath.endsWith('.json'),'Manifest evidence path must be JSON');
 if(expectedManifestSha256!==undefined)hash(expectedManifestSha256,'expected manifest');
 const manifestUrl=new URL(manifestPath,baseUrl);requireValue(['https:','http:'].includes(manifestUrl.protocol),'Unsupported evidence origin');
 const root=new URL('.',manifestUrl);
 async function responseBytes(url,limit){
  const response=await fetcher(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});requireValue(response.ok,'Evidence file is unavailable');
  if(response.url)requireValue(new URL(response.url).origin===manifestUrl.origin,'Evidence must remain on its publication origin');
  const advertised=response.headers.get('content-length');if(advertised!==null)requireValue(/^\d+$/.test(advertised)&&Number(advertised)<=limit,'Evidence size exceeds its limit');
  const chunks=[];let size=0;
  if(response.body){const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('Evidence size exceeds its limit');}chunks.push(value);}}finally{reader.releaseLock();}}
  else{const bytes=new Uint8Array(await response.arrayBuffer());size=bytes.length;chunks.push(bytes);}
  requireValue(size>0&&size<=limit,'Evidence size exceeds its limit');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
 }
 const manifestBytes=await responseBytes(manifestUrl,2*1024*1024);if(expectedManifestSha256!==undefined)requireValue(await livingDigest(manifestBytes)===expectedManifestSha256,'Manifest integrity failure: root hash does not match');const manifestText=decoder.decode(manifestBytes);publicText(manifestText);
 const manifest=validateLivingManifest(parseLivingJson(manifestText),{allowTestFixtures});const files=new Map(manifest.files.map(file=>[file.path,file]));const cache=new Map();
 async function read(path){safeLivingPath(path);const expected=files.get(path);requireValue(expected,'Unlisted evidence file: '+path);if(!cache.has(path))cache.set(path,(async()=>{const bytes=await responseBytes(new URL(path,root),expected.bytes);requireValue(bytes.length===expected.bytes&&await livingDigest(bytes)===expected.sha256,'Evidence integrity failure: '+path);return bytes;})());return cache.get(path);}
 async function json(path){requireValue(path.endsWith('.json'),'Stage evidence must be JSON');const text=decoder.decode(await read(path));publicText(text);return parseLivingJson(text);}
 const candidates=[];
 for(const path of manifest.candidates){
  const candidate=await json(path);validateCandidate(candidate,manifest);
  const genomeBytes=await read(candidate.genomePath),genome=parseLivingJson(decoder.decode(genomeBytes));
  requireValue(await livingDigest(genomeBytes)===candidate.genomeHash&&decoder.decode(genomeBytes)===canonicalLivingGenome(genome),'Genome hash or canonical source bytes mismatch');
  if(candidate.artifactPath!==null){
  const artifactBytes=await read(candidate.artifactPath);requireValue(await livingDigest(artifactBytes)===candidate.artifactHash,'Artifact hash binding mismatch');publicText(decoder.decode(artifactBytes));
  // A bundle index may reference sanitized component source files. Every one
  // must be independently included in the immutable publication manifest.
  if(candidate.artifactPath.endsWith('.json')){const bundle=parseLivingJson(decoder.decode(artifactBytes));keys(bundle,['files'],[],'Artifact bundle index');requireValue(Array.isArray(bundle.files)&&bundle.files.length>0&&bundle.files.length<=128,'Invalid artifact bundle');const seen=new Set();for(const file of bundle.files){safeLivingPath(file);requireValue(/\.(?:apx|css)$/.test(file)&&!seen.has(file),'Invalid or duplicate artifact component');seen.add(file);publicText(decoder.decode(await read(file)));}}
  }
  const stages={};let previousTime=-Infinity,gate=true;
  async function stage(observation,name){
   if(observation===null)return null;
   keys(observation,['success','evidence'],[],'Stage observation');requireValue([true,false,null].includes(observation.success),'Stage success must be explicit');safeLivingPath(observation.evidence);
   requireValue(gate,'Evidence chain skips an unsuccessful or missing gate');
   const record=evidenceStage(await json(observation.evidence),observation,name,candidate),time=Date.parse(record.completedAt);requireValue(time>=previousTime,'Evidence chain completion times are out of order');previousTime=time;return record;
  }
  for(const name of ['validation','import','runtime']){stages[name]=await stage(candidate[name],name);gate=gate&&candidate[name]?.success===true;}
  const runtimeGate=gate;
  for(const task of LIVING_TASKS){gate=runtimeGate;stages['task:'+task]=await stage(candidate.tasks[task],'task:'+task);}
  const allTasks=runtimeGate&&LIVING_TASKS.every(task=>candidate.tasks[task]?.success===true);
  if(candidate.fitnessEvidence!==null){safeLivingPath(candidate.fitnessEvidence);requireValue(runtimeGate,'Fitness evidence requires the materialization chain');const fitness=evidenceStage(await json(candidate.fitnessEvidence),{success:true},'fitness',candidate);requireValue(Date.parse(fitness.completedAt)>=previousTime,'Fitness evidence predates task evidence');requireValue((!fitness.eligible||allTasks)&&fitness.score===candidate.fitness&&(fitness.eligible||fitness.score===0),'Oracle fitness eligibility or score does not match candidate evidence');stages.fitness=fitness;}
  else requireValue(candidate.fitness===null,'Fitness score is missing its Oracle evidence');
  requireValue(!candidate.selected||(allTasks&&stages.fitness?.eligible===true&&candidate.fitness!==null),'Selected candidate lacks complete task and Oracle fitness evidence');
  requireValue(candidate.screenshots.length===0||runtimeGate,'Screenshots require successful validation, import and runtime evidence');
  requireValue(!candidate.selected||candidate.screenshots.length>0,'Selected candidate has no recorded screenshot evidence');
  const screenshots=[];
  for(const screenshot of candidate.screenshots){const bytes=await read(screenshot.path);screenshots.push({...screenshot,bytes,mimeType:imageType(bytes,screenshot.path)});}
  let status=statusOf(candidate);if(status==='verified'&&stages.fitness?.eligible===false)status='ineligible';if(candidate.rejectionReason&&status==='generated'&&candidate.artifactPath===null)status='rejected';
  candidates.push({...candidate,genome,status,stages,screenshots});
 }
 const byId=new Map();for(const candidate of candidates){requireValue(!byId.has(candidate.id),'Duplicate candidate id');byId.set(candidate.id,candidate);}
 for(const candidate of candidates){
  if(candidate.parentId===null)requireValue(candidate.generation===0,'A later generation is missing its parent lineage');
  else{const parent=byId.get(candidate.parentId);requireValue(parent&&parent.id!==candidate.id&&parent.runId===candidate.runId&&parent.generation<candidate.generation,'Invalid parent lineage or generation');requireValue(parent.status==='verified'&&parent.selected,'A descendant requires an evidence-verified selected parent');}
 }
 return Object.freeze({manifest,candidates:candidates.toSorted((a,b)=>a.generation-b.generation||a.id.localeCompare(b.id)),testOnly:manifest.testOnly===true});
}
