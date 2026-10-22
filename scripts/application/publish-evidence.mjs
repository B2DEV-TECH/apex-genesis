// Extends the existing R2 transport with an independent, versioned application
// namespace. Immutable evidence is verified before the mutable pointer moves.
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,sep,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadLivingEvidence,safeLivingPath} from '../../showcase/living-evidence.mjs';
import {resolveTarget} from '../../runtime/publisher.mjs';
import {acquireLock,releaseLock} from '../../runtime/lib.mjs';
import {assertImageMetadataSafe} from './package-evidence.mjs';

export const APPLICATION_PUBLICATION_PREFIX='genesis/living/v1/';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const missing=error=>error.code==='ENOENT'||error.status===404;
const inside=(root,file)=>file.startsWith(root+sep);
const contentType=path=>path.endsWith('.png')?'image/png':/\.jpe?g$/.test(path)?'image/jpeg':path.endsWith('.webp')?'image/webp':path.endsWith('.json')?'application/json':path.endsWith('.css')?'text/css; charset=utf-8':'text/plain; charset=utf-8';
function pointerValid(bytes){
 const pointer=JSON.parse(bytes.toString('utf8'));
 check(Object.keys(pointer).sort().join(',')==='manifest,previousSha256,publishedAt,schema'&&pointer.schema==='genesis-application-pointer-1','Invalid previous application pointer');
 check(pointer.manifest&&Object.keys(pointer.manifest).sort().join(',')==='key,sha256'&&/^[a-f0-9]{64}$/.test(pointer.manifest.sha256)&&pointer.manifest.key==='packages/'+pointer.manifest.sha256+'/manifest.json','Invalid application manifest pointer');
 check(Number.isFinite(Date.parse(pointer.publishedAt))&&(pointer.previousSha256===null||/^[a-f0-9]{64}$/.test(pointer.previousSha256)),'Invalid application pointer metadata');
 return pointer;
}

