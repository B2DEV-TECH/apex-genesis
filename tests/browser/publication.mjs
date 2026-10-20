import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const base=process.argv[2]||'http://127.0.0.1:8787',slug='apex-genesis-evolving-interfaces-plsql-claude';
// Branded channel includes the H.264/AAC codecs omitted from some Chromium builds.
const channel=process.env.APXGEN_MEDIA_BROWSER||'msedge';
const browser=await chromium.launch({channel}),page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];let checks=0;
page.on('pageerror',e=>errors.push(e.message));
try{
 const response=await page.goto(base+'/blog/'+slug);assert.equal(response.status(),200);await page.getByRole('heading',{level:1}).waitFor();checks++;
 const embedded=page.frameLocator('iframe[src="/genesis/index.html"]');await embedded.locator('#arena-cards .specimen').first().waitFor({timeout:30000});assert.equal(await embedded.locator('.specimen').count(),2);checks++;
 await embedded.locator('#timeline').fill('100');await embedded.locator('#generation-label').filter({hasText:'100'}).waitFor();await embedded.getByRole('button',{name:'Inspect organism ↗'}).first().click();await embedded.locator('#organism-dialog').waitFor({state:'visible'});await embedded.locator('#close-dialog').click();checks++;
 const preview=await fetch(base+'/genesis/renderer/preview.html');assert.equal(preview.status,200);assert.ok(preview.headers.get('content-security-policy')?.includes("connect-src 'none'"));checks++;
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/article-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'test-results/article-mobile.png',fullPage:true});checks++;
 const video=page.locator('video').first();await video.scrollIntoViewIfNeeded();await video.evaluate(v=>v.load());await page.waitForFunction(()=>document.querySelector('video')?.duration>340,null,{timeout:30000});assert.ok(await video.evaluate(v=>v.duration<350));checks++;
 const videoSource=await video.locator('source').getAttribute('src')||await video.getAttribute('src');const videoUrl=new URL(videoSource,base).href;const range=await fetch(videoUrl,{headers:{range:'bytes=0-1023'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,1024);checks++;
 const expected=JSON.parse(await readFile('media/video/evidence.json','utf8'));const media=await fetch(videoUrl);assert.equal(createHash('sha256').update(new Uint8Array(await media.arrayBuffer())).digest('hex'),expected.sha256);checks++;
 for(const path of ['/engineering/videos/apex-genesis-evolution-demo','/open-source/apex-genesis'])assert.equal((await fetch(base+path)).status,200);checks++;
 assert.deepEqual(errors,[]);checks++;
 const evidence={checks,passed:true,base,browser:browser.version(),channel,testedAt:new Date().toISOString(),errors,videoSha256:expected.sha256,scope:'Real built article, embedded replay, mobile, preview CSP, media metadata/range/hash, project/video pages'};await writeFile('test-results/publication-'+(base.startsWith('https')?'live':'local')+'.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}catch(error){console.error(JSON.stringify(await page.locator('video').evaluateAll(vs=>vs.map(v=>({src:v.currentSrc,error:v.error?.message,readyState:v.readyState,networkState:v.networkState,duration:v.duration})))));throw error;}finally{await browser.close();}
