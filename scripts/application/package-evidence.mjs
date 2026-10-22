// Private staging -> new, immutable public evidence directory. This command
// never imports applications, reads credentials, uploads objects or publishes.
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {LIVING_VERSIONS,loadLivingEvidence,safeLivingPath} from '../../showcase/living-evidence.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_BYTES=8*1024*1024;
const sha=/^[a-f0-9]{64}$/;
const isTest=value=>typeof value==='string'&&/^TEST(?:[-_]|$)/i.test(value);
const inside=(root,path)=>path===root||path.startsWith(root+sep);
function check(ok,message){if(!ok)throw new Error(message);}
function publicationPath(path){
 safeLivingPath(path);
 check(path!=='manifest.json'&&!path.startsWith('candidates/')&&!path.split('/').some(part=>part.startsWith('.')),'Reserved or private publication path');
 check(!/(?:^|[/_-])TEST(?:$|[/_.-])/i.test(path),'TEST evidence cannot be packaged for publication');
 return path;
}

// Screenshots retain their original bytes. Reject metadata that could silently
// carry private browser or machine context; never rewrite experimental evidence.
function assertImageMetadataSafe(bytes,path){
 if(path.endsWith('.png')){
  check(bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Malformed screenshot PNG');let offset=8,ended=false,hasPixels=false;
  while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);check(offset+length+12<=bytes.length,'Malformed screenshot PNG chunk');check(!['tEXt','zTXt','iTXt','eXIf'].includes(type),'Screenshot contains private-capable metadata; supply a clean recorded capture');if(type==='IDAT')hasPixels=true;offset+=length+12;if(type==='IEND'){check(length===0&&offset===bytes.length,'Screenshot has trailing private-capable data');ended=true;break;}}
  check(ended&&hasPixels,'Incomplete screenshot PNG');
 }else if(/\.jpe?g$/.test(path)){
  check(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217,'Malformed JPEG screenshot or trailing private-capable data');
  // APP1 contains EXIF/XMP and COM contains arbitrary comments. Playwright PNG
  // captures are preferred for reproducible application evidence.
  for(let offset=2;offset+4<=bytes.length;){if(bytes[offset]!==255)break;const type=bytes[offset+1];if(type===218||type===217)break;check(type!==225&&type!==254,'Screenshot contains private-capable metadata');const length=bytes.readUInt16BE(offset+2);check(length>=2&&offset+2+length<=bytes.length,'Malformed JPEG screenshot');offset+=2+length;}
 }else if(path.endsWith('.webp')){
  check(bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length,'Malformed WebP screenshot or trailing private-capable data');
  for(let offset=12;offset+8<=bytes.length;){const type=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4);check(offset+8+length<=bytes.length,'Malformed WebP screenshot');check(type!=='EXIF'&&type!=='XMP ','Screenshot contains private-capable metadata');offset+=8+length+(length%2);}
 }
}

/**
 * candidates are already-sanitized objects in the independent Living evidence
 * contract. Paths refer only to explicit source files under inputRoot. No file
 * is discovered by recursively copying the private staging directory.
 */
