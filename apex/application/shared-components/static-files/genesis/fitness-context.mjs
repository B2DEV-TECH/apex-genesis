const defaults=Object.freeze({accessibility:.4,hierarchy:.25,responsiveness:.25,performance:.1});
export function fitnessWeights(run){const source=run.fitnessWeights||defaults;return Object.fromEntries(Object.keys(defaults).map(k=>[k,source[k]]));}
export function fitnessDescription(run){return Object.entries(fitnessWeights(run)).map(([k,v])=>(v*100).toLocaleString('en-US',{maximumFractionDigits:6})+'% '+k).join(' · ');}
export function matchingFitness(runs){return runs.every(r=>JSON.stringify(fitnessWeights(r))===JSON.stringify(fitnessWeights(runs[0]))&&r.environmentHash===runs[0].environmentHash);}