export async function publishApplicationEvidence({packageDir,workingDir,target}={}){
 check(typeof packageDir==='string'&&typeof workingDir==='string'&&typeof target?.put==='function'&&typeof target?.getBytes==='function','Package, fresh working directory and existing publication target are required');
 const root=await realpath(resolve(packageDir)),work=resolve(workingDir);
 check(!inside(root,work)&&work!==root,'Publication work must be outside the immutable package');
 const files=new Map();
 async function local(path){
  safeLivingPath(path);let current=root;
  for(const part of path.split('/')){current=join(current,part);const stat=await lstat(current);check(!stat.isSymbolicLink(),'Publication refuses symbolic links');}
  check(inside(root,await realpath(current)),'Evidence resolves outside the package');const stat=await lstat(current);check(stat.isFile()&&stat.size>0&&stat.size<=8*1024*1024,'Invalid publication file size');
  return readFile(current);
 }
 const manifestBytes=await local('manifest.json'),manifestHash=digest(manifestBytes);
 const base='https://publication.invalid/evidence/';
 const evidence=await loadLivingEvidence('evidence/manifest.json',{baseUrl:'https://publication.invalid/living.html',expectedManifestSha256:manifestHash,fetcher:async value=>{
  const url=new URL(value);check(url.href.startsWith(base),'Invalid publication origin');const path=url.href.slice(base.length),bytes=path==='manifest.json'?manifestBytes:await local(path);files.set(path,bytes);return new Response(bytes,{status:200,headers:{'content-length':String(bytes.length)}});
 }});
 check(evidence.candidates.length>0,'Cannot publish an empty application experiment');
 const manifest=JSON.parse(manifestBytes.toString('utf8'));
 for(const candidate of evidence.candidates)for(const screenshot of candidate.screenshots)assertImageMetadataSafe(files.get(screenshot.path),screenshot.path);
 // A listed but unreferenced file has not passed the loader's content checks.
 // Refuse it rather than treating a matching hash as permission to upload it.
 for(const entry of manifest.files){check(files.has(entry.path),'Unreferenced publication file');const bytes=files.get(entry.path);check(bytes.length===entry.bytes&&digest(bytes)===entry.sha256,'Publication file hash mismatch');}
 files.set('manifest.json',manifestBytes);
 const prefix=APPLICATION_PUBLICATION_PREFIX+'packages/'+manifestHash+'/',pointerKey=APPLICATION_PUBLICATION_PREFIX+'latest.json';
 let previous=null;
 try{previous=await target.getBytes(pointerKey);const p=pointerValid(previous),oldManifest=await target.getBytes(APPLICATION_PUBLICATION_PREFIX+p.manifest.key);check(digest(oldManifest)===p.manifest.sha256,'Previous pointer does not reference a verified manifest');}catch(error){if(!missing(error))throw error;check(previous===null,'Previous manifest is unavailable');}
 await mkdir(work,{recursive:false});
 const ordered=[...files].sort(([a],[b])=>a==='manifest.json'?1:b==='manifest.json'?-1:a.localeCompare(b));
 for(const [path,bytes]of ordered){
  const key=prefix+path;let exists=false;
  try{const remote=await target.getBytes(key);check(digest(remote)===digest(bytes),'Immutable publication collision');exists=true;}catch(error){if(!missing(error))throw error;}
  if(exists)continue;
  const file=join(work,digest(Buffer.from(path))+'.upload');await writeFile(file,bytes,{flag:'wx'});await target.put(key,file,{contentType:contentType(path)});
  check(digest(await target.getBytes(key))===digest(bytes),'Publication readback verification failed');
 }
 // Refuse to replace a pointer that another publisher changed during the upload.
 let observed=null;try{observed=await target.getBytes(pointerKey);}catch(error){if(!missing(error))throw error;}
 check((observed===null&&previous===null)||(observed!==null&&previous!==null&&digest(observed)===digest(previous)),'Application pointer changed concurrently');
 const pointer={schema:'genesis-application-pointer-1',publishedAt:new Date().toISOString(),manifest:{key:'packages/'+manifestHash+'/manifest.json',sha256:manifestHash},previousSha256:previous===null?null:digest(previous)};
 const pointerBytes=Buffer.from(JSON.stringify(pointer)),pointerFile=join(work,'latest.json');await writeFile(pointerFile,pointerBytes,{flag:'wx'});
 try{await target.put(pointerKey,pointerFile,{contentType:'application/json'});check(digest(await target.getBytes(pointerKey))===digest(pointerBytes),'Application pointer verification failed');}
 catch(error){
  if(previous!==null){
   const current=await target.getBytes(pointerKey);
   if(digest(current)===digest(pointerBytes)){const rollback=join(work,'previous.json');await writeFile(rollback,previous,{flag:'wx'});await target.put(pointerKey,rollback,{contentType:'application/json'});check(digest(await target.getBytes(pointerKey))===digest(previous),'Application pointer rollback verification failed');}
   else check(digest(current)===digest(previous),'Application pointer changed concurrently; current value retained');
  }
  throw error;
 }
 const result={verified:true,target:target.name,manifestKey:prefix+'manifest.json',manifestSha256:manifestHash,pointerKey,files:files.size,candidates:evidence.candidates.length};
 await writeFile(join(work,'publication-receipt.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [packageDir,configPath,workingDir]=process.argv.slice(2);let lock;
 try{
  check(packageDir&&configPath&&workingDir,'Usage: node scripts/application/publish-evidence.mjs <verified-package> <existing-publication-config.json> <new-work-directory>');
  const cfg=JSON.parse((await readFile(resolve(configPath),'utf8')).replace(/^\uFEFF/,''));
  check(['DIRECTORY','R2'].includes(cfg.publication?.target),'Explicit existing publication target required');
  if(cfg.publication.target==='R2')check(cfg.publication.bucket==='b2dev-media'&&cfg.publication.publicBase==='https://b2dev.tech/media/','Only the existing B2DEV publication destination is allowed');
  check(typeof cfg.publication.applicationLockPath==='string'&&isAbsolute(cfg.publication.applicationLockPath),'An explicit absolute shared application publisher lock path is required');
  lock=resolve(cfg.publication.applicationLockPath);check(await acquireLock(lock),'Another application publisher holds the local lease');
  const result=await publishApplicationEvidence({packageDir,workingDir,target:resolveTarget(cfg,'APPLICATION_EVIDENCE')});console.log(JSON.stringify(result));
 }catch(error){console.error(error.message);process.exitCode=1;}finally{if(lock)await releaseLock(lock);}
}
