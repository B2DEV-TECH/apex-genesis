// Exact, immutable native evidence. Unknown runs remain states-only.
import {loadLivingEvidence} from './living-evidence.mjs';
import {validateWatch} from './control-contract.mjs';
const runId='c46d109a8952417ea277daa0696ed698';
export const NATIVE_EVIDENCE=Object.freeze({[runId]:Object.freeze({
 requestId:'7bcff90329154f549db36272a84dc707',
 manifestPath:'evidence/'+runId+'/manifest.json',
 manifestSha256:'9884a0b6070d697a828f24193647878fbce13938ba0279ad69299f3568a5427e',
 objects:49,bytes:275656,manifestBytes:8766
})});
const check=value=>{if(!value)throw new TypeError('Native evidence does not match the actual Oracle binding');};

/** Reconcile every API organism, including the rejected challenger, before images. */
export function reconcileNativeEvidence(watch,publication){
 try{validateWatch(watch);}catch{check(false);}
 const entry=NATIVE_EVIDENCE[watch.run?.id];
 check(entry&&watch.request.id===entry.requestId&&watch.request.runId===watch.run.id&&watch.request.state==='COMPLETED'&&watch.run.state==='COMPLETE');
 check(!publication.testOnly&&publication.manifest.fitnessDefinition===watch.run.fitnessDefinition&&publication.candidates.length===watch.organisms.length);
 check(watch.run.materializations===publication.candidates.filter(candidate=>candidate.import?.success===true).length);
 const rows=new Map(watch.organisms.map(row=>[row.id,row]));
 for(const candidate of publication.candidates){
  const row=rows.get(candidate.id);check(row&&candidate.runId===watch.run.id);
  for(const key of ['id','generation','parentId','applicationId','fitness','selected'])check(row[key]===candidate[key]);
  check(row.eligible===candidate.stages.fitness?.eligible&&row.state===(candidate.selected?'SELECTED':'REJECTED'));
  if(candidate.rejectionReason)check(row.reason===candidate.rejectionReason);
 }
 return publication;
}

/** One registered package, one bounded cached load; no external origin or path. */
export function createNativeEvidenceReader({baseUrl,fetcher=globalThis.fetch}={}){
 const base=new URL(baseUrl);check(['http:','https:'].includes(base.protocol)&&!base.username&&!base.password&&(!globalThis.location||base.origin===globalThis.location.origin));let cached=null;
 return async watch=>{
  validateWatch(watch);const entry=NATIVE_EVIDENCE[watch.run?.id];if(!entry)return null;
  const evidenceRoot=new URL('.',new URL(entry.manifestPath,base));
  if(!cached)cached=loadLivingEvidence(entry.manifestPath,{baseUrl:base.href,expectedManifestSha256:entry.manifestSha256,fetcher:async(url,options)=>{
   const target=new URL(url);check(target.origin===base.origin&&target.pathname.startsWith(evidenceRoot.pathname)&&!target.username&&!target.password&&!target.hash&&!target.search);
   return fetcher(target,options);
  }}).then(publication=>{check(publication.manifest.files.length+1===entry.objects&&publication.manifest.files.reduce((bytes,file)=>bytes+file.bytes,0)+entry.manifestBytes===entry.bytes);return publication;});
  return reconcileNativeEvidence(watch,await cached);
 };
}
