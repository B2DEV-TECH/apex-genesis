import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {oracledb,rows} from './db.mjs';
import {validateGenome,PALETTES} from '../showcase/renderer/genome.mjs';
import {rendererBundle,verifyBundle} from './renderer-bundle.mjs';
export async function openEvaluator(base='http://127.0.0.1:4173'){
 const response=await fetch(base+'/renderer/preview.html');if(!response.ok)throw new Error('Preview bundle unavailable');
 const executedBundle=await response.text();verifyBundle(executedBundle,await rendererBundle());
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const page=await context.newPage();
 await page.goto(base+'/renderer/preview.html');await page.waitForFunction(()=>!!window.renderGenome);
 const hash=createHash('sha256');for(const path of ['../showcase/renderer/genome.mjs','../showcase/renderer/renderer.mjs','../showcase/renderer/organism.css','./evaluate.mjs','../database/packages/apxgen_fitness.sql'])hash.update(await readFile(new URL(path,import.meta.url)));
 hash.update(executedBundle);hash.update(browser.version());hash.update(JSON.stringify({viewports:[390,768,1440],height:1000,platform:process.platform,version:'fitness-1.0.1'}));
 const environment=hash.digest('hex');
 async function measure(genome){
  if(!validateGenome(genome).valid)throw new Error('Evaluator rejected schema');
  let errors=0;const onError=()=>errors++;page.on('pageerror',onError);
  const results=[];
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:1000});
   results.push(await page.evaluate(g=>{
    const start=performance.now();window.renderGenome(g);void document.body.offsetHeight;
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
    const sections=[...document.querySelectorAll('[data-section]')];let overlap=0;
    for(let i=0;i<sections.length;i++)for(let j=i+1;j<sections.length;j++){const a=sections[i].getBoundingClientRect(),b=sections[j].getBoundingClientRect();if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap++;}
    const controls=[...document.querySelectorAll('a,button,select,summary')];
    const unnamed=controls.filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')&&!(e.id&&document.querySelector('label[for="'+e.id+'"]'))).length;
    const clipped=controls.filter(e=>{const r=e.getBoundingClientRect();return !visible(e)||r.left<-.5||r.right>innerWidth+.5;}).length;
    const missing=['metrics','filters','revenue','orders'].filter(s=>!sections.some(e=>e.dataset.section===s&&visible(e))).length;
    const button=document.querySelector('button');button.focus();const focusVisible=button.matches(':focus-visible')&&getComputedStyle(button).outlineStyle!=='none'?1:0;
    return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1?1:0,overlap,clipped,missing,unnamed,focusVisible,domNodes:document.querySelectorAll('main *').length,renderMs:performance.now()-start};
   },genome));
  }
  page.off('pageerror',onError);
  return {viewportsTested:3,overflow:results.reduce((s,r)=>s+r.overflow,0),overlap:results.reduce((s,r)=>s+r.overlap,0),clipped:results.reduce((s,r)=>s+r.clipped,0),missing:results.reduce((s,r)=>s+r.missing,0),unnamed:results.reduce((s,r)=>s+r.unnamed,0),focusVisible:Math.min(...results.map(r=>r.focusVisible)),domNodes:Math.max(...results.map(r=>r.domNodes)),audit:{performed:false,critical:null},errors,renderMs:results.reduce((s,r)=>s+r.renderMs,0)/3,viewports:results,accessibilityScope:'names,focus,contrast,font,geometry; full axe audit is release validation'};
 }
 return {browser,page,environment,measure,close:()=>browser.close()};
}
export async function evaluatePending(db,run,evaluator){let evaluated=0,cached=0;
 while(true){const claim=await db.execute('begin apxgen_evolution.claim(:run,:id,:token,:genome);end;',{run,id:{dir:oracledb.BIND_OUT,type:oracledb.NUMBER},token:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32},genome:{dir:oracledb.BIND_OUT,type:oracledb.CLOB}});await db.commit();const c=claim.outBinds;if(!c.id)break;
  const text=typeof c.genome==='string'?c.genome:await c.genome.getData();const g=JSON.parse(text);
  const previous=await rows(db,'select e.organism_id,e.measurements from apxgen_evaluations e join apxgen_organisms p on p.organism_id=e.organism_id join apxgen_organisms o on o.fingerprint=p.fingerprint where o.organism_id=:id and e.environment_hash=:env and p.evaluation_state=\'COMPLETE\' order by e.organism_id fetch first 1 row only',{id:c.id,env:evaluator.environment});
  try{let metrics,source=null;if(previous.length){metrics=JSON.parse(previous[0].MEASUREMENTS);source=previous[0].ORGANISM_ID;cached++;}else metrics=await evaluator.measure(g);
   await db.execute('begin apxgen_evolution.submit_evaluation(:id,:token,:env,:metrics,:source);end;',{id:c.id,token:c.token,env:evaluator.environment,metrics:JSON.stringify(metrics),source});await db.commit();evaluated++;
  }catch(error){await db.rollback();await db.execute('begin apxgen_evolution.fail_evaluation(:id,:token,:env,:reason);end;',{id:c.id,token:c.token,env:evaluator.environment,reason:error.message.slice(0,900)});await db.commit();throw error;}
 }
 return {evaluated,cached};
}
