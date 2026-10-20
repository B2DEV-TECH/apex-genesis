import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {safePath} from '../showcase/dataset.mjs';
import {canonicalGenome,validateGenome} from '../showcase/renderer/genome.mjs';
const root=process.argv[2]||'showcase/datasets/pilot';const manifest=JSON.parse(await readFile(root+'/manifest.json','utf8'));const hash=b=>createHash('sha256').update(b).digest('hex');
const names=new Set();for(const f of manifest.files){safePath(f.path);assert.ok(!names.has(f.path));names.add(f.path);const bytes=await readFile(root+'/'+f.path);assert.equal(bytes.length,f.bytes);assert.equal(hash(bytes),f.sha256);}
assert.ok(names.has('index.json'),'Index must be included in the verified manifest');
const index=JSON.parse(await readFile(root+'/index.json','utf8'));let organisms=0;const starts=new Map();
for(const run of index.runs){assert.equal(run.generations.length,run.targetGenerations+1);assert.equal(run.state,'COMPLETED');let best=0;
 for(const [i,g]of run.generations.entries()){safePath(g.path);assert.ok(names.has(g.path),'Generation must be included in the verified manifest');assert.equal(g.generation,i);const part=JSON.parse(await readFile(root+'/'+g.path,'utf8'));assert.equal(part.runId,run.id);assert.equal(part.organisms.length,run.populationSize);assert.equal(part.generation,i);
  assert.equal(Math.max(...part.organisms.map(o=>o.fitness)),g.bestFitness);best=Math.max(best,g.bestFitness);assert.equal(g.bestSoFar,best);
  assert.ok(Math.abs(part.organisms.reduce((n,o)=>n+o.fitness,0)/run.populationSize-g.meanFitness)<1e-7);
  const sorted=part.organisms.map(o=>o.fitness).toSorted((a,b)=>a-b),mid=sorted.length/2,median=Number.isInteger(mid)?(sorted[mid-1]+sorted[mid])/2:sorted[Math.floor(mid)];assert.ok(Math.abs(median-g.medianFitness)<1e-7);assert.ok(Math.abs(sorted.reduce((n,f)=>n+(f-g.meanFitness)**2,0)/sorted.length-g.varianceFitness)<1e-7);
  assert.equal(new Set(part.organisms.map(o=>o.fingerprint)).size/run.populationSize,g.diversity);
  for(const o of part.organisms){assert.ok(validateGenome(o.genome).valid);assert.equal(hash(Buffer.from(canonicalGenome(o.genome))),o.fingerprint);if(!o.eligible)assert.equal(o.fitness,0);organisms++;}
  if(i===0){const key=String(run.seed),fingerprints=part.organisms.map(o=>o.fingerprint);if(starts.has(key))assert.deepEqual(fingerprints,starts.get(key));else starts.set(key,fingerprints);}
 }
}
console.log(JSON.stringify({verified:true,runs:index.runs.length,generations:index.runs.reduce((s,r)=>s+r.generations.length,0),organisms,files:manifest.files.length,bytes:manifest.files.reduce((s,f)=>s+f.bytes,0)}));
