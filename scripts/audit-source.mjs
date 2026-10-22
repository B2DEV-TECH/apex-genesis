import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const git=(args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:128*1024*1024,windowsHide:true});
const paths=git(['ls-files','-z']).split('\0').filter(Boolean),failures=[];
const secrets=[];
function collectCredentialValues(configuration){
 const pending=[configuration];
 while(pending.length){
  const value=pending.pop();if(!value||typeof value!=='object')continue;
  for(const[key,child]of Object.entries(value)){
   if((key==='password'||key==='apexPassword')&&typeof child==='string'&&child.length>=12)secrets.push(child);
   else if(child&&typeof child==='object')pending.push(child);
  }
 }
}
async function collectLocalSecrets(directory){
 for(const entry of await readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
  if(entry.isSymbolicLink())continue;
  const file=join(directory,entry.name);
  if(entry.isDirectory())await collectLocalSecrets(file);
  else if(entry.isFile()&&/oracle.*\.json$/i.test(entry.name)){
   const content=(await readFile(file,'utf8')).replace(/^\uFEFF/,'');let configuration;
   try{configuration=JSON.parse(content);}catch{throw new Error('Local Oracle configuration is invalid');}
   collectCredentialValues(configuration);
  }
 }
}
await collectLocalSecrets('.local');
const patterns=[/sk-ant-[a-zA-Z0-9_-]{20,}/,/gh[pousr]_[a-zA-Z0-9]{30,}/,/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/];
function inspect(text,name){if(secrets.some(s=>text.includes(s))||patterns.some(p=>p.test(text)))failures.push(name);}
for(const path of paths){if(/(^|\/)(\.local|node_modules|\.env)(\/|$)/.test(path))failures.push(path);inspect((await readFile(path)).toString('utf8'),path);}
inspect(git(['log','--all','--format=','-p','--no-color']),'Git history');
if(failures.length)throw new Error('Source audit rejected paths: '+[...new Set(failures)].join(', '));
console.log(JSON.stringify({passed:true,trackedFiles:paths.length,historyChecked:true,scope:'Credential patterns, known local lab secrets and excluded-path checks; not a general security certification'}));
