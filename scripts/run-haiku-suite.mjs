import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {connect,createRun,rows} from './db.mjs';
import {startServer} from './serve.mjs';
import {openEvaluator,evaluatePending} from './evaluate.mjs';
if(!process.argv.includes('--authorized'))throw new Error('Explicit paid-execution authorization is required');
const path='.local/haiku-suite.json',protocol=JSON.parse(await readFile('experiments/configurations/haiku-paired.json','utf8'));
let suite;try{suite=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!suite){
 if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('Commit and verify source before starting the cohort');
 const sourceHashes={};for(const file of execFileSync('git',['ls-files','database','scripts','showcase/renderer','evolution','experiments/configurations/haiku-paired.json'],{encoding:'utf8'}).trim().split('\n'))sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
 suite={experimentId:'genesis-haiku-paired-20261020',protocol,sourceCommit,sourceHashes,startedAt:new Date().toISOString(),runs:[]};
}
for(const[file,hash]of Object.entries(suite.sourceHashes))if(createHash('sha256').update(await readFile(file)).digest('hex')!==hash)throw new Error('Cohort source changed: '+file);
const db=await connect(),server=await startServer(0),e=await openEvaluator('http://127.0.0.1:'+server.address().port);
const save=async()=>{await mkdir('.local',{recursive:true});await writeFile(path,JSON.stringify(suite,null,2));};
try{
 const c=(await rows(db,'select enabled,verified_model_id,total_limit_usd,daily_limit_usd,request_interval,max_requests_per_run,max_input_tokens,max_output_tokens from apxgen_provider_config where singleton=1'))[0];
 if(c.ENABLED!==1||c.VERIFIED_MODEL_ID!=='claude-haiku-5-5'||c.TOTAL_LIMIT_USD>20||c.DAILY_LIMIT_USD>20||c.REQUEST_INTERVAL!==protocol.ai.requestInterval||c.MAX_REQUESTS_PER_RUN!==20||c.MAX_INPUT_TOKENS!==2048||c.MAX_OUTPUT_TOKENS!==256)throw new Error('Provider configuration differs from approved protocol');
 for(const seed of protocol.pairedSeeds)for(const mode of protocol.conditions){
  let run=suite.runs.find(r=>r.mode===mode&&r.seed===seed);
  if(!run){const id=await createRun(db,{label:'HAIKU COHORT '+mode+' seed '+seed,mode,seed,size:protocol.populationSize,generations:protocol.generations});run={id,mode,seed,showcase:seed===42,environment:e.environment};suite.runs.push(run);await save();
   await db.execute('begin apxgen_evolution.configure(:id,:configuration);apxgen_evolution.initialize(:id);end;',{id,configuration:JSON.stringify({mutationRate:protocol.mutationRate,crossoverRate:protocol.crossoverRate,eliteCount:protocol.eliteCount,tournamentSize:protocol.tournamentSize,fitnessWeights:protocol.fitnessWeights})});
   if(mode==='GA_HAIKU')await db.execute('update apxgen_run_budgets set enabled=1,limit_usd=:limit where run_id=:id',{id,limit:protocol.ai.perRunLimitUsd});await db.commit();
  }
  if(run.completedAt)continue;
  run.startedAt??=new Date().toISOString();await save();
  for(;;){const state=(await rows(db,'select state,current_generation from apxgen_runs where run_id=:id',{id:run.id}))[0];if(state.STATE==='COMPLETED')break;if(state.STATE!=='RUNNING')throw new Error('Cohort run requires investigation: '+state.STATE);
   await evaluatePending(db,run.id,e);await db.execute('begin apxgen_evolution.tick(:id);end;',{id:run.id});await db.commit();
   if(state.CURRENT_GENERATION%10===0)console.log(JSON.stringify({mode,seed,generation:state.CURRENT_GENERATION}));
  }
  await db.execute('begin apxgen_budget.stop_ai(:id);end;',{id:run.id});run.completedAt=new Date().toISOString();run.elapsedSeconds=(Date.parse(run.completedAt)-Date.parse(run.startedAt))/1000;
  const counts=(await rows(db,'select count(*) evaluated,sum(case when e.cached_from is not null then 1 else 0 end) cached from apxgen_evaluations e join apxgen_organisms o on o.organism_id=e.organism_id where o.run_id=:id',{id:run.id}))[0];run.evaluated=counts.EVALUATED;run.cached=counts.CACHED;
  if(run.evaluated!==protocol.candidateSlotsPerCondition)throw new Error('Unequal evaluation budget');await save();console.log(JSON.stringify(run));
 }
 suite.completedAt=new Date().toISOString();await save();
}finally{await db.close();await e.close();server.close();}
