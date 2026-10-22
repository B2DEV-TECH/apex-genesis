import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {startServer} from '../../scripts/serve.mjs';
import {safeLivingPath} from '../../showcase/living-evidence.mjs';

// This checks the actual shipped empty experience. It creates no experimental
// records and writes no screenshots that could be mistaken for APEX evidence.
const server=await startServer(0),base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:process.env.APXGEN_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)}),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
let checks=0;
let recordedCandidates=0,replayedCandidates=0;
try{
 const response=await page.goto(base+'/living.html');assert.equal(response.status(),200);await page.getByRole('heading',{name:'Applications grow through evidence.'}).waitFor();checks++;
 assert.equal(await page.getByRole('link',{name:'Interface Evolution',exact:true}).getAttribute('href'),'./index.html');assert.equal(await page.getByRole('link',{name:'Continuous Evolution',exact:true}).getAttribute('href'),'./live.html');assert.equal(await page.getByRole('link',{name:'Living Applications',exact:true}).getAttribute('aria-current'),'page');checks++;
 assert.match(await page.locator('#empty-state').textContent(),/no materialized descendants yet/i);assert.equal(await page.locator('#recorded-experience').isVisible(),false);assert.equal(await page.locator('#evidence-images img').count(),0);assert.equal(await page.getByRole('button',{name:/play|start|evolve|create/i}).count(),0);checks++;
 assert.equal(await page.locator('meta[name="genesis-evidence-manifest"]').count(),0);checks++;
 for(const name of ['Create','Evolve','Watch'])assert.equal(await page.getByRole('heading',{name,exact:true}).count(),1);checks++;
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);checks++;
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.getByRole('link',{name:'Continuous Evolution',exact:true}).isVisible(),true);checks++;
 await page.goto(base+'/living.html?dataset=../private.json');await page.getByRole('status').filter({hasText:/could not be verified/i}).waitFor();assert.equal(await page.locator('#recorded-experience').isVisible(),false);assert.equal(await page.locator('#evidence-images img').count(),0);checks++;
 await page.goto(base+'/living.html?dataset=missing.json&manifestSha256=unknown');await page.getByRole('status').filter({hasText:/could not be verified/i}).waitFor();assert.equal(await page.locator('#recorded-experience').isVisible(),false);checks++;
 // Optional real package, read directly from private disk through intercepted
 // responses. No fixture bypass, file publication, database or screenshot write.
 if(process.argv[2]){
  const evidenceRoot=resolve(process.argv[2]),manifestBytes=await readFile(join(evidenceRoot,'manifest.json')),manifest=JSON.parse(manifestBytes.toString('utf8'));
  const fileBytes=async path=>{safeLivingPath(path);const absolute=resolve(evidenceRoot,...path.split('/'));assert.ok(absolute.startsWith(evidenceRoot+sep));return readFile(absolute);};
  await page.route('**/__living_recorded__/**',async route=>{try{const path=decodeURIComponent(new URL(route.request().url()).pathname.slice('/__living_recorded__/'.length));await route.fulfill({status:200,body:await fileBytes(path),contentType:path.endsWith('.json')?'application/json':'application/octet-stream'});}catch{await route.fulfill({status:404,body:'Unavailable evidence'});}});
  await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/living.html?dataset=__living_recorded__/manifest.json');await page.getByRole('status').filter({hasText:/Publication verified/i}).waitFor({timeout:30000});
  const candidates=await Promise.all(manifest.candidates.map(async path=>JSON.parse((await fileBytes(path)).toString('utf8'))));assert.ok(candidates.length>0);recordedCandidates=candidates.length;assert.equal(await page.locator('#recorded-experience').isVisible(),true);checks++;
  const firstRun=await page.locator('#run-select').inputValue(),run=candidates.filter(candidate=>candidate.runId===firstRun),replay=run.filter(candidate=>candidate.import?.success===true&&candidate.runtime?.success===true&&candidate.screenshots.length).sort((a,b)=>a.generation-b.generation||a.id.localeCompare(b.id));replayedCandidates=replay.length;
  await page.locator('.ledger-details>summary').click();assert.equal(await page.locator('#candidate-ledger tr').count(),run.length);await page.getByRole('button',{name:'Inspect candidate '+run[0].id,exact:true}).click();assert.match(await page.locator('#outcome-json').textContent(),new RegExp(run[0].id));checks++;
  for(let index=0;index<replay.length;index++){
   if(replay.length>1)await page.locator('#timeline').fill(String(index));
   assert.match(await page.locator('#comparison-note').textContent(),new RegExp('Generation (?:[0-9]+ → )?'+replay[index].generation+'(?: | ·)'));assert.match(await page.locator('#comparison-note').textContent(),new RegExp('Selected: '+(replay[index].selected?'Yes':'No')));
   const image=page.locator('#evidence-images .application-card img').last();await image.scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('#evidence-images img')].every(img=>img.complete&&img.naturalWidth>0));assert.ok(await image.count()>0);checks++;
  }
  if(replay.length>1){await page.locator('#timeline').fill('0');await page.locator('#speed').selectOption('2');await page.getByRole('button',{name:'Play recorded generations',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('#timeline').value)>0);await page.getByRole('button',{name:'Pause recorded generations',exact:true}).click();const paused=await page.locator('#timeline').inputValue();await page.waitForTimeout(600);assert.equal(await page.locator('#timeline').inputValue(),paused);await page.getByRole('button',{name:'Previous recorded generation',exact:true}).click();await page.getByRole('button',{name:'Next recorded generation',exact:true}).click();checks++;}
  const recordedAxe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(recordedAxe.violations.map(v=>({id:v.id,targets:v.nodes.map(node=>node.target)})),[]);checks++;
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);checks++;
  const manifestSha256=createHash('sha256').update(manifestBytes).digest('hex'),sourceHtml=await readFile(new URL('../../showcase/living.html',import.meta.url),'utf8'),pinnedHtml=sourceHtml.replace('</head>','<meta name="genesis-evidence-manifest" content="__living_recorded__/manifest.json"><meta name="genesis-evidence-manifest-sha256" content="'+manifestSha256+'"></head>');
  await page.route(base+'/living.html',route=>route.fulfill({status:200,body:pinnedHtml,contentType:'text/html'}));await page.goto(base+'/living.html');await page.getByRole('status').filter({hasText:/Publication verified/i}).waitFor();assert.equal(await page.locator('#recorded-experience').isVisible(),true);checks++;
  if(replay.length){const corruptPath=replay[0].screenshots[0].path;await page.route('**/__living_recorded__/'+corruptPath,async route=>{const bytes=Buffer.from(await fileBytes(corruptPath));bytes[0]^=1;await route.fulfill({status:200,body:bytes});});await page.reload();await page.getByRole('status').filter({hasText:/could not be verified/i}).waitFor();assert.equal(await page.locator('#recorded-experience').isVisible(),false);assert.equal(await page.locator('#evidence-images img').count(),0);checks++;}
  await page.route('**/__living_recorded__/manifest.json',route=>route.fulfill({status:200,body:JSON.stringify({...manifest,candidates:[]}),contentType:'application/json'}));await page.goto(base+'/living.html');await page.getByRole('status').filter({hasText:/could not be verified/i}).waitFor();assert.equal(await page.locator('#recorded-experience').isVisible(),false);checks++;
 }
 assert.deepEqual(errors,[]);checks++;
 console.log(JSON.stringify({suite:'living-applications-exhibition',checks,passed:true,browser:browser.version(),viewports:[1440,390],actualPackageSupplied:Boolean(process.argv[2]),recordedCandidates,replayedCandidates,experimentalEvidenceCreated:false}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
