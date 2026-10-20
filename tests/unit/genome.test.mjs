import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalGenome, validateGenome, applyMutation, fromGenes } from '../../showcase/renderer/genome.mjs';

test('rejects code, missing content and unknown properties', () => {
  const g = fromGenes([3,0,0,0,0,0,2,3,3,0,0]);
  assert.equal(validateGenome(g).valid, true);
  assert.equal(validateGenome({...g, script:'alert(1)'}).valid, false);
  assert.equal(validateGenome({...g, layout:{...g.layout,order:['metrics']}}).valid, false);
  assert.equal(validateGenome({...g, style:{...g.style,palette:'url(https://evil)'}}).valid, false);
});
test('canonical representation ignores input key order', () => {
  const g = fromGenes([3,0,0,0,0,0,2,3,3,0,0]);
  assert.equal(canonicalGenome({...g,style:{...g.style}}), canonicalGenome({behavior:g.behavior,style:g.style,layout:g.layout,schemaVersion:g.schemaVersion}));
});
test('mutation preserves parent and refuses arbitrary operations', () => {
  const g=fromGenes([3,0,0,0,0,0,2,3,3,0,0]);
  const before=JSON.stringify(g);
  assert.equal(applyMutation(g,{operations:[{gene:'columns',value:2}]}).layout.columns,2);
  assert.equal(JSON.stringify(g),before);
  assert.throws(()=>applyMutation(g,{operations:[{gene:'innerHTML',value:'<script>'}]}));
  assert.throws(()=>applyMutation(g,{operations:[{gene:'columns',value:5}]}));
  assert.throws(()=>applyMutation(g,{operations:[],sql:'delete from users'}));
});
