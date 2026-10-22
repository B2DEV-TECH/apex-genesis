import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
test('unconfigured native controls stay disabled and Oracle strings cannot create executable markup',async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.APXGEN_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
 try{
  const page=await browser.newPage();
  const boot=await readFile(new URL('../template/shared-components/static-files/control-boot.js',import.meta.url),'utf8');
  const contract=await readFile(new URL('../template/shared-components/static-files/control-contract.mjs',import.meta.url),'utf8');
  let configured=false;
  await page.route('https://control.test/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/control-boot.js')return route.fulfill({body:boot,contentType:'text/javascript'});
   if(path==='/control-contract.mjs')return route.fulfill({body:contract,contentType:'text/javascript'});
   if(path==='/api')return route.fulfill({json:configured?{ok:true,data:{canCreate:true,canStart:false,capabilityVersion:'order-lab-queued-feasibility/1.0',supportedSeed:50000,maxGenerations:1,maxMaterializations:2,requests:[{id:'a'.repeat(32),label:'<img src=x onerror="window.injected=true">',state:'QUEUED',seed:50000,generations:1,materializationBudget:2,runId:null}]}}:{ok:false,error:'CONTROL_UNAVAILABLE'}});
   return route.fulfill({contentType:'text/html',body:'<section id="living-control"><p data-status></p><input name="seed" value="12345" disabled><select data-requests disabled></select><button data-action="START" disabled>Start</button><button data-action="REFRESH" disabled>Refresh</button><div data-observation></div></section><script>window.apex={server:{process:async(name,data)=>{if(data.x01==="WATCH")return {ok:true,data:{request:{id:"'+'a'.repeat(32)+'",label:"<img src=x onerror=alert(1)>",state:"QUEUED",seed:50000,generations:1,materializationBudget:2,runId:null},run:null,organisms:[],events:[]}};return (await fetch("/api")).json();}}};</script><script src="/control-boot.js"></script>'});
  });
  await page.goto('https://control.test/');
  await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.includes('not configured'));
  assert.equal(await page.locator('button:enabled').count(),0);
  configured=true;await page.reload();
  await page.waitForFunction(()=>document.querySelector('[data-status]').textContent.startsWith('Queued'));
  assert.equal(await page.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);
  assert.ok((await page.locator('[data-requests]').textContent()).includes('<img src=x'));
  assert.ok((await page.locator('[data-observation]').textContent()).includes('Evolution has not started'));
  assert.equal(await page.locator('[data-action="START"]').isDisabled(),true);
  assert.equal(await page.locator('[name="seed"]').inputValue(),'50000');
  assert.equal(await page.locator('[name="seed"]').evaluate(node=>node.readOnly),true);
 }finally{await browser.close();}
});
