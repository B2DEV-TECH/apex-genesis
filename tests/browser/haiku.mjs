import {chromium} from 'playwright';import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';import {startServer} from '../../scripts/serve.mjs';
const index=JSON.parse(await readFile('showcase/datasets/haiku-paired/index.json','utf8')),calls=JSON.parse(await readFile('showcase/datasets/haiku-paired/ai-invocations.json','utf8'));
const server=await startServer(0),browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1100}}),base='http://127.0.0.1:'+server.address().port,errors=[];let checks=0;page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(base);await page.waitForFunction(()=>window.genesisState?.generation===0);
 assert.ok((await page.locator('.specimen').nth(1).textContent()).includes('Haiku-assisted Darwin'));assert.ok((await page.locator('#race-legend').textContent()).includes('GA_HAIKU'));checks++;
 const a=index.runs.find(r=>r.mode==='GA_HAIKU'&&r.seed===42),call=calls.find(i=>i.RUN_ID===a.id&&i.APPLIED_ORGANISM&&!i.ERROR_CODE);
 await page.locator('#timeline').fill(String(call.GENERATION+1));await page.waitForFunction(g=>window.genesisState.generation===g,call.GENERATION+1);await page.locator('[data-view=mutation]').click();await page.locator('#mutation-organism').selectOption('1:'+call.APPLIED_ORGANISM);await page.waitForFunction(()=>document.querySelector('#mutation-detail').textContent.includes('Approved provider mutation'));
 const detail=await page.locator('#mutation-detail').textContent();assert.ok(detail.includes('claude-haiku-5-5'));assert.ok(detail.includes('operations'));assert.ok(detail.includes(String(call.INPUT_TOKENS)));checks++;
 await page.locator('[data-view=analytics]').click();await page.waitForFunction(()=>document.querySelector('#analytics').textContent.includes('Usage-derived cost USD'));assert.ok((await page.locator('#analytics').textContent()).includes(a.ai.usageBasedCostUsd.toFixed(7)));checks++;
 const control=index.runs.find(r=>r.mode==='RANDOM_SEARCH'&&r.seed===42);await page.locator('[data-view=arena]').click();await page.locator('#right-population').selectOption(control.id);await page.waitForFunction(()=>document.querySelectorAll('.specimen')[1]?.textContent.includes('Random search'));checks++;
 await page.goto(base+'?dataset=./datasets/pilot/manifest.json');await page.waitForFunction(()=>window.genesisState?.generation===0);assert.ok((await page.locator('#ai-evidence').textContent()).includes('No provider calls'));assert.deepEqual(errors,[]);checks++;
 const evidence={passed:true,checks,browser:browser.version(),testedAt:new Date().toISOString(),scope:'Actual Haiku default, approved mutation/usage inspection, run-total cost, random control selection and preserved offline archive',errors};await writeFile('docs/testing/haiku-browser.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await browser.close();server.close();}
