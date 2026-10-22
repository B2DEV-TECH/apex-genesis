-- Trusted control API. Installation leaves configuration disabled and unbound.
create or replace package apxgen_app_control authid definer as
 c_capability_version constant varchar2(40):='order-lab-queued-feasibility/1.0';
 c_supported_seed constant number:=50000;
 -- Pure request validation is available for independent boundary contracts.
 function validate_payload(p_payload clob) return clob;
 function status_json return clob;
 function create_draft(p_payload clob) return varchar2;
 procedure enqueue(p_request varchar2);
 procedure cancel_request(p_request varchar2);
 function watch_json(p_request varchar2) return clob;
 procedure ajax;
 -- Direct-owner worker API. No APEX callback exposes these operations or tokens.
 procedure worker_heartbeat(p_binding varchar2);
 function worker_claim(p_binding varchar2,p_lease_seconds number) return clob;
 procedure worker_renew(p_request varchar2,p_binding varchar2,p_token varchar2,p_lease_seconds number);
 procedure worker_attach_run(p_request varchar2,p_binding varchar2,p_token varchar2,p_run varchar2);
 procedure worker_finish(p_request varchar2,p_binding varchar2,p_token varchar2);
 procedure worker_expire_claims(p_binding varchar2);
end apxgen_app_control;
/
create or replace package body apxgen_app_control as
 procedure fail is begin raise_application_error(-20140,'Control unavailable or request outside its authorized bounds');end;
 procedure audit(p_request varchar2,p_state varchar2,p_actor varchar2) is
 begin insert into apxgen_app_control_events(request_id,state,actor) values(p_request,p_state,p_actor);end;
 function config(p_lock boolean default false) return apxgen_app_control_config%rowtype is
  c apxgen_app_control_config%rowtype;n number;
 begin
  if p_lock then select * into c from apxgen_app_control_config where config_id=1 for update nowait;
  else select * into c from apxgen_app_control_config where config_id=1;end if;
  if c.enabled<>1 or c.schema_name is null or c.schema_name<>sys_context('USERENV','CURRENT_USER')
   or c.workspace_id is null or c.control_application_id is null
   or c.control_application_id in(120,121,130,131,132,133) then fail;end if;
  select count(*) into n from apex_applications a join apex_workspace_schemas w
   on w.workspace_name=a.workspace and w.schema=a.owner
   where a.application_id=c.control_application_id and a.owner=c.schema_name and w.workspace_id=c.workspace_id;
  if n<>1 then fail;end if;
  return c;
 exception when no_data_found then fail;return c;
 end;
 function require_session(p_operator boolean default false) return varchar2 is
  c apxgen_app_control_config%rowtype;principal_value varchar2(255);role_name varchar2(8);
 begin
  c:=config;principal_value:=upper(v('APP_USER'));
  if nvl(apex_application.g_flow_id,0)<>c.control_application_id or nvl(apex_application.g_instance,0)<=0
   or nvl(apex_custom_auth.get_security_group_id,-1)<>c.workspace_id or principal_value is null
   or principal_value in('NOBODY','APEX_PUBLIC_USER','ORDS_PUBLIC_USER','PUBLIC','ANONYMOUS')
   or nvl(upper(apex_application.g_user),'NOBODY')<>principal_value then fail;end if;
  if apex_authentication.is_authenticated then null;else fail;end if;
  select control_role into role_name from apxgen_app_control_users where username=principal_value and enabled=1;
  if p_operator and role_name<>'OPERATOR' then fail;end if;
  return role_name;
 exception when no_data_found then fail;return null;
 end;
 function require_worker(p_binding varchar2) return apxgen_app_control_config%rowtype is
  c apxgen_app_control_config%rowtype;
 begin
  if sys_context('USERENV','SESSION_USER')<>sys_context('USERENV','CURRENT_USER')
   or sys_context('USERENV','CURRENT_SCHEMA')<>sys_context('USERENV','CURRENT_USER')
   or nvl(apex_application.g_flow_id,0)<>0 or nvl(apex_application.g_instance,0)<>0
   or v('APP_ID') is not null or v('APP_USER') is not null then fail;end if;
  c:=config(true);
  if c.worker_enabled<>1 or p_binding is null or c.worker_binding is null or p_binding<>c.worker_binding then fail;end if;
  return c;
 end;
 function worker_ready(c apxgen_app_control_config%rowtype) return boolean is
 begin return c.worker_enabled=1 and c.worker_binding is not null and c.worker_seen_at is not null
  and c.worker_seen_at>systimestamp-numtodsinterval(60,'SECOND') and c.worker_seen_at<=systimestamp;end;
 procedure lease_bound(p_seconds number) is
 begin if p_seconds is null or p_seconds<>trunc(p_seconds) or p_seconds not between 30 and 300 then fail;end if;end;
 procedure valid_id(p_id varchar2) is
 begin if p_id is null or not regexp_like(p_id,'^[a-f0-9]{32}$','c') then fail;end if;end;
 function request_json(r apxgen_app_control_requests%rowtype) return json_object_t is
  j json_object_t:=json_object_t();
 begin
  j.put('id',r.request_id);j.put('label',r.label);j.put('state',r.state);j.put('seed',r.seed);
  j.put('generations',r.generations);j.put('materializationBudget',r.materialization_budget);
  if r.run_id is null then j.put_null('runId');else j.put('runId',r.run_id);end if;return j;
 end;
 function status_json return clob is
  c apxgen_app_control_config%rowtype;role_name varchar2(8);j json_object_t:=json_object_t();rows json_array_t:=json_array_t();
 begin
  role_name:=require_session;c:=config;
  j.put('canCreate',role_name='OPERATOR');j.put('canStart',role_name='OPERATOR' and worker_ready(c));
  j.put('capabilityVersion',c_capability_version);j.put('supportedSeed',c_supported_seed);
  j.put('maxGenerations',least(c.max_generations,1));j.put('maxMaterializations',least(c.max_materializations,2));
  for r in(select * from apxgen_app_control_requests order by created_at desc,request_id fetch first 100 rows only) loop rows.append(request_json(r));end loop;
  j.put('requests',rows);return j.to_clob;
 end;
 function validate_payload(p_payload clob) return clob is
  j json_object_t;e json_element_t;k json_key_list;ok number;value_number number;
  function integer_field(p_key varchar2,p_min number,p_max number) return number is
   x number;value json_element_t;
  begin
   value:=j.get(p_key);if value is null or not value.is_number then fail;end if;x:=j.get_number(p_key);
   if x is null or x<>trunc(x) or x not between p_min and p_max then fail;end if;return x;
  end;
 begin
  if p_payload is null or dbms_lob.getlength(p_payload)>2048 then fail;end if;
  select case when p_payload is json strict with unique keys then 1 else 0 end into ok from dual;if ok<>1 then fail;end if;
  j:=json_object_t.parse(p_payload);k:=j.get_keys;if k.count<>4 then fail;end if;
  for i in 1..k.count loop if k(i) not in('label','seed','generations','materializationBudget') then fail;end if;end loop;
  e:=j.get('label');if e is null or not e.is_string then fail;end if;
  if lengthb(j.get_string('label'))>120 or trim(j.get_string('label')) is null
   or regexp_like(j.get_string('label'),'[[:cntrl:]]') then fail;end if;
  value_number:=integer_field('seed',c_supported_seed,c_supported_seed);
  value_number:=integer_field('generations',1,1);value_number:=integer_field('materializationBudget',2,2);
  return j.to_clob;
 end;
 function create_draft(p_payload clob) return varchar2 is
  c apxgen_app_control_config%rowtype;role_name varchar2(8);j json_object_t;validated clob;
  label_text varchar2(120);seed_value number;generation_value number;budget_value number;
  request_id_value varchar2(32):=lower(rawtohex(sys_guid()));
 begin
  c:=config(true);role_name:=require_session(true);validated:=validate_payload(p_payload);j:=json_object_t.parse(validated);
  label_text:=j.get_string('label');seed_value:=j.get_number('seed');generation_value:=j.get_number('generations');budget_value:=j.get_number('materializationBudget');
  if seed_value<>c_supported_seed or generation_value>c.max_generations or budget_value>c.max_materializations then fail;end if;
  insert into apxgen_app_control_requests(request_id,created_by,label,seed,generations,materialization_budget)
   values(request_id_value,upper(v('APP_USER')),label_text,seed_value,generation_value,budget_value);
  audit(request_id_value,'DRAFT',upper(v('APP_USER')));return request_id_value;
 end;
 procedure enqueue(p_request varchar2) is
  c apxgen_app_control_config%rowtype;role_name varchar2(8);r apxgen_app_control_requests%rowtype;
 begin
  c:=config(true);role_name:=require_session(true);valid_id(p_request);
  if not worker_ready(c) then fail;end if;
  select * into r from apxgen_app_control_requests where request_id=p_request for update nowait;
  if r.state<>'DRAFT' or r.seed<>c_supported_seed or r.generations<>1 or r.materialization_budget<>2
   or r.generations>c.max_generations or r.materialization_budget>c.max_materializations then fail;end if;
  update apxgen_app_control_requests set state='QUEUED',queued_at=systimestamp where request_id=p_request;
  audit(p_request,'QUEUED',upper(v('APP_USER')));
 end;
 procedure cancel_request(p_request varchar2) is
  c apxgen_app_control_config%rowtype;role_name varchar2(8);r apxgen_app_control_requests%rowtype;
 begin
  c:=config(true);role_name:=require_session(true);valid_id(p_request);
  select * into r from apxgen_app_control_requests where request_id=p_request for update nowait;
  if r.state not in('DRAFT','QUEUED') then fail;end if;
  update apxgen_app_control_requests set state='CANCELLED',completed_at=systimestamp where request_id=p_request;
  audit(p_request,'CANCELLED',upper(v('APP_USER')));
 end;
 function watch_json(p_request varchar2) return clob is
  role_name varchar2(8);r apxgen_app_control_requests%rowtype;j json_object_t:=json_object_t();item json_object_t;
  organisms json_array_t:=json_array_t();events json_array_t:=json_array_t();
 begin
  role_name:=require_session;valid_id(p_request);select * into r from apxgen_app_control_requests where request_id=p_request;
  j.put('request',request_json(r));j.put_null('run');
  if r.run_id is not null then
   for a in(select * from apxgen_app_runs where run_id=r.run_id) loop
    item:=json_object_t();item.put('id',a.run_id);item.put('state',a.state);item.put('materializations',a.materializations);
    item.put('budget',a.materialization_budget);item.put('fitnessDefinition',a.fitness_definition);j.put('run',item);
   end loop;
   for a in(select * from apxgen_app_organisms where run_id=r.run_id order by generation) loop
    item:=json_object_t();item.put('id',a.organism_id);item.put('generation',a.generation);
    if a.parent_id is null then item.put_null('parentId');else item.put('parentId',a.parent_id);end if;
    if a.application_id is null then item.put_null('applicationId');else item.put('applicationId',a.application_id);end if;
    item.put('state',a.state);item.put('selected',a.selected=1);
    if a.eligible is null then item.put_null('eligible');else item.put('eligible',a.eligible=1);end if;
    if a.fitness is null then item.put_null('fitness');else item.put('fitness',a.fitness);end if;
    if a.reason is null then item.put_null('reason');else item.put('reason',a.reason);end if;organisms.append(item);
   end loop;
   for a in(select e.organism_id,e.state,to_char(sys_extract_utc(e.recorded_at),'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') recorded_at
    from apxgen_app_events e join apxgen_app_organisms o on o.organism_id=e.organism_id where o.run_id=r.run_id order by e.event_id) loop
    item:=json_object_t();item.put('organismId',a.organism_id);item.put('state',a.state);item.put('recordedAt',a.recorded_at);events.append(item);
   end loop;
  end if;
  j.put('organisms',organisms);j.put('events',events);return j.to_clob;
 end;
 procedure worker_heartbeat(p_binding varchar2) is c apxgen_app_control_config%rowtype;
 begin c:=require_worker(p_binding);update apxgen_app_control_config set worker_seen_at=systimestamp where config_id=1;end;
 procedure worker_expire_claims(p_binding varchar2) is c apxgen_app_control_config%rowtype;
 begin
  c:=require_worker(p_binding);
  for r in(select request_id from apxgen_app_control_requests where state='CLAIMED' and lease_until<=systimestamp for update nowait) loop
   update apxgen_app_control_requests set state='UNCERTAIN',completed_at=systimestamp where request_id=r.request_id;
   audit(r.request_id,'UNCERTAIN','WORKER');
  end loop;
 end;
 function worker_claim(p_binding varchar2,p_lease_seconds number) return clob is
  c apxgen_app_control_config%rowtype;r apxgen_app_control_requests%rowtype;j json_object_t;
  token_value varchar2(32):=lower(rawtohex(sys_guid()));
 begin
  c:=require_worker(p_binding);lease_bound(p_lease_seconds);worker_expire_claims(p_binding);
  update apxgen_app_control_config set worker_seen_at=systimestamp where config_id=1;
  for a in(select request_id from apxgen_app_control_requests where state='QUEUED' order by queued_at,request_id) loop
   select * into r from apxgen_app_control_requests where request_id=a.request_id for update nowait;
   if r.seed<>c_supported_seed or r.generations<>1 or r.materialization_budget<>2
    or r.generations>c.max_generations or r.materialization_budget>c.max_materializations then fail;end if;
   update apxgen_app_control_requests set state='CLAIMED',claim_token=token_value,claim_binding=p_binding,
    claimed_at=systimestamp,lease_until=systimestamp+numtodsinterval(p_lease_seconds,'SECOND') where request_id=r.request_id;
   audit(r.request_id,'CLAIMED','WORKER');r.state:='CLAIMED';j:=request_json(r);j.put('claimToken',token_value);return j.to_clob;
  end loop;return null;
 end;
 function owned_claim(p_request varchar2,p_binding varchar2,p_token varchar2) return apxgen_app_control_requests%rowtype is
  c apxgen_app_control_config%rowtype;r apxgen_app_control_requests%rowtype;
 begin
  c:=require_worker(p_binding);valid_id(p_request);valid_id(p_token);
  select * into r from apxgen_app_control_requests where request_id=p_request for update nowait;
  if r.state<>'CLAIMED' or r.claim_binding<>p_binding or r.claim_token<>p_token or r.lease_until<=systimestamp then fail;end if;
  return r;
 end;
 procedure worker_renew(p_request varchar2,p_binding varchar2,p_token varchar2,p_lease_seconds number) is r apxgen_app_control_requests%rowtype;
 begin
  lease_bound(p_lease_seconds);r:=owned_claim(p_request,p_binding,p_token);
  update apxgen_app_control_requests set lease_until=systimestamp+numtodsinterval(p_lease_seconds,'SECOND') where request_id=p_request;
  update apxgen_app_control_config set worker_seen_at=systimestamp where config_id=1;
 end;
 procedure worker_attach_run(p_request varchar2,p_binding varchar2,p_token varchar2,p_run varchar2) is
  r apxgen_app_control_requests%rowtype;a apxgen_app_runs%rowtype;n number;
 begin
  r:=owned_claim(p_request,p_binding,p_token);valid_id(p_run);
  select * into a from apxgen_app_runs where run_id=p_run for update nowait;
  if r.run_id is not null or a.population_mode<>'GA_ONLY' or a.state<>'RUNNING' or a.seed<>r.seed or a.rng_state<>r.seed
   or a.max_generations<>r.generations or a.materialization_budget<>r.materialization_budget or a.label<>r.label
   or a.created_at<r.claimed_at or a.current_generation<>0 or a.materializations<>0 or a.best_organism_id is not null
   or a.fitness_definition<>'order-lab-task-proxy/2.0.0' then fail;end if;
  select count(*) into n from apxgen_app_organisms where run_id=p_run;if n<>1 then fail;end if;
  select count(*) into n from apxgen_app_organisms where run_id=p_run and generation=0 and parent_id is null
   and method='BASELINE' and state='GENOME_CREATED' and application_id is null and artifact_hash is null and metrics_json is null;
  if n<>1 then fail;end if;
  update apxgen_app_control_requests set run_id=p_run where request_id=p_request;audit(p_request,'RUN_LINKED','WORKER');
 end;
 procedure worker_finish(p_request varchar2,p_binding varchar2,p_token varchar2) is
  r apxgen_app_control_requests%rowtype;a apxgen_app_runs%rowtype;state_value varchar2(12);
 begin
  r:=owned_claim(p_request,p_binding,p_token);if r.run_id is null then fail;end if;
  select * into a from apxgen_app_runs where run_id=r.run_id for update nowait;
  if a.state not in('COMPLETE','FAILED','CANCELLED') then fail;end if;
  state_value:=case a.state when 'COMPLETE' then 'COMPLETED' else 'FAILED' end;
  update apxgen_app_control_requests set state=state_value,completed_at=systimestamp where request_id=p_request;
  audit(p_request,state_value,'WORKER');
 end;
 procedure ajax is result_value clob;request_value varchar2(32);response json_object_t:=json_object_t();mutated boolean:=false;position_value number:=1;
 begin
  savepoint control_ajax;
  case apex_application.g_x01
   when 'STATUS' then result_value:=status_json;
   when 'CREATE' then request_value:=create_draft(apex_application.g_x03);result_value:=watch_json(request_value);mutated:=true;
   when 'START' then enqueue(apex_application.g_x02);result_value:=watch_json(apex_application.g_x02);mutated:=true;
   when 'CANCEL' then cancel_request(apex_application.g_x02);result_value:=watch_json(apex_application.g_x02);mutated:=true;
   when 'WATCH' then result_value:=watch_json(apex_application.g_x02);
   else fail;
  end case;
  response.put('ok',true);response.put('data',json_object_t.parse(result_value));
  if mutated then commit;end if;
  result_value:=response.to_clob;
  while position_value<=dbms_lob.getlength(result_value) loop
   htp.prn(dbms_lob.substr(result_value,8000,position_value));position_value:=position_value+8000;
  end loop;
 exception when others then
  begin rollback to control_ajax;exception when others then null;end;
  htp.prn('{"ok":false,"error":"CONTROL_UNAVAILABLE"}');
 end;
end apxgen_app_control;
/
