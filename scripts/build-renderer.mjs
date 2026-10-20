import {readFile,writeFile} from 'node:fs/promises';
const base=new URL('../showcase/renderer/',import.meta.url);
const genome=(await readFile(new URL('genome.mjs',base),'utf8')).replace(/^export /gm,'');
const renderer=(await readFile(new URL('renderer.mjs',base),'utf8')).replace(/^import[^\n]+\n/m,'').replace(/^export /gm,'');
const css=await readFile(new URL('organism.css',base),'utf8');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Genesis organism preview</title><style>${css}</style></head><body><main id="organism"></main><script>
${genome}\n${renderer}
window.renderGenome=g=>renderOrganism(document.querySelector('main'),g);
window.addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='genesis-genome'){try{window.renderGenome(event.data.genome);parent.postMessage({type:'genesis-rendered',nonce:event.data.nonce},'*');}catch{parent.postMessage({type:'genesis-rejected'},'*');}}});
</script></body></html>`;
await writeFile(new URL('preview.html',base),html);
console.log('Compiled the canonical renderer into an opaque-origin sandbox preview.');
