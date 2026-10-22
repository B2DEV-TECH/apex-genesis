// Fitness 2.0 browser evaluator.
//
// It renders one organism with the unchanged 1.x renderer bundle and records what a
// user would meet: four realistic tasks, computed legibility, responsive geometry at
// sampled widths, keyboard reach, an axe audit, structure and initial-viewport density.
// It only measures. Oracle (apxgen_fitness_v2) validates the measurements and turns
// them into scores, so a measurement can be reused while the score is always
// recomputed under the run's own fitness definition.
//
// The measurement identity covers everything that can change a measurement and
// nothing that only changes a score (weights, scoring package). It never includes
// the 1.x evaluator, so Fitness 1.x runs keep their original environment hash.
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {validateGenome} from '../showcase/renderer/genome.mjs';
import {ORDERS} from '../showcase/renderer/renderer.mjs';
import {rendererBundle,verifyBundle} from './renderer-bundle.mjs';

export const MEASUREMENT_SCHEMA='genesis-measurements-2.0.0';
export const EVALUATOR_VERSION='2.0.0';
// The evaluator's own copy of the synthetic scenario. Task answers are checked
// against this copy, never against values read from the page or the renderer.
export const FIXTURE=Object.freeze({
 orders:[{name:'Atlas',amount:1280,status:'Ready'},{name:'Beacon',amount:840,status:'Review'},{name:'Cedar',amount:2100,status:'Ready'},{name:'Delta',amount:560,status:'Review'}],
 revenue:[['Jul',1200],['Aug',1580],['Sep',2000]],
 metrics:[['Revenue','$4,780'],['Orders','4'],['Ready','2']],
 note:'All names and transactions are synthetic. Filters affect the order workspace. Revenue shows the complete quarter.'
});
// Selection drives evolution. Assessment is held out: other targets, other widths,
// a wider audit. It is never used for selection.
export const PROFILES=Object.freeze({
 selection:Object.freeze({name:'selection-2.0.0',height:900,sweep:[390,540,640,768,880,1120,1440],core:[390,768,1440],tasks:[[390,844],[1440,900]],
  targets:{order:'Cedar',filter:'Review',month:'Sep'},axeTags:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}),
 assessment:Object.freeze({name:'assessment-2.0.0',height:900,sweep:[360,412,600,1024,1280,1920],core:[360,1024,1920],tasks:[[360,740],[1024,768],[1920,1080]],
  targets:{order:'Delta',filter:'Ready',month:'Jul'},axeTags:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']})
});
const SECTION_LINK={metrics:'Metrics',filters:'Filters',revenue:'Revenue',orders:'Orders'};
const require=createRequire(import.meta.url);

// Installed once in the preview page. Every helper reads computed layout only.
function pageHelpers(){
 const parse=c=>{const m=String(c).match(/rgba?\(([^)]+)\)/);if(!m)return [0,0,0,0];const p=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return [p[0],p[1],p[2],p.length>3?p[3]:1];};
 const over=(top,bottom)=>{const a=top[3];return [top[0]*a+bottom[0]*(1-a),top[1]*a+bottom[1]*(1-a),top[2]*a+bottom[2]*(1-a),1];};
 const lum=c=>{const v=c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);});return .2126*v[0]+.7152*v[1]+.0722*v[2];};
 const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 function background(e){const layers=[];for(let n=e;n&&n.nodeType===1;n=n.parentElement){const c=parse(getComputedStyle(n).backgroundColor);if(c[3]>0){layers.push(c);if(c[3]>=1)break;}}
  let base=[255,255,255,1];for(let i=layers.length-1;i>=0;i--)base=over(layers[i],base);return base;}
 function shown(e){if(!e||!e.isConnected)return false;const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;let opacity=1;
  for(let n=e;n&&n.nodeType===1;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility!=='visible'||s.contentVisibility==='hidden')return false;opacity*=Number(s.opacity);}
  return opacity>=.05;}
 function hit(e){const r=e.getBoundingClientRect();const x=Math.min(innerWidth-1,Math.max(0,r.left+r.width/2)),y=Math.min(innerHeight-1,Math.max(0,r.top+Math.min(r.height/2,12)));const h=document.elementFromPoint(x,y);return !!h&&(h===e||e.contains(h));}
 const inView=r=>r.top>=-.5&&r.bottom<=innerHeight+.5&&r.left>=-.5&&r.right<=innerWidth+.5;
 const union=list=>{const rs=list.map(e=>e.getBoundingClientRect());return {top:Math.min(...rs.map(r=>r.top)),bottom:Math.max(...rs.map(r=>r.bottom)),left:Math.min(...rs.map(r=>r.left)),right:Math.max(...rs.map(r=>r.right))};};
 const controls=()=>[...document.querySelectorAll('main a[href],main button,main select,main summary,main [tabindex]:not([tabindex="-1"])')];
 const g2={cls:0,tamper:null,targets:[]};
 new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)g2.cls+=e.value;}).observe({type:'layout-shift'});
 g2.render=genome=>{const t=performance.now();window.renderGenome(genome);if(g2.tamper)g2.tamper();void document.body.offsetHeight;
  history.replaceState(null,'',location.pathname);window.scrollTo(0,0);if(document.activeElement&&document.activeElement!==document.body)document.activeElement.blur();return performance.now()-t;};
 // Scroll needed, from the current position, to show every element in the list.
 g2.reach=list=>{if(!list.length||!list.every(shown))return {found:false};const before=scrollY;let r=union(list);let need=0;
  if(r.bottom-r.top>innerHeight)need=r.top;else if(r.bottom>innerHeight)need=r.bottom-innerHeight;else if(r.top<0)need=r.top;
  window.scrollTo(0,before+need);r=union(list);const moved=Math.abs(scrollY-before);
  return {found:true,scrollPx:moved,inView:list.every(e=>inView(e.getBoundingClientRect())),hit:list.every(hit),initial:before===0&&need===0};};
 g2.geometry=()=>{const sections=[...document.querySelectorAll('[data-section]')];let overlap=0;
  for(let i=0;i<sections.length;i++)for(let j=i+1;j<sections.length;j++){const a=sections[i].getBoundingClientRect(),b=sections[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap++;}
  const c=controls();const clipped=c.filter(e=>{const r=e.getBoundingClientRect();return !shown(e)||r.left<-.5||r.right>innerWidth+.5;}).length;
  const sizes=c.filter(shown).map(e=>e.getBoundingClientRect());
  const missing=['metrics','filters','revenue','orders'].filter(s=>!sections.some(e=>e.dataset.section===s&&shown(e))).length;
  const unnamed=c.filter(e=>!(e.textContent.trim()||e.getAttribute('aria-label')||(e.id&&document.querySelector('label[for="'+e.id+'"]')?.textContent.trim()))).length;
  return {w:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1?1:0,overlap,clipped,missing,unnamed,
   under24:sizes.filter(r=>r.width<24||r.height<24).length,under44:sizes.filter(r=>r.width<44||r.height<44).length,height:document.documentElement.scrollHeight};};
 g2.legibility=()=>{const items=[];const walker=document.createTreeWalker(document.querySelector('main'),NodeFilter.SHOW_TEXT);
  for(let t=walker.nextNode();t;t=walker.nextNode()){const text=t.textContent.replace(/\s+/g,' ').trim();const e=t.parentElement;if(!text||!e||!shown(e))continue;
   const s=getComputedStyle(e),size=parseFloat(s.fontSize),lh=s.lineHeight==='normal'?1.2:parseFloat(s.lineHeight)/size;
   const range=document.createRange();range.selectNodeContents(t);const lines=new Set([...range.getClientRects()].filter(r=>r.width>0).map(r=>Math.round(r.top))).size||1;
   const color=over(parse(s.color),background(e));
   items.push({chars:text.length,size,lh,contrast:ratio(color,background(e)),lines,truncated:(e.scrollWidth>e.clientWidth+1&&s.overflowX!=='visible')||s.textOverflow==='ellipsis'?1:0});}
  const weighted=items.flatMap(i=>Array(Math.min(i.chars,200)).fill(i.size)).sort((a,b)=>a-b);
  const headings=[...document.querySelectorAll('main h1,main h2,main h3,main h4,main h5,main h6')].filter(shown).map(h=>Number(h.tagName[1]));
  const order=headings.every((l,i)=>i===0||l<=headings[i-1]+1)?1:0;
  const long=items.filter(i=>i.chars>=40).map(i=>i.chars/i.lines);
  return {minFont:Math.min(...items.map(i=>i.size)),medianFont:weighted[Math.floor(weighted.length/2)],minLineHeight:Math.round(Math.min(...items.map(i=>i.lh))*100)/100,
   minContrast:Math.round(Math.min(...items.map(i=>i.contrast))*100)/100,under12:items.filter(i=>i.size<12).length,truncated:items.reduce((s,i)=>s+i.truncated,0),
   headings:headings.length,headingOrder:order,maxLineChars:Math.round(Math.max(0,...long)),textNodes:items.length};};
 g2.density=()=>{const area=innerWidth*innerHeight;let filled=0;for(const s of document.querySelectorAll('[data-section]')){if(!shown(s))continue;const r=s.getBoundingClientRect();
   const w=Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0)),h=Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));filled+=w*h;}
  const sections=[...document.querySelectorAll('[data-section]')].filter(s=>{const r=s.getBoundingClientRect();return shown(s)&&r.top<innerHeight&&r.bottom>0;}).length;
  return {fill:Math.round(Math.min(1,filled/area)*1000)/1000,sectionsInView:sections};};
 // Content integrity against the evaluator's fixture: every order, total and month, as rendered.
 g2.results=()=>[...document.querySelectorAll('.org-results tr:has(td), .org-results li')].filter(shown).map(r=>[...r.children].map(c=>c.textContent.trim()));
 g2.integrity=(fixture,sort)=>{const failures=[];
  const expected=fixture.orders.slice().sort(sort==='value'?(a,b)=>b.amount-a.amount:(a,b)=>a.name.localeCompare(b.name)).map(o=>[o.name,'$'+o.amount,o.status]);
  if(JSON.stringify(g2.results())!==JSON.stringify(expected))failures.push('ORDERS');
  const status=document.querySelector('.org-section [role=status]');if(!status||!shown(status)||status.textContent.trim()!==expected.length+' synthetic orders')failures.push('STATUS');
  const cards=[...document.querySelectorAll('.org-metric')].filter(shown).map(c=>[c.children[0]?.textContent.trim(),c.children[1]?.textContent.trim()]);
  if(JSON.stringify(cards)!==JSON.stringify(fixture.metrics))failures.push('METRICS');
  for(const [month,value]of fixture.revenue){const t=g2.month(month);if(!t||t.value!==value)failures.push('REVENUE_'+month.toUpperCase());}
  const headings=[...document.querySelectorAll('[data-section] > h2')].filter(shown).length;if(headings!==4)failures.push('HEADINGS');
  const note=[...document.querySelectorAll('details p')].map(p=>p.textContent.trim());if(note.length!==1||note[0]!==fixture.note)failures.push('NOTE');
  return failures;};
 // The visible element that states one month's revenue, and the value it states.
 g2.month=month=>{const section=document.querySelector('[data-section=revenue]');if(!section)return null;
  for(const e of section.querySelectorAll('.org-bar-item'))if(shown(e)&&e.textContent.includes(month)){const m=e.textContent.match(/\$([\d,]+)/);return m?{el:e,value:Number(m[1].replace(/,/g,''))}:null;}
  for(const e of section.querySelectorAll('p'))if(shown(e)){const m=e.textContent.match(new RegExp(month+'\\s*\\$([\\d,]+)'));if(m)return {el:e,value:Number(m[1].replace(/,/g,''))};}
  return null;};
 g2.find=(kind,arg)=>{
  if(kind==='order'){const row=[...document.querySelectorAll('.org-results tr:has(td), .org-results li')].find(r=>r.children[0]?.textContent.trim()===arg);return row?[row]:[];}
  if(kind==='form'){const s=document.getElementById('org-status');const label=s&&document.querySelector('label[for="org-status"]');const b=s&&s.form?.querySelector('button[type=submit]');return s&&label&&b?[label,s,b]:[];}
  if(kind==='results'){const s=document.querySelector('.org-section [role=status]');const r=document.querySelector('.org-results');return s&&r?[s,r]:[];}
  if(kind==='month'){const t=g2.month(arg);return t?[t.el]:[];}
  if(kind==='summary'){const s=[...document.querySelectorAll('details > summary')].find(x=>x.textContent.trim()==='Scenario notes');return s?[s]:[];}
  if(kind==='note'){const p=document.querySelector('details[open] > p');return p?[p]:[];}
  return [];};
 g2.reachKind=(kind,arg)=>g2.reach(g2.find(kind,arg));
 // A shortcut counts only when a pointer user can see and hit it at load, and a keyboard user can focus it.
 g2.shortcut=name=>{const nav=[...document.querySelectorAll('nav')].find(n=>n.getAttribute('aria-label')==='Dashboard sections');if(!nav)return false;
  const links=[...nav.querySelectorAll('a[href]')].filter(a=>a.textContent.trim()===name);if(links.length!==1)return false;const a=links[0];
  if(a.closest('[aria-hidden=true]')||a.tabIndex<0||!shown(a)||!inView(a.getBoundingClientRect())||!hit(a))return false;
  const target=document.getElementById(decodeURIComponent(a.hash.slice(1)));return !!target&&shown(target);};
 g2.focusInfo=()=>{const e=document.activeElement;if(!e||e===document.body||!document.querySelector('main').contains(e))return null;const s=getComputedStyle(e);
  const ring=(s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0)||s.boxShadow!=='none';
  return {key:e.tagName+'|'+(e.id||e.textContent.trim().slice(0,40)),ring,inView:inView(e.getBoundingClientRect())};};
 g2.controlKeys=()=>controls().filter(shown).map(e=>e.tagName+'|'+(e.id||e.textContent.trim().slice(0,40)));
 window.__g2=g2;
}

