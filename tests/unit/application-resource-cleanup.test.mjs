import test from 'node:test';
import assert from 'node:assert/strict';
import {closeApplicationResources,withRestoredFixture} from '../../runtime/application/resources.mjs';

test('both owned resources are closed even when one close fails',async()=>{
 for(const failing of ['browser','database']){const called=[];const resources=Object.fromEntries(['browser','database'].map(name=>[name,{close:async()=>{called.push(name);if(name===failing)throw new Error('TEST_ONLY private diagnostic');}}]));await assert.rejects(closeApplicationResources(resources),/resource cleanup failed/i);assert.deepEqual(called.sort(),['browser','database']);}
});
test('an early failure without a browser still closes the database',async()=>{
 let closed=false;await closeApplicationResources({database:{close:async()=>{closed=true;}}});assert.equal(closed,true);
});
test('a stalled close is bounded and cannot prevent the other resource from closing',async()=>{
 const called=[];const started=Date.now();
 await assert.rejects(closeApplicationResources({browser:{close:()=>{called.push('browser');return new Promise(()=>{});}},database:{close:async()=>{called.push('database');}},timeoutMs:25}),/resource cleanup failed/i);
 assert.deepEqual(called.sort(),['browser','database']);assert.ok(Date.now()-started<1000);
});
test('fixture restoration covers probe connection failure before any probe resource exists',async()=>{
 let rows=40,restored=0;const fixture={reset:async options=>{assert.deepEqual(options,{forCleanup:true});rows=40;restored++;}};
 await assert.rejects(withRestoredFixture(fixture,async()=>{rows--;throw new Error('TEST_ONLY connection unavailable');}),/connection unavailable/);
 assert.equal(rows,40);assert.equal(restored,1);
});
test('fixture restoration still runs when probe closure fails',async()=>{
 let rows=40;const fixture={reset:async()=>{rows=40;}};
 await assert.rejects(withRestoredFixture(fixture,async()=>{rows--;await closeApplicationResources({database:{close:async()=>{throw new Error('TEST_ONLY close failed');}}});}),/resource cleanup failed/);
 assert.equal(rows,40);
});
