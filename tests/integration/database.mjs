import assert from 'node:assert/strict';
import {connect,rows,createRun} from '../../scripts/db.mjs';
const db=await connect();let checks=0;
try{
 const invalid=await rows(db,"select object_name from user_objects where status='INVALID' and object_name like 'APXGEN%'");assert.deepEqual(invalid,[]);checks++;
 const a=await createRun(db,{label:'TEST deterministic A',seed:3107,size:6,generations:5});
 const b=await createRun(db,{label:'TEST deterministic B',seed:3107,size:6,generations:5});
 for(const id of [a,b]){await db.execute('begin apxgen_evolution.initialize(:id);end;',{id});await db.commit();}
 const hashes=async id=>(await rows(db,'select fingerprint from apxgen_organisms where run_id=:id and generation=0 order by ordinal',{id})).map(x=>x.FINGERPRINT);
 assert.deepEqual(await hashes(a),await hashes(b));checks++;
 await assert.rejects(()=>db.execute("begin apxgen_genome.validate('{\"schemaVersion\":\"1.0\",\"sql\":\"select 1\"}');end;"));checks++;
 await assert.rejects(()=>db.execute('begin apxgen_evolution.submit_evaluation(1,\'forged\',\'x\',\'{}\');end;'));checks++;
 await db.execute("begin apxgen_evolution.control(:id,'PAUSE');apxgen_evolution.advance(:id);end;",{id:a});await db.commit();
 assert.equal((await rows(db,'select state from apxgen_runs where run_id=:id',{id:a}))[0].STATE,'PAUSED');checks++;
 await db.execute("begin apxgen_evolution.control(:id,'RESUME');end;",{id:a});await db.commit();
 assert.equal((await rows(db,'select state from apxgen_runs where run_id=:id',{id:a}))[0].STATE,'RUNNING');checks++;
 await db.execute("begin apxgen_evolution.control(:id,'STOP');apxgen_evolution.advance(:id);end;",{id:a});await db.commit();
 assert.equal((await rows(db,'select state from apxgen_runs where run_id=:id',{id:a}))[0].STATE,'STOPPED');checks++;
 await assert.rejects(()=>createRun(db,{seed:0}));checks++;
 await assert.rejects(()=>db.execute('update apxgen_genomes set canonical_json=canonical_json where fingerprint=(select min(fingerprint) from apxgen_genomes)'));checks++;
 console.log(JSON.stringify({checks,passed:true,runs:[a,b]}));
}finally{await db.rollback();await db.close();}
