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
  try{await db.execute('begin apxgen_evolution.tick(:id);end;',{id:run});}catch(error){if(error.errorNum!==54)throw error;}
  if(result.evaluated===0)await new Promise(resolve=>setTimeout(resolve,1000));
  if(Number(args['generation-delay-ms'])>0)await new Promise(resolve=>setTimeout(resolve,Math.min(5000,Number(args['generation-delay-ms']))));
  if(r.CURRENT_GENERATION%10===0)console.log(JSON.stringify({run,generation:r.CURRENT_GENERATION,...totals}));
 }
 await mkdir('.local',{recursive:true});await writeFile('.local/latest-run.txt',run);
}finally{await evaluator.close();await db.close();server.close();}
