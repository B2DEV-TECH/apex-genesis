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
    if action_name in('GENERATION','CONTROL','STEP','STOP_AI','CHECKPOINT')then
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
        item:=json_object_t();item.put('id',r.run_id);item.put('label',r.label);item.put('mode',r.population_mode);item.put('state',r.state);item.put('generation',r.current_generation);item.put('target',r.target_generations);item.put('pending',r.pending);item.put('best',r.best);item.put('heartbeat',to_char(r.heartbeat,'YYYY-MM-DD HH24:MI:SS TZH:TZM'));list.append(item);
      end loop;j.put('runs',list);list:=json_array_t();
      for e in(select e.event_type,e.details,e.generation from apxgen_events e join apxgen_runs r on r.run_id=e.run_id where r.label not like 'TEST%' order by event_id desc fetch first 12 rows only)loop item:=json_object_t();item.put('type',e.event_type);item.put('details',e.details);item.put('generation',e.generation);list.append(item);end loop;j.put('events',list);
      select json_object('enabled'value enabled,'model'value model_id,'dailyLimit'value daily_limit_usd returning clob)into payload from apxgen_provider_config where singleton=1;j.put('provider',json_element_t.parse(payload));payload:=j.to_clob;
    else
      apxgen_security.require_role('OPERATOR');
      if action_name='CREATE'then
        id:=apxgen_evolution.create_run(apex_application.g_x02,apex_application.g_x03,to_number(apex_application.g_x04),to_number(apex_application.g_x05),to_number(apex_application.g_x06));apxgen_evolution.initialize(id);apxgen_evolution.schedule_run(id);payload:='{"runId":"'||id||'","state":"RUNNING","note":"Browser evaluation worker required"}';
      elsif action_name='CONTROL'then apxgen_evolution.control(run_id,apex_application.g_x03);apxgen_evolution.advance(run_id);payload:='{"ok":true}';
      elsif action_name='STEP'then apxgen_evolution.advance(run_id);payload:='{"ok":true,"note":"Awaiting browser evaluations if candidates are pending"}';
      elsif action_name='STOP_AI'then apxgen_budget.stop_ai(run_id);payload:='{"ok":true}';
      elsif action_name='CHECKPOINT'then id:=apxgen_evolution.duplicate_run(run_id,to_number(apex_application.g_x03));payload:='{"runId":"'||id||'"}';
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
