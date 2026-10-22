// Actual HTTP deployment check. No route interception, synthetic evidence,
// database, model/provider call or mutation of the published experiment.
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {safeLivingPath} from '../../showcase/living-evidence.mjs';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const manifestSha256='80f6c970568ee4683afe3d48b2dcf8af1066b752ff642d4ebd9242cfe5c659ac';
const manifestPath='/media/genesis/living/v1/packages/'+manifestSha256+'/manifest.json';
const runId='61baf73fb822430bb27310d22c0744e8';
const expected=[{id:'ef731773b1124b1a870ebcc00c28a0ca',applicationId:133,generation:0,parentId:null,selected:true,filters:'above'},{id:'a33d0c2a65404466a10497ea9806ee40',applicationId:130,generation:1,parentId:'ef731773b1124b1a870ebcc00c28a0ca',selected:false,filters:'beside'}];
const tasks=['locateOrder','filterOrders','updateOrder'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export function deployedLivingUrl(value){
 const url=new URL(value);
 assert.equal(url.username,'','Credentials are forbidden in the deployment URL');assert.equal(url.password,'','Credentials are forbidden in the deployment URL');
 assert.equal(url.search,'','The deployed check requires the default pinned dataset');assert.equal(url.hash,'','The deployed check requires the canonical page');
 const production=url.protocol==='https:'&&url.hostname==='b2dev.tech'&&url.port===''&&/^\/genesis\/living(?:\.html)?\/?$/.test(url.pathname);
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.protocol==='http:'&&/^\/(?:genesis\/)?living(?:\.html)?\/?$/.test(url.pathname);
 assert.ok(production||local,'Only the production Living Applications page or a localhost static copy is allowed');return url;
}

export async function checkLivingDeployment(value){
 const requested=deployedLivingUrl(value),reviewRoot=join(repository,'.local','living-deployed-review-'+new Date().toISOString().replace(/[:.]/g,'-'));
 await mkdir(reviewRoot,{recursive:false});
 const browser=await chromium.launch({channel:process.env.APXGEN_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 let checks=0;
 page.on('pageerror',error=>errors.push('pageerror: '+error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push('console: '+message.text()+' '+message.location().url);});
 page.on('response',response=>{if(response.status()>=400&&new URL(response.url()).origin===requested.origin)errors.push('http '+response.status()+': '+new URL(response.url()).pathname);});
 page.on('requestfailed',request=>{if(new URL(request.url()).origin===requested.origin)errors.push('requestfailed: '+new URL(request.url()).pathname+' '+request.failure()?.errorText);});
 async function actualBytes(url){
  assert.equal(url.origin,requested.origin,'Evidence must stay on the page origin');
  const response=await context.request.get(url.href,{maxRedirects:0,timeout:30000});assert.equal(response.status(),200,'Required public object unavailable: '+url.pathname);return response.body();
 }
 async function imagesReady(){
  const images=page.locator('#evidence-images img');assert.ok(await images.count()>0,'Actual application captures are missing');
  for(const image of await images.all())await image.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>[...document.querySelectorAll('#evidence-images img')].every(image=>image.complete&&image.naturalWidth>0),{timeout:30000});
 }
 async function axe(){const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(result.violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)})),[]);checks++;}
 try{
  const response=await page.goto(requested.href,{waitUntil:'domcontentloaded',timeout:60000});assert.equal(response.status(),200);deployedLivingUrl(page.url());assert.equal(new URL(page.url()).origin,requested.origin);checks++;
  await page.getByRole('status').filter({hasText:/Publication verified/i}).waitFor({timeout:60000});assert.equal(await page.locator('#recorded-experience').isVisible(),true);assert.equal(await page.locator('#empty-state').isVisible(),false);checks++;
  assert.equal(await page.locator('meta[name="genesis-evidence-manifest"]').getAttribute('content'),manifestPath);assert.equal(await page.locator('meta[name="genesis-evidence-manifest-sha256"]').getAttribute('content'),manifestSha256);checks++;
  assert.match(await page.locator('.feasibility-result').textContent(),/89\.675/);assert.match(await page.locator('.feasibility-result').textContent(),/retained the parent on the tie/i);assert.match(await page.locator('.feasibility-result').textContent(),/one seed and one generation/i);checks++;
  const manifestUrl=new URL(manifestPath,requested),manifestBytes=await actualBytes(manifestUrl);assert.equal(digest(manifestBytes),manifestSha256);const manifest=JSON.parse(manifestBytes.toString('utf8'));assert.equal(manifest.candidates.length,2);assert.equal(manifest.fitnessDefinition,'order-lab-task-proxy/2.0.0');checks++;
  const entries=new Map(manifest.files.map(entry=>[entry.path,entry])),evidenceRoot=new URL('.',manifestUrl);
  async function publicJson(path){safeLivingPath(path);const entry=entries.get(path);assert.ok(entry,'Public evidence must be manifested');const bytes=await actualBytes(new URL(path,evidenceRoot));assert.equal(bytes.length,entry.bytes);assert.equal(digest(bytes),entry.sha256);return JSON.parse(bytes.toString('utf8'));}
  const candidates=await Promise.all(manifest.candidates.map(publicJson));candidates.sort((a,b)=>a.generation-b.generation);
  for(let index=0;index<expected.length;index++){
   const candidate=candidates[index],observed=expected[index];for(const key of ['id','applicationId','generation','parentId','selected'])assert.equal(candidate[key],observed[key],key+' differs from the genuine feasibility recording');
   assert.equal(candidate.runId,runId);assert.equal(candidate.fitness,89.675);assert.equal(candidate.screenshots.length,3);
   for(const name of ['validation','import','runtime'])assert.equal(candidate[name]?.success,true);
   for(const name of tasks)assert.equal(candidate.tasks[name]?.success,true);
   const genome=await publicJson(candidate.genomePath);assert.equal(genome.traits.filters,observed.filters);
   const fitness=await publicJson(candidate.fitnessEvidence);assert.equal(fitness.authority,'ORACLE');assert.equal(fitness.eligible,true);assert.equal(fitness.score,89.675);assert.equal(fitness.candidateId,candidate.id);checks++;
  }
  assert.equal(candidates[1].fitness,candidates[0].fitness);assert.equal(candidates[1].selected,false);assert.match(candidates[1].rejectionReason,/did not exceed the surviving parent/i);checks++;
  assert.equal(await page.locator('#run-select').inputValue(),runId);assert.equal(await page.locator('#timeline').getAttribute('max'),'1');await page.locator('#timeline').fill('1');assert.match(await page.locator('#comparison-note').textContent(),/Selected: No/);assert.equal(await page.locator('#evidence-images .application-card h3').allTextContents().then(values=>values.join('|')),'Application 133|Application 130');await imagesReady();checks++;
  await page.locator('.ledger-details>summary').click();assert.equal(await page.locator('#candidate-ledger tr').count(),2);
  for(const candidate of candidates){await page.getByRole('button',{name:'Inspect candidate '+candidate.id,exact:true}).click();const details=JSON.parse(await page.locator('#outcome-json').textContent());assert.equal(details.applicationId,candidate.applicationId);assert.equal(details.selected,candidate.selected);assert.equal(details.fitness,89.675);assert.equal(details.eligible,true);}
  assert.equal(await page.locator('#outcome-json').getAttribute('tabindex'),'0');checks++;
  await axe();
  await page.locator('#timeline').fill('0');await page.locator('#speed').selectOption('2');await page.getByRole('button',{name:'Play recorded generations',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#timeline').value==='1');await page.getByRole('button',{name:'Pause recorded generations',exact:true}).click();const paused=await page.locator('#timeline').inputValue();await page.waitForTimeout(1050);assert.equal(await page.locator('#timeline').inputValue(),paused);checks++;
  await page.getByRole('button',{name:'Previous recorded generation',exact:true}).click();assert.equal(await page.locator('#timeline').inputValue(),'0');await page.getByRole('button',{name:'Next recorded generation',exact:true}).click();assert.equal(await page.locator('#timeline').inputValue(),'1');checks++;
  await page.locator('.ledger-details>summary').click();
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:1000});const option=await page.locator('#viewport option').evaluateAll((options,width)=>options.find(option=>option.value.startsWith(String(width)+'\u00d7'))?.value,width);assert.ok(option,'Actual recorded viewport is unavailable');await page.locator('#viewport').selectOption(option);await imagesReady();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Horizontal page overflow at '+width);
   const naturalWidths=await page.locator('#evidence-images img').evaluateAll(images=>images.map(image=>image.naturalWidth));assert.deepEqual(naturalWidths,[width,width]);
   await axe();await page.screenshot({path:join(reviewRoot,'deployed-exhibition-'+width+'.png'),fullPage:true,animations:'disabled'});checks++;
  }
  for(const [name,file]of [['Interface Evolution','index.html'],['Continuous Evolution','live.html']]){
   const link=page.getByRole('link',{name,exact:true});assert.equal(await link.getAttribute('href'),'./'+file);const target=new URL(await link.getAttribute('href'),page.url());assert.equal(target.origin,requested.origin);const historical=await context.request.get(target.href,{timeout:30000});assert.equal(historical.status(),200,name+' must remain available');assert.equal(new URL(historical.url()).origin,requested.origin);assert.match(await historical.text(),/Genesis exhibitions|APEX Genesis/);checks++;
  }
  assert.equal(await page.getByRole('link',{name:'Living Applications',exact:true}).getAttribute('aria-current'),'page');assert.deepEqual(errors,[]);checks++;
  const result={suite:'living-applications-deployed',passed:true,checks,url:page.url(),browser:browser.version(),manifestSha256,runId,applications:[133,130],fitness:89.675,parentRetained:true,viewports:[390,768,1440],reviewRoot,experimentalEvidenceCreated:false,interceptedResponses:false};
  await writeFile(join(reviewRoot,'deployment-review.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
 }catch(error){try{await page.screenshot({path:join(reviewRoot,'failed-deployment-review.png'),fullPage:true,animations:'disabled'});}catch{}throw error;}
 finally{await browser.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{assert.ok(process.argv[2],'Usage: node tests/browser/living-deployed.mjs <https://b2dev.tech/genesis/living.html|localhost-static-url>');console.log(JSON.stringify(await checkLivingDeployment(process.argv[2])));}catch(error){console.error(error);process.exitCode=1;}}
