create or replace package apxgen_web authid definer as
  procedure ajax;
end apxgen_web;
/
create or replace package body apxgen_web as
  procedure emit(p_data clob) is offset_n pls_integer:=1;
  begin while offset_n<=dbms_lob.getlength(p_data)loop htp.prn(dbms_lob.substr(p_data,8000,offset_n));offset_n:=offset_n+8000;end loop;end;
  procedure ajax is
    action_name varchar2(40);run_id varchar2(32);payload clob;id varchar2(32);j json_object_t;list json_array_t;item json_object_t;
  begin
    if apex_application.g_x01 is null or length(apex_application.g_x01)>40 then raise_application_error(-20062,'Invalid laboratory action');end if;
    action_name:=apex_application.g_x01;
    if action_name in('GENERATION','CONTROL','STEP','RUN_N','STOP_AI','CHECKPOINT')then
      if not regexp_like(apex_application.g_x02,'^[a-f0-9]{32}$')then raise_application_error(-20062,'Invalid run identifier');end if;
      run_id:=apex_application.g_x02;
    end if;
    apex_debug.message('GENESIS callback action=%s',action_name);
    apxgen_security.require_role('READER');
    if action_name='INDEX' then payload:=apxgen_export.index_json;
    elsif action_name='GENERATION'then payload:=apxgen_export.generation_json(run_id,to_number(apex_application.g_x03));
    elsif action_name='STATUS'then
      j:=json_object_t();list:=json_array_t();
      for r in(select r.run_id,r.label,r.population_mode,r.state,r.current_generation,r.target_generations,r.heartbeat,r.evaluation_context,(select count(*)from apxgen_organisms o where o.run_id=r.run_id and o.evaluation_state='PENDING') pending,(select max(best_so_far)from apxgen_generations g where g.run_id=r.run_id) best from apxgen_runs r where label not like 'TEST%' order by created_at desc fetch first 30 rows only)loop
        item:=json_object_t();item.put('id',r.run_id);item.put('label',r.label);item.put('mode',r.population_mode);item.put('state',r.state);item.put('generation',r.current_generation);item.put('target',r.target_generations);item.put('pending',r.pending);item.put('best',r.best);item.put('heartbeat',to_char(r.heartbeat,'YYYY-MM-DD HH24:MI:SS TZH:TZM'));
        declare metrics_json clob;begin
          select json_object('mutationRate'value mutation_rate,'elapsedSeconds'value round((cast(nvl(ended_at,systimestamp)as date)-cast(started_at as date))*86400),'mean'value(select max(mean_fitness)keep(dense_rank last order by generation)from apxgen_generations g where g.run_id=r.run_id and g.state='COMPLETE'),'diversity'value(select max(diversity)keep(dense_rank last order by generation)from apxgen_generations g where g.run_id=r.run_id and g.state='COMPLETE'),'pending'value(select count(*)from apxgen_organisms o where o.run_id=r.run_id and o.evaluation_state not in('COMPLETE','FAILED')) returning clob)into metrics_json from apxgen_runs where run_id=r.run_id;
          j:=json_object_t.parse(metrics_json);
          item.put('mutationRate',j.get_number('mutationRate'));item.put('elapsedSeconds',j.get_number('elapsedSeconds'));item.put('mean',j.get_number('mean'));item.put('diversity',j.get_number('diversity'));item.put('pending',j.get_number('pending'));
          select json_object('aiRequests'value count(*),'inputTokens'value nvl(sum(input_tokens),0),'outputTokens'value nvl(sum(output_tokens),0),'usageBasedCostUsd'value nvl(sum(actual_usd),0),'uncertainReservedUsd'value nvl(sum(case when state in('UNCERTAIN','RESERVED')then reserved_usd else 0 end),0) returning clob)into metrics_json from apxgen_invocations where run_id=r.run_id;
          j:=json_object_t.parse(metrics_json);item.put('aiRequests',j.get_number('aiRequests'));item.put('inputTokens',j.get_number('inputTokens'));item.put('outputTokens',j.get_number('outputTokens'));item.put('usageBasedCostUsd',j.get_number('usageBasedCostUsd'));item.put('uncertainReservedUsd',j.get_number('uncertainReservedUsd'));
          list.append(item);
        end;
      end loop;j:=json_object_t();j.put('runs',list);list:=json_array_t();
      for e in(select e.run_id,e.event_type,e.details,e.generation from apxgen_events e join apxgen_runs r on r.run_id=e.run_id where r.label not like 'TEST%' order by event_id desc fetch first 100 rows only)loop item:=json_object_t();item.put('runId',e.run_id);item.put('type',e.event_type);item.put('details',e.details);item.put('generation',e.generation);list.append(item);end loop;j.put('events',list);
      select json_object('enabled'value enabled,'model'value model_id,'dailyLimit'value daily_limit_usd returning clob)into payload from apxgen_provider_config where singleton=1;j.put('provider',json_element_t.parse(payload));payload:=j.to_clob;
    else
      apxgen_security.require_role('OPERATOR');
      if action_name='CREATE'then
        id:=apxgen_evolution.create_run(apex_application.g_x02,apex_application.g_x03,to_number(apex_application.g_x04),to_number(apex_application.g_x05),to_number(apex_application.g_x06));if apex_application.g_x07 is not null then apxgen_evolution.configure(id,apex_application.g_x07);end if;apxgen_evolution.initialize(id);apxgen_evolution.schedule_run(id);payload:='{"runId":"'||id||'","state":"RUNNING","note":"Browser evaluation worker required"}';
      elsif action_name='CONTROL'then apxgen_evolution.control(run_id,apex_application.g_x03);apxgen_evolution.advance(run_id);payload:='{"ok":true}';
      elsif action_name='STEP'then apxgen_evolution.run_generations(run_id,1);apxgen_evolution.advance(run_id);payload:='{"ok":true,"note":"Will pause at the next completed generation boundary"}';
      elsif action_name='RUN_N'then apxgen_evolution.run_generations(run_id,to_number(apex_application.g_x03));apxgen_evolution.advance(run_id);payload:='{"ok":true,"note":"Bounded generation request recorded; browser worker required"}';
      elsif action_name='STOP_AI'then apxgen_budget.stop_ai(run_id);payload:='{"ok":true}';
      -- Autonomous operations panel (OPERATOR). Commands are queued; the supervisor applies them.
      elsif action_name='OPS_STATUS'then payload:=apxgen_autonomy.status_json;
      elsif action_name='OPS_COMMAND'then id:=apxgen_autonomy.enqueue(apex_application.g_x02,upper(v('APP_USER')));payload:='{"ok":true,"commandId":'||id||',"note":"Queued for the supervisor"}';
      elsif action_name='OPS_LOG'then payload:=apxgen_autonomy.log_json(to_number(nvl(apex_application.g_x02,'100')));
      elsif action_name='OPS_PUBLICATION'then payload:=apxgen_autonomy.publications_json(to_number(nvl(apex_application.g_x02,'50')));
      elsif action_name='CHECKPOINT'then id:=apxgen_evolution.duplicate_run(run_id,to_number(apex_application.g_x03));apxgen_evolution.schedule_run(id);payload:='{"runId":"'||id||'"}';
      elsif action_name='VOTE'then
        declare preferred number:=to_number(apex_application.g_x02);alternative number:=to_number(apex_application.g_x03);n number;preferred_run varchar2(32);begin
          select count(*)into n from apxgen_organisms a join apxgen_organisms b on b.organism_id=alternative join apxgen_runs ar on ar.run_id=a.run_id join apxgen_runs br on br.run_id=b.run_id where a.organism_id=preferred and a.organism_id<>b.organism_id and a.generation=b.generation and ar.evaluation_context=br.evaluation_context and a.evaluation_state='COMPLETE' and b.evaluation_state='COMPLETE';
          if n<>1 then raise_application_error(-20063,'Comparable evaluated organisms required');end if;
          select run_id into preferred_run from apxgen_organisms where organism_id=preferred;
          insert into apxgen_votes(run_id,preferred_id,alternative_id,actor)values(preferred_run,preferred,alternative,upper(v('APP_USER')));payload:='{"ok":true,"note":"Preference stored separately; technical fitness is unchanged"}';
        end;
      else raise_application_error(-20062,'Unsupported laboratory action');end if;
      commit;
    end if;apex_debug.message('GENESIS response characters=%s',dbms_lob.getlength(payload));emit(payload);
  exception when others then
    declare error_no number:=sqlcode;response json_object_t:=json_object_t();begin
      rollback;apex_debug.message('GENESIS rejected code=%s',error_no);response.put('error','Genesis request rejected');response.put('code',error_no);emit(response.to_clob);
    end;
  end;
end apxgen_web;
/
