import {validateGenome,canonicalGenome} from './renderer/genome.mjs';
export function aiEvidenceLabel(runs){const reconciled=runs.reduce((n,r)=>n+(r.ai?.reconciled||0),0),uncertain=runs.reduce((n,r)=>n+(r.ai?.uncertain||0),0);if(uncertain)return 'Billing uncertain';if(reconciled)return reconciled+' usage records';return 'No provider calls';}
export function safePath(path){if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>p==='..'||p==='.'||!p)||!/^[-a-zA-Z0-9_./]+$/.test(path))throw new Error('Unsafe dataset path');return path;}
export async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function openDataset(manifestUrl){
 if(typeof window!=='undefined'&&window.genesisDataProvider)return window.genesisDataProvider();
 const base=new URL('.',manifestUrl);const manifest=await (await fetch(manifestUrl)).json();
 if(manifest.schemaVersion!=='1.0'||manifest.kind!=='recorded-oracle-experiment'||!Array.isArray(manifest.files)||manifest.files.length>10000)throw new Error('Unsupported experiment manifest');
 const files=new Map();for(const f of manifest.files){safePath(f.path);if(!/^[a-f0-9]{64}$/.test(f.sha256)||files.has(f.path)||!Number.isInteger(f.bytes)||f.bytes<1||f.bytes>20000000)throw new Error('Invalid file manifest');files.set(f.path,f);}
 async function load(path){safePath(path);const expected=files.get(path);if(!expected)throw new Error('Unlisted dataset file');const res=await fetch(new URL(path,base));if(!res.ok)throw new Error('Dataset file unavailable');const bytes=await res.arrayBuffer();if(bytes.byteLength!==expected.bytes||await digest(bytes)!==expected.sha256)throw new Error('Dataset integrity failure');return JSON.parse(new TextDecoder().decode(bytes));}
 const index=await load('index.json');if(!Array.isArray(index.runs)||index.runs.length<1)throw new Error('Empty experiment dataset');
 for(const run of index.runs){if(!Array.isArray(run.generations)||!run.generations.length||run.generations.some((g,i)=>g.generation!==i))throw new Error('Invalid generation ordering');for(const g of run.generations)safePath(g.path);}
 const cache=new Map();
 async function generation(runId,number){const run=index.runs.find(x=>x.id===runId);const summary=run?.generations[number];if(!summary)throw new Error('Generation unavailable');const key=runId+':'+number;if(cache.has(key))return cache.get(key);
  const data=await load(summary.path);if(data.runId!==runId||data.generation!==number||!Array.isArray(data.organisms)||data.organisms.length!==run.populationSize)throw new Error('Generation identity mismatch');
  for(const o of data.organisms){if(!validateGenome(o.genome).valid||await digest(new TextEncoder().encode(canonicalGenome(o.genome)))!==o.fingerprint)throw new Error('Genome integrity failure');}
  cache.set(key,data);if(cache.size>16)cache.delete(cache.keys().next().value);return data;
 }
 return {manifest,index,generation};
}
