import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const site=resolve(process.argv[2]||'../genesis-site');
await cp('showcase',join(site,'public/genesis'),{recursive:true});await mkdir(join(site,'public/images/articles/apex-genesis'),{recursive:true});
await cp('media/screenshots/evolution-arena.png',join(site,'public/images/articles/apex-genesis/evolution-arena.png'));
await cp('docs/publication/article.md',join(site,'content/articles/en/apex-genesis-evolving-interfaces-plsql-claude.md'));
await mkdir(join(site,'public/genesis/media'),{recursive:true});await cp('media/video/demo.en.vtt',join(site,'public/genesis/media/demo.en.vtt'));
const headersPath=join(site,'public/_headers');let headers='';try{headers=await readFile(headersPath,'utf8');}catch{}
headers=headers.replace('/genesis/renderer/preview.html','/genesis/renderer/preview*');
if(!headers.includes('/genesis/*'))headers+=`\n/genesis/*\n  X-Content-Type-Options: nosniff\n  Cache-Control: public, max-age=3600\n\n/genesis/renderer/preview*\n  Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; connect-src 'none'; base-uri 'none'\n`;
await writeFile(headersPath,headers);console.log('Prepared existing-site article, recorded exhibition, media captions and scoped headers.');
