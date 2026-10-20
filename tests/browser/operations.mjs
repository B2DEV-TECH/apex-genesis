// Autonomous Operations page (9): rendering, queued commands and server-side denial.
// Mutating checks run only against the verification owner; `--read-only` renders the
// page of any installation without queuing commands (used for the LAB supervisor).
import {chromium} from 'playwright';import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';import {config,connect,rows} from '../../scripts/db.mjs';
const readOnly=process.argv.includes('--read-only');
const c=await config();
if(!readOnly&&c.user!=='APXGEN_VERIFY')throw new Error('Mutating operations checks require APXGEN_CONFIG=.local/verify-oracle.json; use --read-only elsewhere');
const db=await connect(),browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}});let checks=0;const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const original=(await rows(db,'select principal_role from apxgen_principals where username=upper(:u)',{u:c.apexUser}))[0].PRINCIPAL_ROLE;
const firstCommand=(await rows(db,'select nvl(max(command_id),0) n from apxgen_commands'))[0].N;
const base='http://127.0.0.1:8080/ords/r/'+c.workspace.toLowerCase()+'/apex-genesis/';
const api=(action,x02='')=>page.evaluate(({action,x02})=>new Promise(resolve=>apex.server.process('GENESIS_DATA',{x01:action,x02},{dataType:'json',timeout:10000,success:resolve,error:xhr=>resolve(xhr.responseJSON||{transportError:true,status:xhr.status})})),{action,x02});
const commands=async()=>rows(db,'select command_id,command,requested_by,state from apxgen_commands where command_id>:n order by command_id',{n:firstCommand});
const directory='test-results/'+(c.evidenceName||'lab')+'-operations';await mkdir(directory,{recursive:true});
try{
 await page.goto(base+'genesis-1');await page.locator('#P9999_USERNAME').fill(c.apexUser);await page.locator('#P9999_PASSWORD').fill(c.apexPassword);await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.locator('#genesis-control').waitFor({timeout:20000});
 const session=await page.evaluate(()=>apex.env.APP_SESSION);
 await page.goto(base+'genesis-9?session='+session);await page.waitForFunction(()=>document.querySelectorAll('#ops-metrics div').length>=16,null,{timeout:20000});
 const shown=await page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('#ops-metrics div')].map(d=>[d.querySelector('span').textContent,d.querySelector('strong').textContent])));
 assert.match(shown.SUPERVISOR,/^[A-Z_]+/);assert.match(shown['AUTONOMOUS AI REQUESTS'],/^\d+$/);checks++;
 assert.ok(await page.locator('#t_TreeNav a[href*="genesis-9"], #t_TreeNav [data-id] a').filter({hasText:'Autonomous Operations'}).count()>=1,'navigation entry');checks++;
 await page.screenshot({path:directory+'/operations.png',fullPage:true});
 const publications=await page.locator('#ops-publications tr').count(),logLines=await page.locator('#ops-log li').count();assert.ok(logLines>0);checks++;
 if(!readOnly){
  // A dismissed confirmation queues nothing.
  page.once('dialog',d=>d.dismiss());await page.locator('[data-ops=STOP_RUN]').click();await page.waitForTimeout(800);assert.equal((await commands()).length,0);checks++;
  // An operator command is queued in Oracle and attributed to the APEX account.
  await page.locator('[data-ops=PUBLISH_NOW]').click();await page.waitForFunction(()=>/queued as command #\d+/.test(document.querySelector('#ops-status').textContent),null,{timeout:10000});
  const queued=await commands();assert.equal(queued.length,1);assert.equal(queued[0].COMMAND,'PUBLISH_NOW');assert.equal(queued[0].REQUESTED_BY,c.apexUser.toUpperCase());checks++;
  // Unsupported commands are refused by Oracle even for an operator.
  assert.equal((await api('OPS_COMMAND','DROP_EVERYTHING')).code,-20073);checks++;
  // A READER is denied every operations callback on the server, not just in the page.
  await db.execute("update apxgen_principals set principal_role='READER' where username=upper(:u)",{u:c.apexUser});await db.commit();
  for(const [action,x02]of [['OPS_COMMAND','PAUSE'],['OPS_COMMAND','SHUTDOWN'],['OPS_STATUS',''],['OPS_LOG','10'],['OPS_PUBLICATION','5']])assert.equal((await api(action,x02)).code,-20060,action+' '+x02);
  assert.equal((await commands()).length,1);assert.ok((await api('INDEX')).runs);checks++;
 }
 assert.deepEqual(errors,[]);checks++;
 const evidence={test:'apex-operations-page',checks,passed:true,readOnly,applicationId:Number(await page.evaluate(()=>apex.env.APP_ID)),owner:c.user,shown,publicationRows:publications,logLines,
  scope:readOnly?'Rendered the Autonomous Operations page against the running supervisor without queuing commands':'Queued an operator command, refused an unsupported command, dismissed confirmation queued nothing, READER denied all OPS callbacks server-side',testedAt:new Date().toISOString()};
 await writeFile(directory+'/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,1));
}catch(error){await page.screenshot({path:directory+'/failure.png',fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText().catch(()=>'')).slice(-1500));throw error;}
finally{
 await db.rollback();await db.execute('update apxgen_principals set principal_role=:role where username=upper(:u)',{role:original,u:c.apexUser});
 // Remove only the commands this verification queued so a later verification supervisor does not apply them.
 if(!readOnly)await db.execute("delete from apxgen_commands where command_id>:n and state='PENDING'",{n:firstCommand});
 await db.commit();await browser.close();await db.close();
}
