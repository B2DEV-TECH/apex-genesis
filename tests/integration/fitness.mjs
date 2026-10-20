import assert from 'node:assert/strict';
import {connect,oracledb} from '../../scripts/db.mjs';
import {fromGenes} from '../../showcase/renderer/genome.mjs';
const db=await connect();let checks=0;
const genes=[2,0,0,0,0,0,2,3,2,0,0],base={overflow:0,overlap:0,clipped:0,missing:0,unnamed:0,focusVisible:1,domNodes:77,viewportsTested:3,errors:0,renderMs:1};
async function score(g=genes,m=base,w=null){const out=Object.fromEntries(['e','f','a','h','r','p','c'].map(k=>[k,{dir:oracledb.BIND_OUT,type:oracledb.NUMBER}]));const result=await db.execute('begin apxgen_fitness.score(:g,:m,:e,:f,:a,:h,:r,:p,:c,:w);end;',{g:JSON.stringify(fromGenes(g)),m:JSON.stringify(m),w,...out});return result.outBinds;}
try{
 const valid=await score();assert.equal(valid.e,1);assert.ok(valid.f>0);checks++;
 const lowContrast=[...genes];lowContrast[5]=3;assert.equal((await score(lowContrast)).e,0);checks++;
 const small=[...genes];small[6]=0;assert.equal((await score(small)).f,0);checks++;
 for(const key of ['overflow','overlap','clipped','missing','unnamed','errors'])assert.equal((await score(genes,{...base,[key]:1})).f,0);checks++;
 assert.equal((await score(genes,{...base,focusVisible:0})).e,0);assert.equal((await score(genes,{...base,viewportsTested:2})).e,0);checks++;
 const performance=await score(genes,base,JSON.stringify({accessibility:0,hierarchy:0,responsiveness:0,performance:1}));assert.equal(performance.f,performance.p);checks++;
 assert.equal((await score(genes,{...base,renderMs:10000})).f,valid.f);checks++;
 await assert.rejects(()=>score(genes,{...base,domNodes:-1}));const missing={...base};delete missing.overflow;await assert.rejects(()=>score(genes,missing));checks++;
 console.log(JSON.stringify({checks,passed:true,scope:'Actual Oracle scoring, hard constraints and timing exclusion; no usability claim'}));
}finally{await db.close();}