const round=(n,d=1)=>Math.round(n*10**d)/10**d;

export async function openEvaluatorV2(base='http://127.0.0.1:4173',{profile='selection',allowTamper=false}={}){
 const p=PROFILES[profile];if(!p)throw new Error('Unknown evaluation profile');
 if(JSON.stringify(ORDERS)!==JSON.stringify(FIXTURE.orders))throw new Error('Renderer fixture differs from the evaluator fixture');
 const response=await fetch(base+'/renderer/preview.html');if(!response.ok)throw new Error('Preview bundle unavailable');
 const executedBundle=await response.text();verifyBundle(executedBundle,await rendererBundle());
 const axePath=require.resolve('axe-core/axe.min.js'),axeSource=await readFile(axePath,'utf8'),axeVersion=require('axe-core/package.json').version;
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:p.height},reducedMotion:'reduce',deviceScaleFactor:1});const page=await context.newPage();
 await page.goto(base+'/renderer/preview.html');await page.waitForFunction(()=>!!window.renderGenome);
 await page.evaluate(pageHelpers);await page.evaluate(axeSource);
 const hash=createHash('sha256');
 for(const path of ['../showcase/renderer/genome.mjs','../showcase/renderer/renderer.mjs','../showcase/renderer/organism.css','./evaluate-v2.mjs'])hash.update(await readFile(new URL(path,import.meta.url)));
 hash.update(executedBundle);hash.update(axeSource);hash.update(browser.version());
 hash.update(JSON.stringify({schema:MEASUREMENT_SCHEMA,evaluator:EVALUATOR_VERSION,profile:p,fixture:FIXTURE,platform:process.platform,axe:axeVersion,deviceScaleFactor:1,harness:allowTamper?'adversarial':'production'}));
 const environment=hash.digest('hex');
 const identity={schema:MEASUREMENT_SCHEMA,evaluator:EVALUATOR_VERSION,profile:p.name,chromium:browser.version(),axe:axeVersion,platform:process.platform,environment};

 const render=async genome=>page.evaluate(g=>window.__g2.render(g),genome);
 const reachKind=(kind,arg)=>page.evaluate(([k,a])=>window.__g2.reachKind(k,a),[kind,arg]);
 const viewportHeight=()=>page.evaluate(()=>innerHeight);

 // Runs one task by plain scrolling, then by the section shortcut when one is usable,
 // and keeps the cheaper path. Each path starts from a fresh render.
 async function task(genome,section,steps){
  const paths=[];
  for(const via of ['scroll','nav']){
   const ms=await render(genome);void ms;
   if(via==='nav'){
    if(!(await page.evaluate(n=>window.__g2.shortcut(n),SECTION_LINK[section])))continue;
    await page.getByRole('navigation',{name:'Dashboard sections'}).getByRole('link',{name:SECTION_LINK[section],exact:true}).click();
   }
   const r={via,scrollPx:0,interactions:via==='nav'?1:0,initial:true,reach:true,correct:true,failure:null};
   for(const step of steps){
    if(step.reach){const x=await reachKind(step.reach,step.arg);if(!x.found){r.reach=false;r.failure='NOT_FOUND_'+step.reach.toUpperCase();break;}
     r.scrollPx+=x.scrollPx;if(!x.initial)r.initial=false;if(!x.inView||!x.hit){r.reach=false;r.failure='NOT_REACHABLE_'+step.reach.toUpperCase();break;}}
    if(step.act){const before=await page.evaluate(()=>scrollY);const ok=await step.act().then(()=>true,()=>false);if(!ok){r.correct=false;r.failure='ACTION_FAILED';break;}
     r.interactions+=step.count||1;r.scrollPx+=Math.abs((await page.evaluate(()=>scrollY))-before);}
    if(step.check){const failure=await step.check();if(failure){r.correct=false;r.failure=failure;break;}}
   }
   paths.push(r);
  }
  const h=await viewportHeight();
  const cost=x=>x.scrollPx/h+x.interactions;
  const ok=paths.filter(x=>x.reach&&x.correct);
  const best=(ok.length?ok:paths).reduce((a,b)=>cost(b)<cost(a)?b:a);
  return {ok:best.reach&&best.correct?1:0,via:best.via,pages:round(best.scrollPx/h,3),interactions:best.interactions,initial:best.initial?1:0,failure:best.failure||undefined,
   scrollPages:round(paths[0].scrollPx/h,3),navAvailable:paths.length>1?1:0};
 }

 // Tab stops from the top of the page until the predicate matches the focused element.
 async function tabTo(key,limit=40){for(let i=1;i<=limit;i++){await page.keyboard.press('Tab');const f=await page.evaluate(()=>window.__g2.focusInfo());if(f&&f.key===key)return i;}return null;}

 async function keyboard(genome,targets){
  // Full walk: every visible control must be reachable and show a focus indicator.
  await render(genome);const controlKeys=await page.evaluate(()=>window.__g2.controlKeys());const seen=new Map();
  for(let i=0;i<controlKeys.length+6;i++){await page.keyboard.press('Tab');const f=await page.evaluate(()=>window.__g2.focusInfo());if(!f)continue;if(seen.has(f.key))break;seen.set(f.key,f);}
  const unreachable=controlKeys.filter(k=>!seen.has(k)).length,noRing=[...seen.values()].filter(f=>!f.ring).length;
  // Filter by keyboard only.
  await render(genome);let filterOk=0;const toSelect=await tabTo('SELECT|org-status');let filterStops=null;
  if(toSelect!==null){
   const options=['All','Ready','Review'];let presses=0;for(let i=0;i<options.indexOf(targets.filter);i++){await page.keyboard.press('ArrowDown');presses++;}
   const toButton=await tabTo('BUTTON|Apply filter',4);
   if(toButton!==null){await page.keyboard.press('Enter');filterStops=toSelect+presses+toButton+1;
    filterOk=(await filterCheck(genome,targets.filter))?0:1;}
  }
  // Open the notes by keyboard only.
  await render(genome);let notesOk=0;const toSummary=await tabTo('SUMMARY|Scenario notes');let notesStops=null;
  if(toSummary!==null){const open=await page.evaluate(()=>document.querySelector('details').open);if(!open)await page.keyboard.press('Enter');
   notesStops=toSummary+(open?0:1);notesOk=await page.evaluate(()=>document.querySelector('details').open&&!!window.__g2.find('note').length)?1:0;}
  return {focusVisible:noRing===0&&seen.size>0?1:0,controls:controlKeys.length,reached:seen.size,unreachable,noRing,filterOk,filterStops,notesOk,notesStops};
 }

 // Returns null when the order workspace shows exactly the fixture rows for the filter.
 async function filterCheck(genome,filter){
  const expected=FIXTURE.orders.filter(o=>filter==='All'||o.status===filter).sort(genome.behavior.sort==='value'?(a,b)=>b.amount-a.amount:(a,b)=>a.name.localeCompare(b.name)).map(o=>[o.name,'$'+o.amount,o.status]);
  const shown=await page.evaluate(()=>({rows:window.__g2.results(),status:document.querySelector('.org-section [role=status]')?.textContent.trim()}));
  if(JSON.stringify(shown.rows)!==JSON.stringify(expected))return 'WRONG_FILTER_RESULT';
  if(shown.status!==expected.length+' synthetic orders')return 'WRONG_FILTER_STATUS';return null;
 }

 async function audit(){
  const r=await page.evaluate(tags=>window.axe.run(document,{runOnly:{type:'tag',values:tags},resultTypes:['violations']}).then(x=>x.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length}))),p.axeTags);
  const count=impact=>r.filter(v=>v.impact===impact).reduce((s,v)=>s+v.nodes,0);
  return {critical:count('critical'),serious:count('serious'),moderate:count('moderate'),minor:count('minor'),rules:r.map(v=>v.id).sort()};
 }

 async function measure(genome,{tamper=null}={}){
  if(!validateGenome(genome).valid)throw new Error('Evaluator rejected schema');
  if(tamper&&!allowTamper)throw new Error('Tampering is available only to the adversarial test harness');
  await page.evaluate(src=>{window.__g2.tamper=src?new Function(src):null;window.__g2.cls=0;},tamper);
  let errors=0;const onError=()=>errors++;page.on('pageerror',onError);
  try{
   const renders=[];const t=p.targets;
   await page.setViewportSize({width:p.sweep[p.sweep.length-1],height:p.height});renders.push(await render(genome));
   const domNodes=await page.evaluate(()=>document.querySelectorAll('main *').length);
   const sweep=[];for(const width of p.sweep){await page.setViewportSize({width,height:p.height});sweep.push(await page.evaluate(()=>window.__g2.geometry()));}
   const views=[];
   for(const [width,height]of p.tasks){
    await page.setViewportSize({width,height});renders.push(await render(genome));
    const integrity=await page.evaluate(([f,s])=>window.__g2.integrity(f,s),[FIXTURE,genome.behavior.sort]);
    const legibility=await page.evaluate(()=>window.__g2.legibility());
    const density=await page.evaluate(()=>window.__g2.density());
    const axe=await audit();
    const order=FIXTURE.orders.find(o=>o.name===t.order),month=FIXTURE.revenue.find(m=>m[0]===t.month);
    const tasks={
     A:await task(genome,'orders',[{reach:'order',arg:t.order,check:async()=>{const row=await page.evaluate(n=>window.__g2.find('order',n)[0]?.textContent,t.order);return row&&row.includes('$'+order.amount)&&row.includes(order.status)?null:'WRONG_ORDER_VALUE';}}]),
     B:await task(genome,'filters',[{reach:'form'},
      {act:async()=>{await page.getByLabel('Order status',{exact:true}).selectOption(t.filter,{timeout:2000});await page.getByRole('button',{name:'Apply filter',exact:true}).click({timeout:2000});},count:2,check:()=>filterCheck(genome,t.filter)},
      {reach:'results'}]),
     C:await task(genome,'revenue',[{reach:'month',arg:t.month,check:async()=>{const v=await page.evaluate(m=>window.__g2.month(m)?.value,t.month);return v===month[1]?null:'WRONG_REVENUE_VALUE';}}]),
     D:await task(genome,'orders',[{reach:'summary'},
      {act:async()=>{if(!(await page.evaluate(()=>document.querySelector('details')?.open)))await page.locator('details > summary',{hasText:'Scenario notes'}).click({timeout:2000});else throw new Error('open');},count:1},
      {reach:'note'}].map(s=>s))
    };
    // An already open disclosure needs no click: the action step above throws on purpose
    // and is replaced by a plain reach in that case.
    if(tasks.D.failure==='ACTION_FAILED'&&!genome.behavior.collapseDetails)tasks.D=await task(genome,'orders',[{reach:'summary'},{reach:'note'}]);
    const keys=await keyboard(genome,t);
    views.push({w:width,h:height,integrity,legibility,density,axe,tasks,keyboard:keys});
   }
   await page.waitForTimeout(50);
   const cls=await page.evaluate(()=>window.__g2.cls);
   renders.sort((a,b)=>a-b);
   return {schema:MEASUREMENT_SCHEMA,identity:environment,profile:p.name,errors,domNodes,layoutShift:round(cls,4),renderMs:round(renders[Math.floor(renders.length/2)],2),
    core:p.core,sweep,views};
  }finally{page.off('pageerror',onError);}
 }
 return {browser,page,environment,identity,profile:p,measure,close:()=>browser.close()};
}
