import assert from 'node:assert/strict';
import {connect,rows,createRun,oracledb} from '../../scripts/db.mjs';
const db=await connect();let checks=0;
const options=JSON.stringify({mutationRate:.1,crossoverRate:.6,eliteCount:1,tournamentSize:2,diversityThreshold:.5,stagnationLimit:3,generationTimeout:300,totalTimeout:1800});
const configure=(run,json)=>db.execute('begin apxgen_evolution.configure(:run,:json);end;',{run,json});
const metrics=JSON.stringify({overflow:0,overlap:0,clipped:0,missing:0,unnamed:0,focusVisible:1,domNodes:77,viewportsTested:3,errors:0,renderMs:1});
async function finish(run){while(true){const c=await db.execute('begin apxgen_evolution.claim(:run,:id,:token,:g);end;',{run,id:{dir:oracledb.BIND_OUT,type:oracledb.NUMBER},token:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32},g:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:2000}});await db.commit();if(!c.outBinds.id)break;await db.execute('begin apxgen_evolution.submit_evaluation(:id,:token,\'mock-controls\',:m);end;',{id:c.outBinds.id,token:c.outBinds.token,m:metrics});await db.commit();}await db.execute('begin apxgen_evolution.advance(:run);end;',{run});await db.commit();}
try{
 const run=await createRun(db,{label:'TEST bounded laboratory controls',size:4,generations:10});
 await configure(run,options);await db.commit();assert.equal((await rows(db,'select mutation_rate from apxgen_runs where run_id=:run',{run}))[0].MUTATION_RATE,.1);checks++;
 await assert.rejects(()=>configure(run,'{"mutationRate":2}'));await assert.rejects(()=>configure(run,'{"sql":"select 1"}'));await assert.rejects(()=>configure(run,'{"eliteCount":4}'));await db.rollback();checks++;
 await db.execute('begin apxgen_evolution.initialize(:run);apxgen_evolution.run_generations(:run,1);end;',{run});await db.commit();await assert.rejects(()=>configure(run,options));await db.rollback();checks++;
 await finish(run);assert.equal((await rows(db,'select state from apxgen_runs where run_id=:run',{run}))[0].STATE,'PAUSED');checks++;
 await db.execute('begin apxgen_evolution.run_generations(:run,2);apxgen_evolution.advance(:run);end;',{run});await db.commit();await finish(run);await finish(run);const state=(await rows(db,'select state,current_generation from apxgen_runs where run_id=:run',{run}))[0];assert.equal(state.STATE,'PAUSED');assert.equal(state.CURRENT_GENERATION,2);checks++;
 await assert.rejects(()=>db.execute('begin apxgen_evolution.run_generations(:run,0);end;',{run}));await assert.rejects(()=>db.execute('begin apxgen_evolution.run_generations(:run,101);end;',{run}));checks++;
 const result=await db.execute('begin :id:=apxgen_evolution.duplicate_run(:run,2);end;',{run,id:{dir:oracledb.BIND_OUT,type:oracledb.STRING,maxSize:32}});await db.commit();assert.equal((await rows(db,'select diversity_threshold from apxgen_runs where run_id=:run',{run:result.outBinds.id}))[0].DIVERSITY_THRESHOLD,.5);checks++;
 console.log(JSON.stringify({checks,passed:true,run,scope:'Mock observations for durable control boundaries, not research results'}));
}finally{await db.rollback();await db.close();}
