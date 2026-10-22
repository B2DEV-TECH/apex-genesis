import {loadLivingEvidence} from './living-evidence.mjs';

const $=selector=>document.querySelector(selector);
const names={generated:'Generated',validated:'Validated',imported:'Imported','runtime-verified':'Runtime verified',verified:'Tasks verified',ineligible:'Ineligible',rejected:'Rejected','validation-failed':'Validation failed','import-failed':'Import failed','runtime-failed':'Runtime failed','task-failed':'Task failed',ambiguous:'Ambiguous'};
let evidence=null,run=[],generations=[],position=0,timer=null;
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;if(tag==='pre'){node.tabIndex=0;node.setAttribute('role','region');node.setAttribute('aria-label','Recorded candidate evidence');}return node;}
function pause(){if(timer!==null)clearInterval(timer);timer=null;$('#play').textContent='Play';$('#play').setAttribute('aria-label','Play recorded generations');}
function play(){pause();if(generations.length<2)return;if(position===generations.length-1)position=0;renderComparison();$('#play').textContent='Pause';$('#play').setAttribute('aria-label','Pause recorded generations');timer=setInterval(()=>{if(position>=generations.length-1){pause();return;}position++;renderComparison();},1800/Number($('#speed').value));}
function dataImage(screenshot){let binary='';for(let i=0;i<screenshot.bytes.length;i+=8192)binary+=String.fromCharCode(...screenshot.bytes.subarray(i,i+8192));return 'data:'+screenshot.mimeType+';base64,'+btoa(binary);}
function current(){return generations[position];}
function parentOf(candidate){return run.find(item=>item.id===candidate.parentId)||null;}
function screenshotOptions(candidate,parent){const own=candidate.screenshots.map(image=>image.viewport.width+'×'+image.viewport.height),common=[...new Set(parent?own.filter(value=>parent.screenshots.some(image=>image.viewport.width+'×'+image.viewport.height===value)):own)];return common.length?common:['As recorded'];}
function screenshotFor(candidate,viewport){return viewport==='As recorded'?candidate.screenshots[0]:candidate.screenshots.find(image=>image.viewport.width+'×'+image.viewport.height===viewport);}
function card(candidate,title,className,viewport){
 const article=element('article',undefined,'application-card '+className),header=element('header');header.append(element('p',title,'eyebrow'));
 if(!candidate){header.append(element('h3','The recorded origin'));article.append(header,element('p','This application has no parent. A comparison appears when an evidence-verified descendant is published.','origin-note'));return article;}
 header.append(element('h3','Application '+candidate.applicationId),element('p','Generation '+candidate.generation+' · '+candidate.id+' · Oracle score '+(candidate.fitness===null?'unscored':candidate.fitness.toFixed(2))),element('p',names[candidate.status]+' · Selected: '+(candidate.selected?'Yes':'No')));if(candidate.rejectionReason)header.append(element('p',candidate.rejectionReason));article.append(header);
 const screenshot=screenshotFor(candidate,viewport);
 if(screenshot){const figure=element('figure'),image=element('img');image.alt=screenshot.alt;image.loading='lazy';image.decoding='async';image.src=dataImage(screenshot);image.width=screenshot.viewport.width;image.height=screenshot.viewport.height;figure.append(image,element('figcaption','Recorded viewport '+screenshot.viewport.width+'×'+screenshot.viewport.height+' · '+names[candidate.status]));article.append(figure);}
 else article.append(element('p','No matching viewport was recorded for this application.','origin-note'));
 return article;
}
function details(candidate,parent){
 const container=$('#candidate-evidence');container.replaceChildren();
 for(const [title,item]of [['Parent',parent],[parent?'Descendant':'Application',candidate]]){if(!item)continue;container.append(element('h3',title+' · '+item.id));const tasks=element('ul',undefined,'task-results');for(const task of ['locateOrder','filterOrders','updateOrder']){const observation=item.tasks[task],measurement=item.stages['task:'+task],state=observation===null?'not attempted':observation.success===true?'passed':observation.success===false?'failed':'ambiguous';tasks.append(element('li',task+' · '+state+(measurement&&Object.hasOwn(measurement,'actions')?' · '+measurement.actions+' actions · '+measurement.navigationSteps+' navigations':''),'is-'+state.replace(' ','-')));}container.append(tasks);
  container.append(element('pre',JSON.stringify({id:item.id,runId:item.runId,generation:item.generation,parentId:item.parentId,applicationId:item.applicationId,state:item.status,selected:item.selected,rejectionReason:item.rejectionReason||null,fitnessDefinition:evidence.manifest.fitnessDefinition,fitness:item.fitness,eligible:item.stages.fitness?.eligible??null,sourceHash:item.sourceHash,evaluatorHash:item.evaluatorHash,genomeHash:item.genomeHash,artifactHash:item.artifactHash,validation:item.validation,import:item.import,runtime:item.runtime,tasks:item.tasks,taskMeasurements:Object.fromEntries(Object.entries(item.stages).filter(([name,record])=>name.startsWith('task:')&&record).map(([name,record])=>[name,Object.fromEntries(['actions','navigationSteps','elapsedMs'].filter(key=>Object.hasOwn(record,key)).map(key=>[key,record[key]]))])),fitnessEvidence:item.fitnessEvidence,genome:item.genome},null,2)));
 }
}
function renderComparison(keepViewport=false){
 const candidate=current();if(!candidate)return;const parent=parentOf(candidate),options=screenshotOptions(candidate,parent),select=$('#viewport'),previous=select.value;
 if(!keepViewport){select.replaceChildren(...options.map(value=>{const option=element('option',value);option.value=value;return option;}));if(options.includes(previous))select.value=previous;}
 select.disabled=options.length<2;
 const viewport=select.value;$('#evidence-images').replaceChildren(card(parent,'Recorded parent','parent',viewport),card(candidate,parent?'Recorded descendant':'Evidence-verified application','descendant',viewport));
 const taskCount=Object.values(candidate.tasks).filter(task=>task?.success===true).length;
 $('#comparison-note').textContent=(parent?'Generation '+parent.generation+' → '+candidate.generation:'Generation '+candidate.generation+' · recorded origin')+' · '+names[candidate.status]+' · '+taskCount+'/3 tasks passed · Selected: '+(candidate.selected?'Yes':'No')+(viewport==='As recorded'?' · Viewports differ; each screenshot retains its recorded dimensions.':'');
 $('#generation-label').textContent=String(candidate.generation).padStart(3,'0');$('#timeline').value=String(position);$('#back').disabled=position===0;$('#next').disabled=position===generations.length-1;
 details(candidate,parent);
}
function selectRun(){
 pause();run=evidence.candidates.filter(candidate=>candidate.runId===$('#run-select').value);position=0;
 generations=run.filter(candidate=>candidate.import?.success===true&&candidate.runtime?.success===true&&candidate.screenshots.length>0).toSorted((a,b)=>a.generation-b.generation||a.id.localeCompare(b.id));
 $('#outcome-details').hidden=true;$('#outcome-json').textContent='';
 $('#candidate-ledger').replaceChildren(...run.map(candidate=>{const row=element('tr');for(const value of [candidate.generation,candidate.id,candidate.applicationId??'—',names[candidate.status],candidate.selected?'Yes':'No',candidate.fitness===null?'—':candidate.fitness.toFixed(2),candidate.rejectionReason||'—'])row.append(element('td',String(value)));const cell=element('td'),button=element('button','Inspect');button.type='button';button.setAttribute('aria-label','Inspect candidate '+candidate.id);button.addEventListener('click',()=>{$('#outcome-title').textContent='Candidate '+candidate.id+' · '+names[candidate.status];$('#outcome-json').textContent=JSON.stringify({id:candidate.id,runId:candidate.runId,generation:candidate.generation,parentId:candidate.parentId,applicationId:candidate.applicationId,state:candidate.status,selected:candidate.selected,rejectionReason:candidate.rejectionReason||null,genomeHash:candidate.genomeHash,artifactHash:candidate.artifactHash,sourceHash:candidate.sourceHash,evaluatorHash:candidate.evaluatorHash,validation:candidate.validation,import:candidate.import,runtime:candidate.runtime,tasks:candidate.tasks,fitness:candidate.fitness,fitnessEvidence:candidate.fitnessEvidence,eligible:candidate.stages.fitness?.eligible??null,genome:candidate.genome},null,2);$('#outcome-details').hidden=false;$('#outcome-details').open=true;});cell.append(button);row.append(cell);return row;}));
 $('#replay').hidden=generations.length===0;$('#timeline-controls').hidden=generations.length<2;$('#timeline').max=String(Math.max(0,generations.length-1));
 $('#empty-state').hidden=generations.length>0;
 if(generations.length===0){$('#empty-title').textContent='No evidence-verified descendants yet.';$('#empty-description').textContent='Recorded candidate observations are available below. No application has the recorded import, runtime and screenshot evidence required for a replay.';}else{$('#recorded-title').textContent=generations.some(candidate=>candidate.parentId!==null)?'A parent. A descendant. A traceable change.':'The recorded application.';renderComparison();}
}

