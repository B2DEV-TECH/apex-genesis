create or replace package apxgen_app_fitness authid definer as
  c_fitness_definition constant varchar2(40):='order-lab-task-proxy/2.0.0';
  c_protocol_version constant varchar2(40):='application-fitness-2.0';
  -- Trusted evaluator evidence only. These functions do not execute browser tasks.
  procedure score(p_genome clob,p_metrics clob,p_eligible out number,p_fitness out number,
    p_task_effort out number,p_navigation out number,p_accessibility out number,
    p_performance out number,p_simplicity out number);
end apxgen_app_fitness;
/
create or replace package body apxgen_app_fitness as
  function required_text(p_object json_object_t,p_key varchar2) return varchar2 is v json_element_t;txt varchar2(32767);
  begin
    if not p_object.has(p_key) then raise_application_error(-20120,'Missing evidence string');end if;
    v:=p_object.get(p_key);
    if v is null or not v.is_string then raise_application_error(-20120,'Evidence strings must not be coerced');end if;
    txt:=p_object.get_string(p_key);
    if txt is null then raise_application_error(-20120,'Empty evidence strings are rejected');end if;
    return txt;
  end;

  function required_flag(p_object json_object_t,p_key varchar2) return number is v json_element_t;
  begin
    if not p_object.has(p_key) then raise_application_error(-20120,'Missing evidence boolean');end if;
    v:=p_object.get(p_key);
    if v is null or not v.is_boolean then raise_application_error(-20120,'Evidence booleans must not be coerced');end if;
    return case when p_object.get_boolean(p_key) then 1 else 0 end;
  end;

  function required_integer(p_object json_object_t,p_key varchar2,p_min number,p_max number) return number is
    v json_element_t;n number;
  begin
    if not p_object.has(p_key) then raise_application_error(-20120,'Missing evidence integer');end if;
    v:=p_object.get(p_key);
    if v is null or not v.is_number then raise_application_error(-20120,'Evidence integers must not be coerced');end if;
    n:=p_object.get_number(p_key);
    if n is null or n<>trunc(n) or n not between p_min and p_max then
      raise_application_error(-20120,'Evidence integer is outside its bounds');
    end if;
    return n;
  end;

  function bounded_score(p_value number,p_ideal number,p_ceiling number) return number is
  begin return greatest(0,least(100,100*(p_ceiling-p_value)/(p_ceiling-p_ideal)));end;

  procedure score(p_genome clob,p_metrics clob,p_eligible out number,p_fitness out number,
    p_task_effort out number,p_navigation out number,p_accessibility out number,
    p_performance out number,p_simplicity out number) is
    m json_object_t;tasks json_object_t;t json_object_t;strict_json number;
    verified number:=1;task_success number:=1;a11y_failures number:=0;
    actions number;steps number;success number;task_total number:=0;navigation_total number:=0;
    viewports number;runtime_errors number;load_ms number;components number;key_name varchar2(40);
  begin
    p_eligible:=0;p_fitness:=0;p_task_effort:=0;p_navigation:=0;
    p_accessibility:=0;p_performance:=0;p_simplicity:=0;
    -- Canonical fingerprint also validates the genome without changing old state.
    if p_metrics is null or dbms_lob.getlength(p_metrics)>8192 then
      raise_application_error(-20120,'Application evidence is absent or too large');
    end if;
    select case when p_metrics is json strict with unique keys then 1 else 0 end into strict_json from dual;
    if strict_json<>1 then raise_application_error(-20120,'Strict unique-key evidence JSON required');end if;
    m:=json_object_t.parse(p_metrics);m.on_error(1);
    if m.get_size<>20 or required_text(m,'fitnessDefinition')<>c_fitness_definition
      or required_text(m,'protocolVersion')<>c_protocol_version then
      raise_application_error(-20120,'Application evidence protocol rejected');
    end if;
    if required_text(m,'genomeFingerprint')<>apxgen_app_genome.fingerprint(p_genome) then
      raise_application_error(-20120,'Evidence belongs to a different application genome');
    end if;
    -- Every flag is parsed, including flags after the first failed gate.
    verified:=verified*required_flag(m,'compilerValidated');
    verified:=verified*required_flag(m,'importVerified');
    verified:=verified*required_flag(m,'authenticationVerified');
    verified:=verified*required_flag(m,'runtimeVerified');
    verified:=verified*required_flag(m,'fixtureVerified');
    verified:=verified*required_flag(m,'databaseChangeVerified');
    verified:=verified*required_flag(m,'securityVerified');
    tasks:=m.get_object('tasks');tasks.on_error(1);
    if tasks.get_size<>3 then raise_application_error(-20120,'Exactly three task observations required');end if;
    for i in 1..3 loop
      key_name:=case i when 1 then 'locateOrder' when 2 then 'filterOrders' else 'updateOrder' end;
      t:=tasks.get_object(key_name);t.on_error(1);
      if t.get_size<>3 then raise_application_error(-20120,'Unknown task observation property');end if;
      success:=required_flag(t,'success');
      actions:=required_integer(t,'actions',0,100000);
      steps:=required_integer(t,'navigationSteps',0,100000);
      if steps>actions or (success=1 and actions=0) then
        raise_application_error(-20120,'Contradictory task observations');
      end if;
      task_success:=task_success*success;
      task_total:=task_total+bounded_score(actions,case i when 1 then 2 when 2 then 3 else 4 end,
        case i when 1 then 12 when 2 then 15 else 20 end);
      navigation_total:=navigation_total+bounded_score(steps,case i when 3 then 1 else 0 end,
        case i when 3 then 6 else 4 end);
    end loop;
    viewports:=required_integer(m,'viewportsTested',0,3);
    a11y_failures:=a11y_failures+required_integer(m,'criticalViolations',0,100000);
    a11y_failures:=a11y_failures+required_integer(m,'seriousViolations',0,100000);
    a11y_failures:=a11y_failures+required_integer(m,'unnamedControls',0,100000);
    a11y_failures:=a11y_failures+required_integer(m,'focusFailures',0,100000);
    a11y_failures:=a11y_failures+required_integer(m,'horizontalOverflow',0,100000);
    runtime_errors:=required_integer(m,'runtimeErrors',0,100000);
    load_ms:=required_integer(m,'loadMs',0,3600000);
    components:=required_integer(m,'componentCount',1,100000);
    p_task_effort:=round(task_total/3,6);
    p_navigation:=round(navigation_total/3,6);
    p_accessibility:=case when viewports=3 and a11y_failures=0 then 100 else 0 end;
    p_performance:=round(bounded_score(load_ms,500,5000),6);
    p_simplicity:=greatest(0,100-2*greatest(0,components-10));
    p_eligible:=case when verified=1 and task_success=1 and p_accessibility=100 and runtime_errors=0 then 1 else 0 end;
    -- Weight raw component values; round only the authoritative final score.
    if p_eligible=1 then
      p_fitness:=round(.35*(task_total/3)+.25*(navigation_total/3)+.20*p_accessibility
        +.10*bounded_score(load_ms,500,5000)+.10*p_simplicity,6);
    end if;
  exception when others then
    raise_application_error(-20120,'Application evidence rejected by strict fitness protocol');
  end;
end apxgen_app_fitness;
/
