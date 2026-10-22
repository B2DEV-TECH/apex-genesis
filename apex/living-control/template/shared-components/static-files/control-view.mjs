// Local presentation only. This module never calls an Oracle callback.
import {validateWatch} from './control-contract.mjs';
import {createNativeEvidenceReader,NATIVE_EVIDENCE} from './control-evidence.mjs';
const taskNames={locateOrder:'Locate',filterOrders:'Filter',updateOrder:'Update'};
const words=value=>value.toLowerCase().replaceAll('_',' ');
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function field(label,control){const node=element('label',label);node.append(control);return node;}
function button(text,action,label){const node=element('button',text);node.type='button';node.dataset.viewerAction=action;node.setAttribute('aria-label',label);return node;}
function imageData(screenshot){let binary='';for(let offset=0;offset<screenshot.bytes.length;offset+=8192)binary+=String.fromCharCode(...screenshot.bytes.subarray(offset,offset+8192));return 'data:'+screenshot.mimeType+';base64,'+btoa(binary);}

export function createNativeView(root,{baseUrl,fetcher}={}){
 const output=root.querySelector('[data-observation]'),readEvidence=createNativeEvidenceReader({baseUrl,fetcher});
 let epoch=0,timer=null,publication=null,position=0,viewport=1440,comparison,transport,cards,note,range,playButton,back,next,speed,viewportSelect,positionLabel;
 function pause(){if(timer!==null)clearInterval(timer);timer=null;if(playButton){playButton.textContent='Play';playButton.setAttribute('aria-label','Play recorded generations');}}
 function clear(){epoch++;pause();publication=null;output.replaceChildren();}
 function details(watch){
  const advanced=element('details',undefined,'lc-details');advanced.dataset.eventLog='';advanced.append(element('summary','Advanced evidence · '+watch.events.length+' recorded phases'));
  const identity=element('div',undefined,'lc-identities');identity.append(element('p','Request '+watch.request.id));if(watch.run)identity.append(element('p','Oracle run '+watch.run.id+' · '+watch.run.state+' · materializations '+watch.run.materializations+'/'+watch.run.budget));advanced.append(identity);
  const list=element('ol',undefined,'lc-events');for(const event of watch.events){const item=element('li'),time=element('time',event.recordedAt);time.dateTime=event.recordedAt;item.append(time,element('strong',words(event.state)),element('code',event.organismId));list.append(item);}advanced.append(list);output.append(advanced);
 }
 function states(watch){
  const strip=element('div',undefined,'lc-state-strip');strip.dataset.evidenceSummary='';strip.append(element('span','Request '+watch.request.state),element('span',watch.run?'Oracle '+watch.run.state:'No Oracle run linked'),element('span',watch.run?'Applications '+watch.run.materializations+'/'+watch.run.budget:'Evolution has not started'));output.append(strip);
  if(!watch.run){output.append(element('p','No Oracle run is linked. Evolution has not started.','lc-muted'));return;}
  const list=element('div',undefined,'lc-outcomes');
  for(const row of watch.organisms){const card=element('article',undefined,'lc-outcome'),heading='Generation '+row.generation+(row.applicationId===null?'':' · Application '+row.applicationId);card.append(element('h2',heading),element('p',words(row.state),'lc-stage'),element('p',row.fitness===null?'Not evaluated':'Oracle score '+row.fitness));card.append(element('p','Eligible: '+(row.eligible===null?'Not evaluated':row.eligible?'Yes':'No')+' · Selected: '+(row.selected?'Yes':'No'),'lc-muted'));if(row.reason)card.append(element('p',row.reason,'lc-muted'));list.append(card);}output.append(list);
 }
 function card(candidate,title){
  const node=element('article',undefined,'lc-application '+(candidate.selected?'is-selected':'is-challenger')),header=element('header');
  header.append(element('p',title,'lc-eyebrow'),element('h3','Application '+candidate.applicationId),element('p','Generation '+candidate.generation+' · Oracle score '+candidate.fitness,'lc-score'),element('p','Eligible: '+(candidate.stages.fitness.eligible?'Yes':'No')+' · Selected: '+(candidate.selected?'Yes':'No'),'lc-muted'));node.append(header);
  const screenshot=candidate.screenshots.find(image=>image.viewport.width===viewport);if(screenshot){const figure=element('figure'),image=element('img');image.alt=screenshot.alt;image.loading='lazy';image.decoding='async';image.width=viewport;image.height=new DataView(screenshot.bytes.buffer,screenshot.bytes.byteOffset,screenshot.bytes.byteLength).getUint32(20);image.src=imageData(screenshot);figure.append(image,element('figcaption','Recorded at '+viewport+' pixels · account header excluded'));node.append(figure);}
  const tasks=element('ul',undefined,'lc-tasks');for(const [task,label]of Object.entries(taskNames)){const outcome=candidate.tasks[task]?.success;tasks.append(element('li',label+' · '+(outcome===true?'Passed':outcome===false?'Failed':'Unmeasured')));}node.append(tasks);
  if(candidate.rejectionReason)node.append(element('p',candidate.rejectionReason,'lc-reason'));return node;
 }
 function draw(){
  const candidate=publication.candidates[position],parent=publication.candidates.find(item=>item.id===candidate.parentId),pair=parent?[parent,candidate]:[candidate];
  const widths=candidate.screenshots.map(image=>image.viewport.width).filter(width=>pair.every(item=>item.screenshots.some(image=>image.viewport.width===width)));
  if(!widths.includes(viewport))viewport=widths.includes(1440)?1440:widths[0];viewportSelect.replaceChildren();for(const width of widths){const option=element('option',width+' px');option.value=String(width);viewportSelect.append(option);}viewportSelect.value=String(viewport);
  range.value=String(position);positionLabel.textContent='Generation '+candidate.generation;back.disabled=position===0;next.disabled=position===publication.candidates.length-1;
  cards.replaceChildren(...pair.map(item=>card(item,item.id===candidate.parentId?'Recorded parent':parent?'Recorded descendant':'Recorded origin')));cards.classList.toggle('is-origin',!parent);
  const changed=parent?Object.keys(candidate.genome.traits).filter(trait=>candidate.genome.traits[trait]!==parent.genome.traits[trait]):[];
  note.textContent=parent?(changed.length?changed.map(trait=>trait+': '+parent.genome.traits[trait]+' → '+candidate.genome.traits[trait]).join(' · '):'No recorded trait change'):'The verified origin. This application has no earlier parent.';
 }
 function play(){
  if(timer!==null){pause();return;}if(position===publication.candidates.length-1){position=0;draw();}
  playButton.textContent='Pause';playButton.setAttribute('aria-label','Pause recorded generations');timer=setInterval(()=>{position++;draw();if(position>=publication.candidates.length-1)pause();},1800/Number(speed.value));
 }
 function showComparison(watch,verified){
  publication=verified;position=publication.candidates.length-1;viewport=globalThis.innerWidth<=390?390:globalThis.innerWidth<=768?768:1440;
  const parent=publication.candidates.find(candidate=>candidate.selected),child=publication.candidates.find(candidate=>candidate.parentId===parent?.id&&!candidate.selected),tie=child&&parent.fitness===child.fitness&&child.stages.fitness.eligible===true;
  const result=element('section',undefined,'lc-result');result.append(element('p','ORACLE SELECTION / VERIFIED RECORDING','lc-eyebrow'),element('h2',tie?'Oracle retained the parent on the tie.':'Oracle recorded the selection.'),element('p',tie?'Both applications passed Locate, Filter and Update, and scored '+parent.fitness+'. The structural change did not improve this task proxy.':'Inspect the measured outcomes and recorded lineage below.'));output.prepend(result);
  comparison=element('section',undefined,'lc-comparison');comparison.dataset.comparison='';comparison.setAttribute('aria-label','Verified application comparison');
  transport=element('div',undefined,'lc-playback');playButton=button('Play','play','Play recorded generations');playButton.className='lc-primary';back=button('←','back','Previous recorded generation');next=button('→','next','Next recorded generation');speed=element('select');speed.setAttribute('aria-label','Recorded playback speed');for(const value of ['0.5','1','2']){const option=element('option',value+'×');option.value=value;speed.append(option);}speed.value='1';
  range=element('input');range.type='range';range.min='0';range.max=String(publication.candidates.length-1);range.step='1';range.dataset.generation='';range.setAttribute('aria-label','Recorded application generation');positionLabel=element('strong');const timeline=element('div',undefined,'lc-timeline');timeline.append(positionLabel,range);transport.append(playButton,back,next,field('Speed',speed),timeline);transport.hidden=publication.candidates.length<2;comparison.append(transport);
  const controls=element('div',undefined,'lc-comparison-heading');note=element('p');viewportSelect=element('select');viewportSelect.dataset.viewport='';viewportSelect.setAttribute('aria-label','Recorded screenshot viewport');controls.append(note,field('Viewport',viewportSelect));cards=element('div',undefined,'lc-comparison-grid');comparison.append(controls,cards,element('p','These are genuine browser captures. Playback revisits recorded generations; it does not start or advance an experiment.','lc-footnote'));
  playButton.addEventListener('click',play);back.addEventListener('click',()=>{pause();position=Math.max(0,position-1);draw();});next.addEventListener('click',()=>{pause();position=Math.min(publication.candidates.length-1,position+1);draw();});range.addEventListener('input',()=>{pause();position=Number(range.value);draw();});viewportSelect.addEventListener('change',()=>{viewport=Number(viewportSelect.value);draw();});speed.addEventListener('change',()=>{if(timer!==null){pause();play();}});
  const technical=element('details',undefined,'lc-details');technical.append(element('summary','Verified source and task evidence'));technical.append(element('p','Run '+watch.run.id));technical.append(element('p','Source '+publication.manifest.sourceHash),element('p','Evaluator '+publication.manifest.evaluatorHash));const link=element('a','Open the verified evidence manifest');link.href=new URL(NATIVE_EVIDENCE[watch.run.id].manifestPath,baseUrl).href;technical.append(link);comparison.append(technical);
  const outcomes=output.querySelector('.lc-outcomes'),ledger=element('details',undefined,'lc-details');outcomes.before(comparison,ledger);ledger.append(element('summary','All candidate outcomes'),outcomes);draw();
 }
 async function render(watch){
  validateWatch(watch);clear();const version=epoch;states(watch);details(watch);
  if(root.dataset.controlPage!=='watch'||!watch.run)return;
  const pending=element('p','Verifying recorded application source, tasks and screenshots…','lc-evidence-state');output.querySelector('.lc-outcomes').before(pending);
  try{const verified=await readEvidence(watch);if(version!==epoch)return;if(!verified){pending.textContent='No verified screenshots are registered for this Oracle run. Only actual Oracle states are shown.';return;}pending.remove();showComparison(watch,verified);}
  catch{if(version===epoch)pending.textContent='Screenshots are unavailable: recorded evidence could not be verified against these exact Oracle outcomes. Only actual states are shown.';}
 }
 return {render,clear,pause};
}
