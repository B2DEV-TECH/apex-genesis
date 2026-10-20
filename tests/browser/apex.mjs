import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {config} from '../../scripts/db.mjs';
const c=await config(),browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();let checks=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base='http://127.0.0.1:8080/ords/r/'+c.workspace.toLowerCase()+'/apex-genesis/';
try{
 await page.goto(base+'genesis-1');await page.locator('#P9999_USERNAME').fill(c.apexUser);await page.locator('#P9999_PASSWORD').fill(c.apexPassword);await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.locator('#genesis-control').waitFor({timeout:20000});await page.waitForFunction(()=>document.querySelector('#control-run').options.length>0);checks++;
 const screenshotDirectory=c.evidenceName?'test-results/'+c.evidenceName:'apex/screenshots';await mkdir(screenshotDirectory,{recursive:true});await page.screenshot({path:screenshotDirectory+'/control-center.png',fullPage:true});
 const session=await page.evaluate(()=>apex.env.APP_SESSION);
 for(const [number,label]of [[2,'arena'],[3,'tree'],[4,'arena'],[5,'arena'],[6,'mutation'],[7,'analytics']]){
  await page.goto(base+'genesis-'+number+'?session='+session);await page.waitForFunction(()=>window.genesisState,{timeout:20000});assert.equal(await page.locator('#lab-content').isVisible(),true);checks++;
  if(number===2)await page.screenshot({path:screenshotDirectory+'/evolution-arena.png',fullPage:true});
 }
 await page.goto(base+'genesis-8?session='+session);await page.locator('#new-label').fill('TEST APEX browser create with a deliberately long experiment label');await page.locator('#new-size').fill('4');await page.locator('#new-generations').fill('5');await page.locator('#create-experiment').click();await page.waitForFunction(()=>document.querySelector('#create-status').textContent.includes('Created'),null,{timeout:5000});checks++;
 assert.deepEqual(errors,[]);checks++;
 const anonymous=await browser.newPage();await anonymous.goto(base+'genesis-2');assert.equal(await anonymous.locator('#P9999_PASSWORD').count(),1);checks++;
 const evidence={checks,passed:true,errors,applicationId:Number(await page.evaluate(()=>apex.env.APP_ID)),apex:'26.2.0',testedAt:new Date().toISOString()};await mkdir('test-results',{recursive:true});await writeFile('test-results/'+(c.evidenceName||'apex')+'-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}catch(error){await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/apex-failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-4000));throw error;}finally{await browser.close();}
