import {connect,createRun,rows} from './db.mjs';
import {openEvaluator,evaluatePending} from './evaluate.mjs';
import {startServer} from './serve.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
const server=await startServer(0);const evaluator=await openEvaluator('http://127.0.0.1:'+server.address().port);const db=await connect();
try{
 const run=args.run||await createRun(db,{label:args.label||'Genesis recorded experiment',mode:args.mode||'GA_ONLY',seed:Number(args.seed||42),size:Number(args.size||12),generations:Number(args.generations||100)});
 await db.execute('begin apxgen_evolution.initialize(:id);end;',{id:run});await db.commit();
 let totals={evaluated:0,cached:0};const started=Date.now();
 while(true){const r=(await rows(db,'select state,current_generation from apxgen_runs where run_id=:id',{id:run}))[0];if(r.STATE!=='RUNNING'){console.log(JSON.stringify({run,...r,...totals,elapsedSeconds:(Date.now()-started)/1000}));break;}
  const result=await evaluatePending(db,run,evaluator);totals.evaluated+=result.evaluated;totals.cached+=result.cached;
  const ai=await rows(db,"select c.request_interval from apxgen_provider_config c join apxgen_run_budgets b on b.run_id=:run join apxgen_runs r on r.run_id=b.run_id where c.singleton=1 and c.enabled=1 and b.enabled=1 and b.stopped=0 and r.population_mode='GA_HAIKU'",{run});
  if(ai.length&&(r.CURRENT_GENERATION+1)%ai[0].REQUEST_INTERVAL===0){const parents=await rows(db,'select o.organism_id from apxgen_organisms o join apxgen_evaluations e on e.organism_id=o.organism_id where o.run_id=:run and o.generation=:gen and e.eligible=1 order by e.fitness desc,o.ordinal fetch first 1 row only',{run,gen:r.CURRENT_GENERATION});
   if(parents.length){try{await db.execute('begin apxgen_ai.propose(:run,:parent);end;',{run,parent:parents[0].ORGANISM_ID});}catch(error){console.log(JSON.stringify({run,generation:r.CURRENT_GENERATION,aiFallback:true,error:error.code||'PROVIDER_FAILURE'}));}}
  }
  await db.execute('begin apxgen_evolution.advance(:id);end;',{id:run});await db.commit();
  if(r.CURRENT_GENERATION%10===0)console.log(JSON.stringify({run,generation:r.CURRENT_GENERATION,...totals}));
 }
 await mkdir('.local',{recursive:true});await writeFile('.local/latest-run.txt',run);
}finally{await evaluator.close();await db.close();server.close();}
