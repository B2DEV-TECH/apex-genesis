import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {startServer} from '../../scripts/serve.mjs';
const server=await startServer(0),base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'}),page=await context.newPage();
let checks=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 const start=Date.now();await page.goto(base);await page.waitForFunction(()=>window.genesisState?.generation===0);const loadMs=Date.now()-start;checks++;
 assert.equal(await page.locator('.specimen').count(),2);assert.equal(await page.locator('.specimen iframe').count(),2);checks++;
 await page.locator('#timeline').fill('50');await page.waitForFunction(()=>window.genesisState.generation===50);assert.equal(await page.locator('#generation-label').textContent(),'050');checks++;
 await page.locator('#play').click();await page.waitForFunction(()=>window.genesisState.generation>50);await page.locator('#play').click();const paused=await page.locator('#timeline').inputValue();await page.waitForTimeout(1250);assert.equal(await page.locator('#timeline').inputValue(),paused);checks++;
 await page.locator('#timeline').fill('100');await page.waitForFunction(()=>window.genesisState.generation===100);await page.getByRole('button',{name:'Inspect organism ↗'}).first().click();await page.locator('#organism-dialog').waitFor({state:'visible'});await page.getByRole('button',{name:'Mobile',exact:true}).click();assert.equal(await page.locator('#dialog-frame').evaluate(f=>f.style.width),'390px');await page.locator('#close-dialog').click();checks++;
 await page.locator('[data-view=tree]').click();await page.waitForFunction(()=>document.querySelectorAll('#tree-svg g').length>0);assert.equal(await page.locator('#tree-svg g').count(),36);await page.locator('#tree-svg g').first().click();await page.locator('#organism-dialog').waitFor({state:'visible'});await page.locator('#close-dialog').click();checks++;
 await page.locator('#tree-method').selectOption('ELITE');await page.waitForFunction(()=>document.querySelectorAll('#tree-svg g[opacity]').length>0);assert.equal(await page.locator('#tree-svg g:not([opacity])').count(),6);await page.locator('#tree-method').selectOption('');checks++;
 const index=JSON.parse(await readFile('showcase/datasets/haiku-paired/index.json','utf8'));const origin=JSON.parse(await readFile('showcase/datasets/haiku-paired/'+index.runs[0].generations[0].path,'utf8'));await page.locator('#tree-search').fill(String(origin.organisms[0].id));await page.locator('#tree-find').click();await page.locator('#organism-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#generation-label').textContent(),'000');await page.locator('#close-dialog').click();await page.locator('#timeline').fill('100');checks++;
 await page.locator('[data-view=mutation]').click();await page.waitForFunction(()=>document.querySelector('#mutation-organism').options.length===24);await page.locator('#mutation-organism').selectOption({index:2});await page.waitForTimeout(200);assert.ok((await page.locator('#mutation-detail').textContent()).length>30);checks++;
 await page.locator('[data-view=analytics]').click();await page.waitForFunction(()=>document.querySelectorAll('.analytics-card').length===4);assert.ok((await page.locator('#analytics').textContent()).includes('1212'));checks++;
 await page.locator('[data-view=arena]').click();await page.waitForFunction(()=>window.genesisState.view==='arena');
 await mkdir('test-results',{recursive:true});const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();await writeFile('test-results/showcase-axe.json',JSON.stringify(axe,null,2));assert.deepEqual(axe.violations.map(x=>x.id),[]);checks++;
 await mkdir('media/screenshots',{recursive:true});await page.screenshot({path:'media/screenshots/evolution-laboratory.png',fullPage:true});
 await page.locator('#arena-view').screenshot({path:'media/screenshots/evolution-arena.png'});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'media/screenshots/evolution-mobile.png',fullPage:true});checks++;
 assert.deepEqual(errors,[]);checks++;
 const malicious=await context.newPage();await malicious.route('**/generation-0000.json',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+' '});});await malicious.goto(base);await malicious.waitForFunction(()=>document.querySelector('#load-status').textContent.includes('integrity failure'));checks++;
 const result={checks,passed:true,initialLoadMs:loadMs,browser:browser.version(),axeExcluded:[],errors,dataset:'actual Oracle Haiku paired suite',viewports:[1440,390]};await writeFile('test-results/showcase-evidence.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();server.close();}
