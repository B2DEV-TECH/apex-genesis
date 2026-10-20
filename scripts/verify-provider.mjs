import {connect,config,rows} from './db.mjs';import {mkdir,writeFile} from 'node:fs/promises';
const args=Object.fromEntries(process.argv.slice(2).map(s=>s.replace(/^--/,'').split('='))),limit=Number(args['authorized-total-usd']),input=Number(args['input-price']),output=Number(args['output-price']);
if(!(limit>0&&limit<=100&&input>0&&output>0))throw new Error('Explicit owner-authorized total and freshly reviewed input/output prices are required');
const db=await connect(),local=await config();
try{
 await db.execute('begin apex_util.set_security_group_id(apex_util.find_security_group_id(:workspace));end;',{workspace:local.workspace});
 const c=(await rows(db,'select credential_static_id,model_id from apxgen_provider_config where singleton=1'))[0];if(!c.CREDENTIAL_STATIC_ID||!c.MODEL_ID)throw new Error('Configure the secure Web Credential first');
 const exists=(await rows(db,'select count(*) n from apex_workspace_credentials where static_id=:id',{id:c.CREDENTIAL_STATIC_ID}))[0].N;if(exists!==1)throw new Error('Configured Web Credential not found in the dedicated workspace');
 await db.execute("update apxgen_run_budgets set enabled=0,stopped=1 where run_id in(select run_id from apxgen_runs where label like 'TEST%' or label like 'Checkpoint of TEST%')");
 await db.execute('update apxgen_provider_config set enabled=1,total_limit_usd=:limit,daily_limit_usd=:limit,input_usd_per_million=:input,output_usd_per_million=:output,pricing_reviewed_at=systimestamp,max_input_tokens=2048,max_output_tokens=256,max_requests_per_run=20,request_interval=5 where singleton=1',{limit,input,output});await db.commit();
 await db.execute('begin apxgen_ai.verify_model;end;');
 const verified=(await rows(db,"select verified_model_id, to_char(model_verified_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"') verified_at from apxgen_provider_config where singleton=1"))[0];
 const evidence={verified:true,model:verified.VERIFIED_MODEL_ID,verifiedAt:verified.VERIFIED_AT,authorizedTotalUsd:limit,dailyLimitUsd:limit,inputUsdPerMillion:input,outputUsdPerMillion:output,pricingSource:'https://platform.claude.com/docs/en/about-claude/pricing',scope:'Actual Oracle HTTPS model lookup using an APEX Web Credential; no Messages request or run opt-in performed'};
 await mkdir('docs/testing',{recursive:true});await writeFile('docs/testing/provider-verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}catch(error){await db.rollback();await db.execute('update apxgen_provider_config set enabled=0 where singleton=1');await db.commit();console.error('Provider verification rejected:',error.code||error.message);process.exitCode=1;}finally{await db.close();}
