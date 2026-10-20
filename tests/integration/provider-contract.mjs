import assert from 'node:assert/strict';
import {connect,rows,createRun,oracledb} from '../../scripts/db.mjs';
const db=await connect();let checks=0;
try{
 const genome=(await rows(db,'select canonical_json from apxgen_genomes fetch first 1 row only'))[0].CANONICAL_JSON;
 const request=await db.execute('begin :result:=apxgen_ai.message_request(:model,:parent,256);end;',{result:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:16000},model:'claude-haiku-5-5',parent:genome});
 const body=JSON.parse(request.outBinds.result);assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.max_tokens,256);assert.equal(body.model,'claude-haiku-5-5');checks++;
 assert.equal(body.messages.length,1);assert.equal(body.messages[0].role,'user');assert.ok(body.messages[0].content.endsWith(genome));checks++;
 console.log(JSON.stringify({checks,passed:true,paidRequests:0}));
}finally{await db.close();}
