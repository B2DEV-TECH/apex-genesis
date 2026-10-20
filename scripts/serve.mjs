import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../showcase',import.meta.url));
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.vtt':'text/vtt'};
export function startServer(port=4173){const server=createServer(async(req,res)=>{try{
 const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let full=resolve(root,'.'+path);
 if(full!==root&&!full.startsWith(root+sep))throw new Error('Invalid path');
 if((await stat(full)).isDirectory())full=resolve(full,'index.html');
 const body=await readFile(full);res.writeHead(200,{'content-type':types[extname(full)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"});res.end(body);
 }catch{res.writeHead(404,{'content-type':'text/plain'});res.end('Not found');}});return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve(server)));}
if(process.argv[1]===fileURLToPath(import.meta.url)){const server=await startServer(Number(process.env.PORT||4173));console.log('Genesis: http://127.0.0.1:'+server.address().port);}