export async function buildPublicEvidence({candidates,sourceHash,evaluatorHash,inputRoot,outputDir}={}){
 check(Array.isArray(candidates),'Candidate evidence array is required');
 check(sha.test(sourceHash||'')&&sha.test(evaluatorHash||''),'64-character source and evaluator hashes are required');
 check(typeof inputRoot==='string'&&inputRoot.trim()&&typeof outputDir==='string'&&outputDir.trim(),'Input and new output directories are required');
 check(!candidates.some(candidate=>candidate?.testOnly===true||isTest(candidate?.id)||isTest(candidate?.runId)),'TEST candidates cannot be packaged');
 const input=await realpath(resolve(inputRoot)),output=resolve(outputDir);
 check((await lstat(input)).isDirectory(),'Input evidence root must be a directory');
 try{await lstat(output);throw new Error('A new output directory is required; output already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 const files=new Map(),portableNames=new Map();
 function add(path,bytes){
  const portable=path.toLowerCase();check(!portableNames.has(portable)||portableNames.get(portable)===path,'Case-colliding publication paths');portableNames.set(portable,path);
  if(files.has(path)){check(files.get(path).equals(bytes),'Conflicting publication file paths');return;}
  check(bytes.length>0&&bytes.length<=MAX_BYTES,'Evidence file exceeds its size limit');files.set(path,bytes);
 }
 async function sourceFile(path){
  publicationPath(path);if(files.has(path))return files.get(path);
  const full=resolve(input,...path.split('/'));check(inside(input,full)&&full!==input,'Evidence path escapes private staging root');
  let current=input;
  for(const part of path.split('/')){current=join(current,part);const entry=await lstat(current);check(!entry.isSymbolicLink(),'Symbolic links are not permitted in publication evidence');}
  const actual=await realpath(full);check(inside(input,actual),'Evidence file resolves outside the staging root');const info=await lstat(actual);check(info.isFile()&&info.size>0&&info.size<=MAX_BYTES,'Invalid evidence file size or type');
  const bytes=await readFile(actual);add(path,bytes);return bytes;
 }
 for(const candidate of candidates){
  check(candidate&&typeof candidate==='object'&&!Array.isArray(candidate),'Invalid candidate evidence');
  await sourceFile(candidate.genomePath);
  if(candidate.artifactPath!==null){const artifact=await sourceFile(candidate.artifactPath);if(candidate.artifactPath.endsWith('.json')){const index=JSON.parse(artifact.toString('utf8'));check(index&&Array.isArray(index.files),'Invalid artifact bundle index');for(const path of index.files)await sourceFile(path);}}
  for(const observation of [candidate.validation,candidate.import,candidate.runtime,...Object.values(candidate.tasks||{})])if(observation!==null&&observation!==undefined)await sourceFile(observation.evidence);
  if(candidate.fitnessEvidence!==null&&candidate.fitnessEvidence!==undefined)await sourceFile(candidate.fitnessEvidence);
  check(Array.isArray(candidate.screenshots),'Screenshot evidence array is required');for(const screenshot of candidate.screenshots){const bytes=await sourceFile(screenshot.path);assertImageMetadataSafe(bytes,screenshot.path);}
  check(typeof candidate.id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(candidate.id),'Invalid candidate id');add('candidates/'+candidate.id+'.json',Buffer.from(JSON.stringify(candidate)));
 }
 const ordered=[...files].sort(([a],[b])=>a<b?-1:a>b?1:0);
 const manifest={...LIVING_VERSIONS,sourceHash,evaluatorHash,candidates:candidates.map(candidate=>'candidates/'+candidate.id+'.json').sort(),files:ordered.map(([path,bytes])=>({path,sha256:digest(bytes),bytes:bytes.length}))};
 const manifestBytes=Buffer.from(JSON.stringify(manifest));
 const virtualRoot='https://publication.invalid/evidence/';
 async function verify(reader){
  return loadLivingEvidence('evidence/manifest.json',{baseUrl:'https://publication.invalid/living.html',expectedManifestSha256:digest(manifestBytes),fetcher:async url=>{const target=new URL(url);check(target.href.startsWith(virtualRoot),'Invalid verification evidence origin');const path=target.href.slice(virtualRoot.length),bytes=path==='manifest.json'?manifestBytes:await reader(path);return new Response(bytes,{status:200,headers:{'content-length':String(bytes.length)}});}});
 }
 // Reject incomplete, contradictory or private evidence before creating output.
 const verified=await verify(async path=>{check(files.has(path),'Unlisted publication verification file');return files.get(path);});
 await mkdir(dirname(output),{recursive:true});await mkdir(output); // Exclusive claim, no merge or overwrite.
 for(const [path,bytes]of ordered){const destination=join(output,...path.split('/'));await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes,{flag:'wx'});}
 // Verify physical output bytes through the exact public loader. The manifest
 // is the final file, so an interrupted write never looks like a complete set.
 await verify(async path=>{safeLivingPath(path);return readFile(join(output,...path.split('/')));});
 await writeFile(join(output,'manifest.json'),manifestBytes,{flag:'wx'});
 return {verified:true,manifest,outputDir:output,manifestPath:join(output,'manifest.json'),manifestSha256:digest(manifestBytes),verifiedCandidates:verified.candidates.length,files:ordered.length,bytes:ordered.reduce((sum,[,bytes])=>sum+bytes.length,0)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const [inputRoot,requestPath,outputDir]=process.argv.slice(2);check(inputRoot&&requestPath&&outputDir,'Usage: node scripts/application/package-evidence.mjs <inputRoot> <sanitized-request.json> <newOutputDir>');
  const request=JSON.parse(await readFile(resolve(requestPath),'utf8'));check(request&&Object.keys(request).length===3&&['candidates','sourceHash','evaluatorHash'].every(key=>Object.hasOwn(request,key)),'Request must contain only candidates, sourceHash and evaluatorHash');
  const result=await buildPublicEvidence({...request,inputRoot,outputDir});console.log(JSON.stringify({...result,manifest:undefined},null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
