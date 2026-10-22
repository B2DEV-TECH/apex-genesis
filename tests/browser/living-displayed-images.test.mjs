import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {verifyRenderedLivingScreenshots} from './living-deployed.mjs';

// TEST ONLY DOM corruption of the unchanged public viewer. All evidence bytes
// are the genuine, immutable c46 package. No experimental document is changed,
// no screenshot is written, and no Oracle/provider/public network is contacted.
const packageRoot=new URL('../../apex/living-control/template/shared-components/static-files/evidence/c46d109a8952417ea277daa0696ed698/',import.meta.url);
const manifestSha256='9884a0b6070d697a828f24193647878fbce13938ba0279ad69299f3568a5427e';
const digest=value=>createHash('sha256').update(value).digest('hex');
async function serveRecordedViewer(){
 const manifestBytes=await readFile(new URL('manifest.json',packageRoot));assert.equal(digest(manifestBytes),manifestSha256);
 const manifest=JSON.parse(manifestBytes),files=new Map();
 for(const name of ['living.html','living.css','living.mjs','living-evidence.mjs'])files.set('/'+name,await readFile(new URL('../../showcase/'+name,import.meta.url)));
 files.set('/recorded/manifest.json',manifestBytes);
 for(const entry of manifest.files){const bytes=await readFile(new URL(entry.path,packageRoot));assert.equal(bytes.length,entry.bytes);assert.equal(digest(bytes),entry.sha256);files.set('/recorded/'+entry.path,bytes);}
 const candidates=manifest.candidates.map(path=>JSON.parse(files.get('/recorded/'+path))).sort((a,b)=>a.generation-b.generation);
 assert.deepEqual(candidates.map(candidate=>candidate.applicationId),[131,132]);assert.equal(candidates[1].parentId,candidates[0].id);
 const server=createServer((request,response)=>{
  const path=new URL(request.url,'http://localhost').pathname,bytes=files.get(path);
  if(path==='/favicon.ico'){response.writeHead(204);response.end();return;}
  if(!bytes){response.writeHead(404,{'content-type':'text/plain'});response.end('Unavailable test asset');return;}
  const type=path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':path.endsWith('.mjs')?'text/javascript':path.endsWith('.json')?'application/json':path.endsWith('.png')?'image/png':'application/octet-stream';
  response.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});response.end(bytes);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,manifest,candidates,base:'http://127.0.0.1:'+server.address().port};
}
async function imagesReady(page,width){
 for(const image of await page.locator('#evidence-images img').all())await image.scrollIntoViewIfNeeded();
 await page.waitForFunction(expected=>{const images=[...document.querySelectorAll('#evidence-images img')];return images.length===2&&images.every(image=>image.complete&&image.naturalWidth===expected&&image.naturalHeight>0);},width);
}
test('displayed genuine package passes and same-dimension parent PNG substituted for child is rejected',{timeout:60000},async()=>{
 const {server,base,manifest,candidates}=await serveRecordedViewer();let browser;
 try{
  browser=await chromium.launch({channel:process.env.APXGEN_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[],external=[];page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('request',request=>{if(new URL(request.url()).origin!==base)external.push(request.url());});
  await page.goto(base+'/living.html?dataset=recorded/manifest.json&manifestSha256='+manifestSha256);
  await page.getByRole('status').filter({hasText:/Publication verified/i}).waitFor();await page.locator('#timeline').fill('1');
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:1000});const viewport={width,height:1000};await page.locator('#viewport').selectOption(width+'\u00d7'+viewport.height);await imagesReady(page,width);
   await verifyRenderedLivingScreenshots(page,{candidates,manifest,viewport});
   if(width===390)continue; // The genuine mobile PNGs are identical; desktop/tablet differ.
   const parent=candidates[0].screenshots.find(image=>image.viewport.width===width),child=candidates[1].screenshots.find(image=>image.viewport.width===width);
   assert.notEqual(manifest.files.find(entry=>entry.path===parent.path).sha256,manifest.files.find(entry=>entry.path===child.path).sha256);
   await page.locator('#evidence-images').evaluate(container=>{container.querySelector('.descendant img').src=container.querySelector('.parent img').currentSrc;});await imagesReady(page,width);
   assert.deepEqual(await page.locator('#evidence-images img').evaluateAll(images=>images.map(image=>[image.naturalWidth,image.naturalHeight])),[[width,936],[width,936]],'The deliberately wrong displayed image must retain the genuine dimensions');
   await assert.rejects(()=>verifyRenderedLivingScreenshots(page,{candidates,manifest,viewport}),/Displayed screenshot (?:bytes|hash) differ/);
   await page.locator('#viewport').selectOption('390\u00d71000');await page.locator('#viewport').selectOption(width+'\u00d71000');await imagesReady(page,width);await verifyRenderedLivingScreenshots(page,{candidates,manifest,viewport});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
