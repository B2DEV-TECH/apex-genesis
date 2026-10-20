import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {startServer} from '../../scripts/serve.mjs';
import {openEvaluator} from '../../scripts/evaluate.mjs';
import {fromGenes} from '../../showcase/renderer/genome.mjs';
const server=await startServer(0),e=await openEvaluator('http://127.0.0.1:'+server.address().port);let checks=0;
try{
 const g=fromGenes([2,0,0,0,0,0,2,3,3,0,0]);const m=await e.measure(g);
 assert.equal(m.overflow+m.overlap+m.clipped+m.missing+m.unnamed+m.errors,0);checks++;
 await e.page.locator('select').selectOption('Ready');await e.page.getByRole('button',{name:'Apply filter'}).click();
 assert.equal(await e.page.locator('tbody tr').count(),2);checks++;
 await e.page.keyboard.press('Tab');assert.ok(await e.page.evaluate(()=>document.activeElement.tagName!=='BODY'));checks++;
 const axe=await new AxeBuilder({page:e.page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 await mkdir('test-results',{recursive:true});await writeFile('test-results/renderer-axe.json',JSON.stringify(axe,null,2));
 assert.deepEqual(axe.violations.map(v=>v.id),[]);checks++;
 await e.page.setViewportSize({width:390,height:844});await e.measure(fromGenes([3,1,23,1,1,1,4,5,5,1,1]));
 assert.equal(await e.page.locator('[data-section]').count(),4);checks++;
 await mkdir('media/screenshots',{recursive:true});await e.page.screenshot({path:'media/screenshots/organism-desktop.png',fullPage:true});
 console.log(JSON.stringify({checks,passed:true,metrics:m}));
}finally{await e.close();server.close();}
