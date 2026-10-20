import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {startServer} from './serve.mjs';
import {config} from './db.mjs';
const timeline=JSON.parse(await readFile('.local/video/timeline.json','utf8')),c=await config(),browser=await chromium.launch(),auth=await browser.newContext(),login=await auth.newPage();
const apexBase='http://127.0.0.1:8080/ords/r/'+c.workspace.toLowerCase()+'/apex-genesis/';
await login.goto(apexBase+'genesis-1');await login.locator('#P9999_USERNAME').fill(c.apexUser);await login.locator('#P9999_PASSWORD').fill(c.apexPassword);await login.getByRole('button',{name:'Sign In',exact:true}).click();await login.locator('#genesis-control').waitFor();
const session=await login.evaluate(()=>apex.env.APP_SESSION),storageState=await auth.storageState();await auth.close();
await mkdir('.local/video/capture',{recursive:true});const server=await startServer(0),base='http://127.0.0.1:'+server.address().port,context=await browser.newContext({storageState,viewport:{width:1920,height:1080},recordVideo:{dir:'.local/video/capture',size:{width:1920,height:1080}}}),page=await context.newPage();
const captured=[];let worker,videoRun;
async function publicPage(generation=0){await page.goto(base);await page.waitForFunction(()=>window.genesisState);await page.locator('#timeline').fill(String(generation));await page.waitForFunction(g=>window.genesisState.generation===g,generation);}
async function marker(title){await page.evaluate(title=>{document.querySelector('#production-marker')?.remove();const e=document.createElement('div');e.id='production-marker';e.textContent='REAL BROWSER RECORDING / '+title;e.style.cssText='position:fixed;right:20px;top:8px;z-index:99999;background:#080b10e8;color:#f5a640;border:1px solid #6e4c21;padding:6px 12px;font:11px monospace;letter-spacing:.08em;pointer-events:none';document.body.append(e);},title);}
try{
 const globalStart=Date.now();
 for(const chapter of timeline.chapters){const started=Date.now();console.log('Recording:',chapter.id);captured.push({chapter:chapter.id,actualStartSeconds:(started-globalStart)/1000});
  if(chapter.id==='opening'){await publicPage(0);await marker('RECORDED ORACLE HISTORY');}
  if(chapter.id==='database'){
   await page.goto(apexBase+'genesis-1?session='+session);await page.waitForFunction(()=>document.querySelector('#control-run').options.length>0);
   const created=await page.evaluate(()=>new Promise((resolve,reject)=>apex.server.process('GENESIS_DATA',{x01:'CREATE',x02:'VIDEO real five-generation Darwin run',x03:'GA_ONLY',x04:'20261020',x05:'12',x06:'5'},{dataType:'json',success:resolve,error:reject})));if(!created.runId)throw new Error('Video run creation failed');videoRun=created.runId;
   await page.waitForFunction(id=>[...document.querySelector('#control-run').options].some(x=>x.value===id),videoRun);await page.locator('#control-run').selectOption(videoRun);await marker('ACTUAL DATABASE EXECUTION / WORKER THROTTLED 2s PER GENERATION');
   worker=spawn(process.execPath,['scripts/run-experiment.mjs','--run='+videoRun,'--generation-delay-ms=2000'],{windowsHide:true,stdio:'ignore'});
  }
  if(chapter.id==='genome'){await publicPage(100);await page.locator('#arena-view').scrollIntoViewIfNeeded();await page.getByRole('button',{name:'Inspect organism ↗'}).first().click();await marker('SAME CANONICAL RENDERER / REAL FILTER CONTROLS');await page.getByRole('button',{name:'Tablet',exact:true}).click();await page.waitForTimeout(10000);await page.getByRole('button',{name:'Mobile',exact:true}).click();}
  if(chapter.id==='replay'){await publicPage(0);await page.locator('.time-machine').scrollIntoViewIfNeeded();await page.locator('#speed').selectOption('4');await marker('RECORDED PLAYBACK / 4× TIMELINE');await page.locator('#play').click();}
  if(chapter.id==='lineage'){await publicPage(100);await page.locator('[data-view=tree]').click();await page.locator('#tree-view').scrollIntoViewIfNeeded();await marker('STORED PARENT RELATIONSHIPS');await page.waitForFunction(()=>document.querySelectorAll('#tree-svg g').length>0);await page.locator('#zoom-in').click();await page.waitForTimeout(14000);await page.locator('[data-view=mutation]').click();await page.locator('#mutation-view').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('#mutation-organism').options.length===24);await page.locator('#mutation-organism').selectOption({index:2});await marker('PARENT / OFFSPRING / RECORDED TRAIT DIFFERENCES');}
  if(chapter.id==='ai'){await page.goto(apexBase+'genesis-8?session='+session);await page.locator('#create-experiment').waitFor();await marker('AI DISABLED / NO LIVE MODEL RESULT IN THIS RECORDING');}
  if(chapter.id==='results'){await publicPage(100);await page.locator('[data-view=analytics]').click();await page.locator('#analytics-view').scrollIntoViewIfNeeded();await marker('ACTUAL MEASUREMENTS / DESCRIPTIVE RESULTS');}
  const remaining=chapter.duration*1000-(Date.now()-started);if(remaining<0)throw new Error('Chapter actions exceeded their narration timeline');await page.waitForTimeout(remaining);
 }
 const video=page.video();await context.close();const path=await video.path();await writeFile('.local/video/capture.json',JSON.stringify({path,videoRun,plannedDuration:timeline.duration,chapters:captured,disclosure:'Continuous real browser recording. Planned navigation, captions, synthetic English narration; the genuine five-generation worker has an explicit 2-second demonstration delay. No paid model request.'},null,2));console.log(JSON.stringify({path,videoRun,duration:timeline.duration}));
}finally{await browser.close();server.close();}