$('#play').addEventListener('click',()=>timer===null?play():pause());
$('#back').addEventListener('click',()=>{pause();position=Math.max(0,position-1);renderComparison();});
$('#next').addEventListener('click',()=>{pause();position=Math.min(generations.length-1,position+1);renderComparison();});
$('#timeline').addEventListener('input',()=>{pause();position=Number($('#timeline').value);renderComparison();});
$('#speed').addEventListener('change',()=>{if(timer!==null)play();});
$('#viewport').addEventListener('change',()=>renderComparison(true));
$('#run-select').addEventListener('change',selectRun);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
window.addEventListener('pagehide',pause);

// No demo data is supplied. A deployed copy can pin a real immutable manifest
// in metadata; an explicit same-origin ?dataset= path overrides that default.
const params=new URLSearchParams(location.search),explicitDataset=params.has('dataset');
const manifestPath=explicitDataset?params.get('dataset'):document.querySelector('meta[name="genesis-evidence-manifest"]')?.content||null;
const expectedManifestSha256=explicitDataset?params.get('manifestSha256')??undefined:document.querySelector('meta[name="genesis-evidence-manifest-sha256"]')?.content||undefined;
if(manifestPath!==null){
 const status=$('#load-status');status.hidden=false;status.textContent='Verifying recorded application artifacts and task evidence…';
 try{
  evidence=await loadLivingEvidence(manifestPath,{baseUrl:location.href,expectedManifestSha256});
  if(evidence.candidates.length){const runs=[...new Set(evidence.candidates.map(candidate=>candidate.runId))];$('#run-select').replaceChildren(...runs.map(id=>{const option=element('option',id);option.value=id;return option;}));$('#recorded-experience').hidden=false;selectRun();status.textContent='Publication verified. Every displayed application is bound to its recorded source and evidence.';}
  else status.textContent='The manifest is valid. No application candidate evidence has been published yet.';
  const link=$('#manifest-link');link.href=new URL(manifestPath,location.href).href;link.hidden=false;
 }catch{
  pause();evidence=null;$('#recorded-experience').hidden=true;$('#evidence-images').replaceChildren();status.classList.add('is-error');status.textContent='Application evidence could not be verified. No scores or screenshots are displayed.';
 }
}
