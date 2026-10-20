import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {connect,createRun,rows,oracledb} from '../../scripts/db.mjs';
import {startServer} from '../../scripts/serve.mjs';
import {openEvaluator,evaluatePending} from '../../scripts/evaluate.mjs';
import {canonicalGenome} from '../../showcase/renderer/genome.mjs';
const db=await connect(),server=await startServer(0),e=await openEvaluator('http://127.0.0.1:'+server.address().port);let checks=0;
async function complete(id,useCache=true){await db.execute('begin apxgen_evolution.initialize(:id);end;',{id});await db.commit();for(let i=0;i<12;i++){await evaluatePending(db,id,e,{useCache});await db.execute('begin apxgen_evolution.advance(:id);end;',{id});await db.commit();if((await rows(db,'select state from apxgen_runs where run_id=:id',{id}))[0].STATE==='COMPLETED')return;}throw new Error('Run did not terminate');}
try{
 const a=await createRun(db,{label:'TEST full deterministic A',seed:201026,size:8,generations:5});const b=await createRun(db,{label:'TEST full deterministic B',seed:201026,size:8,generations:5});await complete(a);await complete(b,false);
 assert.equal((await rows(db,'select count(*) n from apxgen_evaluations e join apxgen_organisms o on o.organism_id=e.organism_id where o.run_id=:id and e.cached_from is not null',{id:b}))[0].N,0);checks++;
 const history=async id=>rows(db,'select o.generation,o.ordinal,o.fingerprint,o.method,e.eligible,e.fitness from apxgen_organisms o join apxgen_evaluations e on e.organism_id=o.organism_id where o.run_id=:id order by o.generation,o.ordinal',{id});const ha=await history(a);assert.deepEqual(ha,await history(b));checks++;
 assert.equal(ha.length,48);assert.equal(new Set(ha.map(x=>x.GENERATION)).size,6);checks++;
 const gens=await rows(db,'select * from apxgen_generations where run_id=:id order by generation',{id:a});assert.ok(gens.every((x,i)=>x.DIVERSITY>0&&x.DIVERSITY<=1&&(i===0||x.BEST_SO_FAR>=gens[i-1].BEST_SO_FAR)));checks++;
 const elite=await rows(db,"select count(*) n from apxgen_organisms c join apxgen_parents p on p.child_id=c.organism_id join apxgen_organisms a on a.organism_id=p.parent_id where c.run_id=:id and c.method='ELITE' and c.fingerprint<>a.fingerprint",{id:a});assert.equal(elite[0].N,0);checks++;
 const genomes=await rows(db,'select g.fingerprint,g.canonical_json from apxgen_genomes g where exists(select 1 from apxgen_organisms o where o.fingerprint=g.fingerprint and o.run_id=:id)',{id:a});
 for(const g of genomes)assert.equal(createHash('sha256').update(canonicalGenome(JSON.parse(g.CANONICAL_JSON))).digest('hex'),g.FINGERPRINT);checks++;
 const checkpoint=await db.execute('begin :id:=apxgen_evolution.duplicate_run(:run,2);end;',{id:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32},run:a});await db.commit();
 assert.equal((await rows(db,'select count(*) n from apxgen_organisms where run_id=:id and generation=0',{id:checkpoint.outBinds.id}))[0].N,8);checks++;
 const bad=await db.execute("begin :id:=apxgen_evolution.create_run('TEST all invalid','GA_ONLY',101,4,1);apxgen_evolution.initialize(:id);end;",{id:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32}});await db.commit();
 for(let i=0;i<4;i++){const c=await db.execute('begin apxgen_evolution.claim(:run,:id,:token,:g);end;',{run:bad.outBinds.id,id:{dir:oracledb.BIND_OUT,type:oracledb.NUMBER},token:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32},g:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:2000}});await db.commit();await db.execute("begin apxgen_evolution.fail_evaluation(:id,:token,'failure-fixture','Intentional failure');end;",{id:c.outBinds.id,token:c.outBinds.token});await db.commit();}
 await db.execute('begin apxgen_evolution.advance(:id);end;',{id:bad.outBinds.id});await db.commit();assert.equal((await rows(db,"select count(*) n from apxgen_events where run_id=:id and event_type='NO_ELIGIBLE_CANDIDATES'",{id:bad.outBinds.id}))[0].N,1);checks++;
 console.log(JSON.stringify({checks,passed:true,runs:[a,b],environment:e.environment}));
}finally{await db.close();await e.close();server.close();}
