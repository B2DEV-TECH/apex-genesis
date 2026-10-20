import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {connect,createRun,rows} from './db.mjs';
import {startServer} from './serve.mjs';
import {openEvaluator,evaluatePending} from './evaluate.mjs';
const protocol=JSON.parse(await readFile('experiments/configurations/offline-paired.json','utf8'));
const db=await connect(),server=await startServer(0),e=await openEvaluator('http://127.0.0.1:'+server.address().port),runs=[];
try{
 for(const seed of protocol.pairedSeeds)for(const mode of protocol.conditions){
  const id=await createRun(db,{label:(seed===42?'SHOWCASE ':'REPLICATION ')+mode+' seed '+seed,mode,seed,size:protocol.populationSize,generations:protocol.generations});
  await db.execute('begin apxgen_evolution.initialize(:id);end;',{id});await db.commit();
  const started=Date.now();let evaluated=0,cached=0;
  for(let i=0;i<=protocol.generations;i++){const r=await evaluatePending(db,id,e);evaluated+=r.evaluated;cached+=r.cached;await db.execute('begin apxgen_evolution.advance(:id);end;',{id});await db.commit();}
  const final=(await rows(db,'select state,current_generation from apxgen_runs where run_id=:id',{id}))[0];if(final.STATE!=='COMPLETED'||final.CURRENT_GENERATION!==100)throw new Error('Experiment did not complete');
  const result={id,mode,seed,showcase:seed===42,evaluated,cached,elapsedSeconds:(Date.now()-started)/1000,environment:e.environment};runs.push(result);console.log(JSON.stringify(result));
  await mkdir('.local',{recursive:true});await writeFile('.local/offline-suite.json',JSON.stringify({protocol,runs},null,2));
 }
}finally{await db.close();await e.close();server.close();}
