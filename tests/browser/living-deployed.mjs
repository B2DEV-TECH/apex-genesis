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
const cohorts={
 original:{manifestSha256:'80f6c970568ee4683afe3d48b2dcf8af1066b752ff642d4ebd9242cfe5c659ac',runId:'61baf73fb822430bb27310d22c0744e8',expected:[{id:'ef731773b1124b1a870ebcc00c28a0ca',applicationId:133,generation:0,parentId:null,selected:true,filters:'above'},{id:'a33d0c2a65404466a10497ea9806ee40',applicationId:130,generation:1,parentId:'ef731773b1124b1a870ebcc00c28a0ca',selected:false,filters:'beside'}]},
 native:{manifestSha256:'9884a0b6070d697a828f24193647878fbce13938ba0279ad69299f3568a5427e',runId:'c46d109a8952417ea277daa0696ed698',sourceHash:'a7716f8103f05840bf201161eb6e4aa2c4ec41f99bfe39c64d2e80ec7dbfb684',evaluatorHash:'46797f474f3acfda7477a15aca3213da85df419b73e7656a459155f276ae46c0',expected:[{id:'01106ccddbf54db78e30d20b1b2dd9a2',applicationId:131,generation:0,parentId:null,selected:true,filters:'above'},{id:'6ac8b82786d94e2d88d10f4bb138d3e4',applicationId:132,generation:1,parentId:'01106ccddbf54db78e30d20b1b2dd9a2',selected:false,filters:'beside'}]}
};
const pathFor=hash=>'/media/genesis/living/v1/packages/'+hash+'/manifest.json';
function knownCohort(name){assert.ok(Object.hasOwn(cohorts,name),'Only the fixed original or native cohort is allowed');return cohorts[name];}
const tasks=['locateOrder','filterOrders','updateOrder'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function verifyRenderedLivingScreenshots(page,{candidates,manifest,viewport}){
 assert.equal(candidates.length,2,'The genuine parent/child pair is required');assert.equal(candidates[1].parentId,candidates[0].id);
 assert.equal(await page.locator('#viewport').inputValue(),viewport.width+'\u00d7'+viewport.height,'The displayed viewport must match the recorded screenshot');
 const cards=page.locator('#evidence-images .application-card'),entries=new Map(manifest.files.map(entry=>[entry.path,entry])),observations=[];
 assert.equal(await cards.count(),2,'Both genuine applications must be displayed');
 for(let index=0;index<candidates.length;index++){
  const candidate=candidates[index],card=cards.nth(index),matches=candidate.screenshots.filter(image=>image.viewport.width===viewport.width&&image.viewport.height===viewport.height);
  assert.equal(matches.length,1,'Exactly one candidate screenshot must match the displayed viewport');const screenshot=matches[0];safeLivingPath(screenshot.path);
  const entry=entries.get(screenshot.path);assert.ok(entry,'The displayed screenshot must be manifested');assert.match(entry.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(entry.bytes)&&entry.bytes>0);
  assert.equal(await card.locator('h3').textContent(),'Application '+candidate.applicationId,'The screenshot card must match its genuine candidate');assert.equal(await card.evaluate((node,role)=>node.classList.contains(role),index===0?'parent':'descendant'),true);
  const image=card.locator('img');assert.equal(await image.count(),1);const displayed=await image.evaluate(node=>({source:node.currentSrc,complete:node.complete,width:node.naturalWidth,height:node.naturalHeight}));
  assert.equal(displayed.complete,true);assert.equal(displayed.width,viewport.width);assert.ok(displayed.height>0);assert.match(displayed.source,/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/,'The displayed screenshot must use PNG bytes from verified evidence');
  const encoded=displayed.source.slice('data:image/png;base64,'.length),bytes=Buffer.from(encoded,'base64');assert.equal(bytes.toString('base64'),encoded,'The displayed PNG encoding must be canonical');
  const binding=' for candidate '+candidate.id+' at '+viewport.width+'\u00d7'+viewport.height;
  assert.equal(bytes.length,entry.bytes,'Displayed screenshot bytes differ'+binding);const sha256=digest(bytes);assert.equal(sha256,entry.sha256,'Displayed screenshot hash differs'+binding);
  observations.push({candidateId:candidate.id,applicationId:candidate.applicationId,viewport:{...viewport},path:screenshot.path,bytes:bytes.length,sha256});
 }
 return observations;
}

export function deployedLivingUrl(value,{cohort='original'}={}){
 const expected=knownCohort(cohort);
 const url=new URL(value);
 assert.equal(url.username,'','Credentials are forbidden in the deployment URL');assert.equal(url.password,'','Credentials are forbidden in the deployment URL');
 assert.equal(url.hash,'','The deployed check requires the canonical page');
 const production=url.protocol==='https:'&&url.hostname==='b2dev.tech'&&url.port===''&&/^\/genesis\/living(?:\.html)?\/?$/.test(url.pathname);
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.protocol==='http:'&&/^\/(?:genesis\/)?living(?:\.html)?\/?$/.test(url.pathname);
 assert.ok(production||local,'Only the production Living Applications page or a localhost static copy is allowed');
 if(cohort==='original')assert.equal(url.search,'','The deployed check requires the default pinned dataset');
 else{
  if(!url.search)url.search='?dataset='+pathFor(expected.manifestSha256)+'&manifestSha256='+expected.manifestSha256;
  assert.equal([...url.searchParams].length,2,'Only the fixed native dataset/hash override is allowed');assert.equal(url.searchParams.get('dataset'),pathFor(expected.manifestSha256),'Unreviewed native dataset forbidden');assert.equal(url.searchParams.get('manifestSha256'),expected.manifestSha256,'Unreviewed native manifest hash forbidden');
 }
 return url;
}

export async function checkLivingDeployment(value,{cohort='original'}={}){
 const configured=knownCohort(cohort),{manifestSha256,runId,expected}=configured,manifestPath=pathFor(manifestSha256);
 const requested=deployedLivingUrl(value,{cohort}),reviewRoot=join(repository,'.local','living-deployed-review-'+new Date().toISOString().replace(/[:.]/g,'-'));
 await mkdir(reviewRoot,{recursive:false});
 const browser=await chromium.launch({channel:process.env.APXGEN_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 let checks=0;const displayedScreenshots=[];
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
  const response=await page.goto(requested.href,{waitUntil:'domcontentloaded',timeout:60000});assert.equal(response.status(),200);deployedLivingUrl(page.url(),{cohort});assert.equal(new URL(page.url()).origin,requested.origin);checks++;
  await page.getByRole('status').filter({hasText:/Publication verified/i}).waitFor({timeout:60000});assert.equal(await page.locator('#recorded-experience').isVisible(),true);assert.equal(await page.locator('#empty-state').isVisible(),false);checks++;
  assert.equal(await page.locator('meta[name="genesis-evidence-manifest"]').getAttribute('content'),pathFor(cohorts.original.manifestSha256));assert.equal(await page.locator('meta[name="genesis-evidence-manifest-sha256"]').getAttribute('content'),cohorts.original.manifestSha256);assert.equal(await page.locator('#manifest-link').getAttribute('href'),new URL(manifestPath,requested).href);checks++;
  assert.match(await page.locator('.feasibility-result').textContent(),/89\.675/);assert.match(await page.locator('.feasibility-result').textContent(),/retained the parent on the tie/i);assert.match(await page.locator('.feasibility-result').textContent(),/one seed and one generation/i);checks++;
  const cohortLinks=page.getByRole('navigation',{name:'Recorded feasibility cohorts',exact:true});
  assert.equal(await cohortLinks.getByRole('link',{name:'First recorded loop',exact:true}).getAttribute('href'),'./living.html');
  const nativeHref=await cohortLinks.getByRole('link',{name:'Started inside APEX',exact:true}).getAttribute('href');
  const nativeTarget=new URL(nativeHref,page.url());assert.equal(nativeTarget.origin,requested.origin);deployedLivingUrl(nativeTarget.href,{cohort:'native'});assert.equal(nativeTarget.searchParams.get('manifestSha256'),cohorts.native.manifestSha256);checks++;
  const manifestUrl=new URL(manifestPath,requested),manifestBytes=await actualBytes(manifestUrl);assert.equal(digest(manifestBytes),manifestSha256);const manifest=JSON.parse(manifestBytes.toString('utf8'));assert.equal(manifest.candidates.length,2);assert.equal(manifest.fitnessDefinition,'order-lab-task-proxy/2.0.0');if(cohort==='native'){assert.equal(manifest.sourceHash,configured.sourceHash);assert.equal(manifest.evaluatorHash,configured.evaluatorHash);}checks++;
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
  assert.equal(await page.locator('#run-select').inputValue(),runId);assert.equal(await page.locator('#timeline').getAttribute('max'),'1');await page.locator('#timeline').fill('1');assert.match(await page.locator('#comparison-note').textContent(),/Selected: No/);assert.equal(await page.locator('#evidence-images .application-card h3').allTextContents().then(values=>values.join('|')),expected.map(candidate=>'Application '+candidate.applicationId).join('|'));assert.deepEqual(await page.locator('#evidence-images .application-card header p').allTextContents().then(values=>values.filter(value=>value.includes('Oracle score')).map(value=>value.split('Oracle score ')[1])),['89.675','89.675'],'Visible scores must retain the recorded Oracle precision');await imagesReady();checks++;
  await page.locator('.ledger-details>summary').click();assert.equal(await page.locator('#candidate-ledger tr').count(),2);
  assert.deepEqual(await page.locator('#candidate-ledger tr').evaluateAll(rows=>rows.map(row=>row.cells[5].textContent)),['89.675','89.675'],'Ledger labels must retain the recorded Oracle precision');
  for(const candidate of candidates){await page.getByRole('button',{name:'Inspect candidate '+candidate.id,exact:true}).click();const details=JSON.parse(await page.locator('#outcome-json').textContent());assert.equal(details.applicationId,candidate.applicationId);assert.equal(details.selected,candidate.selected);assert.equal(details.fitness,89.675);assert.equal(details.eligible,true);}
  assert.equal(await page.locator('#outcome-json').getAttribute('tabindex'),'0');checks++;
  await axe();
  await page.locator('#timeline').fill('0');await page.locator('#speed').selectOption('2');await page.getByRole('button',{name:'Play recorded generations',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#timeline').value==='1');await page.getByRole('button',{name:'Pause recorded generations',exact:true}).click();const paused=await page.locator('#timeline').inputValue();await page.waitForTimeout(1050);assert.equal(await page.locator('#timeline').inputValue(),paused);checks++;
  await page.getByRole('button',{name:'Previous recorded generation',exact:true}).click();assert.equal(await page.locator('#timeline').inputValue(),'0');await page.getByRole('button',{name:'Next recorded generation',exact:true}).click();assert.equal(await page.locator('#timeline').inputValue(),'1');checks++;
  await page.locator('.ledger-details>summary').click();
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:1000});const option=await page.locator('#viewport option').evaluateAll((options,width)=>options.find(option=>option.value.startsWith(String(width)+'\u00d7'))?.value,width);assert.ok(option,'Actual recorded viewport is unavailable');await page.locator('#viewport').selectOption(option);await imagesReady();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Horizontal page overflow at '+width);
   displayedScreenshots.push(...await verifyRenderedLivingScreenshots(page,{candidates,manifest,viewport:{width,height:Number(option.split('\u00d7')[1])}}));
   await axe();await page.screenshot({path:join(reviewRoot,'deployed-exhibition-'+width+'.png'),fullPage:true,animations:'disabled'});checks++;
  }
  for(const [name,file]of [['Interface Evolution','index.html'],['Continuous Evolution','live.html']]){
   const link=page.getByRole('link',{name,exact:true});assert.equal(await link.getAttribute('href'),'./'+file);const target=new URL(await link.getAttribute('href'),page.url());assert.equal(target.origin,requested.origin);const historical=await context.request.get(target.href,{timeout:30000});assert.equal(historical.status(),200,name+' must remain available');assert.equal(new URL(historical.url()).origin,requested.origin);assert.match(await historical.text(),/Genesis exhibitions|APEX Genesis/);checks++;
  }
  assert.equal(await page.getByRole('link',{name:'Living Applications',exact:true}).getAttribute('aria-current'),'page');assert.deepEqual(errors,[]);checks++;
  const result={suite:'living-applications-deployed',cohort,passed:true,checks,url:page.url(),browser:browser.version(),manifestSha256,runId,applications:expected.map(candidate=>candidate.applicationId),fitness:89.675,parentRetained:true,viewports:[390,768,1440],displayedScreenshotHashesVerified:true,displayedScreenshots,reviewRoot,experimentalEvidenceCreated:false,interceptedResponses:false};
  await writeFile(join(reviewRoot,'deployment-review.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
 }catch(error){try{await page.screenshot({path:join(reviewRoot,'failed-deployment-review.png'),fullPage:true,animations:'disabled'});}catch{}throw error;}
 finally{await browser.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const args=process.argv.slice(2),choice=args.filter(value=>value.startsWith('--')),urls=args.filter(value=>!value.startsWith('--'));assert.ok(choice.length<=1&&choice.every(value=>value==='--cohort=native')&&urls.length===1,'Usage: node tests/browser/living-deployed.mjs <production-or-localhost-living-url> [--cohort=native]');console.log(JSON.stringify(await checkLivingDeployment(urls[0],{cohort:choice.length?'native':'original'})));}catch(error){console.error(error);process.exitCode=1;}}
