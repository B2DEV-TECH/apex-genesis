import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rendererBundle,verifyBundle} from '../../scripts/renderer-bundle.mjs';
test('stale or modified preview cannot enter the evaluation cache',async()=>{
 const expected=await rendererBundle(),actual=await readFile(new URL('../../showcase/renderer/preview.html',import.meta.url),'utf8');
 assert.doesNotThrow(()=>verifyBundle(actual,expected));
 assert.throws(()=>verifyBundle(actual+' ',expected));
 assert.throws(()=>verifyBundle(actual,expected.replace('NORTH / OPERATIONS','Altered renderer')));
});
