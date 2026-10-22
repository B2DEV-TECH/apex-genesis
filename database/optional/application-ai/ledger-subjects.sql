-- UNINSTALLED prototype. Fixed TEST_ONLY owners; no provider HTTP or reservation API.
-- Mandatory read-only harness --preflight checks exact columns and legacy source first.
whenever sqlerror exit failure rollback
set define off
declare n number;k varchar2(64);signature_text varchar2(4000);
 procedure assert_columns(p_owner varchar2,p_table varchar2,p_expected varchar2) is actual varchar2(4000);
 begin
  select listagg(column_name||':'||case when data_type='VARCHAR2' then 'VARCHAR2('||to_char(char_length,'FM9999990')||')' when data_type like 'TIMESTAMP%' then 'TIMESTAMP_TZ' else data_type end||':'||nullable,'|') within group(order by column_name) into actual from all_tab_columns where owner=p_owner and table_name=p_table;
  if actual is null or actual<>p_expected then raise_application_error(-20260,'Unknown prior columns: '||p_owner||'.'||p_table);end if;
 end;
begin
 if user<>'APXGEN_AI_BROKER_TEST' or sys_context('USERENV','SESSION_USER')<>user or sys_context('USERENV','CURRENT_SCHEMA')<>user then raise_application_error(-20260,'Fixed direct TEST_ONLY billing owner required');end if;
 if nvl(apex_application.g_flow_id,0)<>0 or nvl(apex_application.g_instance,0)<>0 or v('APP_ID') is not null or v('APP_USER') is not null then raise_application_error(-20260,'No attached APEX context permitted');end if;
 select kind into k from apxgen_app_ai_test_marker;if k<>'TEST_ONLY_APP_AI_BILLING_V1' then raise_application_error(-20260,'TEST_ONLY marker required');end if;
 select kind into k from APXGEN_APP_BROKER_TEST.apxgen_app_ai_test_marker;if k<>'TEST_ONLY_APP_AI_APPLICATION_V1' then raise_application_error(-20260,'TEST_ONLY application marker required');end if;
 select listagg(table_name,',') within group(order by table_name) into signature_text from user_tables;
 if signature_text<>'APXGEN_APP_AI_TEST_MARKER,APXGEN_INVOCATIONS,APXGEN_ORGANISMS,APXGEN_PROVIDER_CONFIG,APXGEN_RUNS,APXGEN_RUN_BUDGETS' then raise_application_error(-20260,'Unknown prior billing tables; never merge/overwrite');end if;
 -- Admit the physical PROPOSAL CLOB dependencies only through their exact
 -- dictionary relationships. SYS_* spelling never grants an exception.
 select count(*) into n from user_lobs;if n<>1 then raise_application_error(-20260,'Exactly one PROPOSAL LOB required');end if;
 select count(*) into n from user_lobs l
  join user_objects s on s.object_name=l.segment_name and s.object_type='LOB' and s.status='VALID'
  join user_objects o on o.object_name=l.index_name and o.object_type='INDEX' and o.status='VALID'
  join user_indexes i on i.index_name=l.index_name and i.table_name=l.table_name and i.index_type='LOB'
  where l.table_name='APXGEN_INVOCATIONS' and l.column_name='PROPOSAL';
 if n<>1 then raise_application_error(-20260,'PROPOSAL LOB object/index relationship required');end if;
 select count(*) into n from user_objects o where
  ((o.object_type not in('TABLE','INDEX','PACKAGE','PACKAGE BODY')) and not(o.object_type='LOB' and exists(select 1 from user_lobs l where l.table_name='APXGEN_INVOCATIONS' and l.column_name='PROPOSAL' and l.segment_name=o.object_name)))
  or (o.object_type in('PACKAGE','PACKAGE BODY') and o.object_name<>'APXGEN_BUDGET');
 if n<>0 then raise_application_error(-20260,'Unknown prior billing objects');end if;
 select count(*) into n from user_indexes i where
  (i.index_type='LOB' and not exists(select 1 from user_lobs l where l.table_name='APXGEN_INVOCATIONS' and l.column_name='PROPOSAL' and l.index_name=i.index_name and l.table_name=i.table_name))
  or (not exists(select 1 from user_constraints c where c.constraint_type in('P','U') and c.index_name=i.index_name) and not exists(select 1 from user_lobs l where l.table_name='APXGEN_INVOCATIONS' and l.column_name='PROPOSAL' and l.index_name=i.index_name and l.table_name=i.table_name and i.index_type='LOB'));
 if n<>0 then raise_application_error(-20260,'Unknown prior index');end if;
 assert_columns('APXGEN_AI_BROKER_TEST','APXGEN_APP_AI_TEST_MARKER','KIND:VARCHAR2(64):N');
 assert_columns('APXGEN_AI_BROKER_TEST','APXGEN_RUNS','LABEL:VARCHAR2(160):N|POPULATION_MODE:VARCHAR2(20):N|RUN_ID:VARCHAR2(32):N|STATE:VARCHAR2(24):N');
 assert_columns('APXGEN_AI_BROKER_TEST','APXGEN_ORGANISMS','EVALUATION_STATE:VARCHAR2(24):N|GENERATION:NUMBER:N|ORGANISM_ID:NUMBER:N|RUN_ID:VARCHAR2(32):N');
 assert_columns('APXGEN_AI_BROKER_TEST','APXGEN_RUN_BUDGETS','ENABLED:NUMBER:N|LIMIT_USD:NUMBER:N|RUN_ID:VARCHAR2(32):N|STOPPED:NUMBER:N');
 assert_columns('APXGEN_AI_BROKER_TEST','APXGEN_PROVIDER_CONFIG','CREDENTIAL_STATIC_ID:VARCHAR2(255):Y|DAILY_LIMIT_USD:NUMBER:N|ENABLED:NUMBER:N|INPUT_USD_PER_MILLION:NUMBER:Y|MAX_CONCURRENCY:NUMBER:N|MAX_INPUT_TOKENS:NUMBER:N|MAX_OUTPUT_TOKENS:NUMBER:N|MAX_REQUESTS_PER_RUN:NUMBER:N|MODEL_ID:VARCHAR2(128):Y|MODEL_VERIFIED_AT:TIMESTAMP_TZ:Y|OUTPUT_USD_PER_MILLION:NUMBER:Y|PRICING_REVIEWED_AT:TIMESTAMP_TZ:Y|REQUEST_INTERVAL:NUMBER:N|SINGLETON:NUMBER:N|TOTAL_LIMIT_USD:NUMBER:N|VERIFIED_MODEL_ID:VARCHAR2(128):Y');
 assert_columns('APXGEN_AI_BROKER_TEST','APXGEN_INVOCATIONS','ACTUAL_USD:NUMBER:Y|APPLIED_ORGANISM:NUMBER:Y|COMPLETED_AT:TIMESTAMP_TZ:Y|CREATED_AT:TIMESTAMP_TZ:N|ERROR_CODE:VARCHAR2(80):Y|GENERATION:NUMBER:N|INPUT_RATE:NUMBER:N|INPUT_TOKENS:NUMBER:Y|INVOCATION_ID:VARCHAR2(32):N|MAX_INPUT_TOKENS:NUMBER:N|MAX_OUTPUT_TOKENS:NUMBER:N|MODEL_ID:VARCHAR2(128):N|ORGANISM_ID:NUMBER:Y|OUTPUT_RATE:NUMBER:N|OUTPUT_TOKENS:NUMBER:Y|PROPOSAL:CLOB:Y|RESERVED_USD:NUMBER:N|RUN_ID:VARCHAR2(32):N|STATE:VARCHAR2(16):N');
 assert_columns('APXGEN_APP_BROKER_TEST','APXGEN_APP_AI_TEST_MARKER','KIND:VARCHAR2(64):N');
 assert_columns('APXGEN_APP_BROKER_TEST','APXGEN_APP_RUNS','BEST_ORGANISM_ID:VARCHAR2(32):Y|POPULATION_MODE:VARCHAR2(12):N|RUN_ID:VARCHAR2(32):N|STATE:VARCHAR2(16):N');
 assert_columns('APXGEN_APP_BROKER_TEST','APXGEN_APP_ORGANISMS','AI_INVOCATION_ID:VARCHAR2(32):Y|ELIGIBLE:NUMBER:Y|GENERATION:NUMBER:N|GENOME_HASH:VARCHAR2(64):N|METHOD:VARCHAR2(12):N|ORGANISM_ID:VARCHAR2(32):N|PARENT_ID:VARCHAR2(32):Y|RUN_ID:VARCHAR2(32):N|SELECTED:NUMBER:N|STATE:VARCHAR2(24):N');
 assert_columns('APXGEN_APP_BROKER_TEST','APXGEN_APP_CONTROL_CONFIG','CONFIG_ID:NUMBER:N|WORKER_ENABLED:NUMBER:N');
 assert_columns('APXGEN_APP_BROKER_TEST','APXGEN_APP_CONTROL_REQUESTS','REQUEST_ID:VARCHAR2(32):N|STATE:VARCHAR2(12):N');
 select singleton into n from apxgen_provider_config where singleton=1 and enabled=0 and max_concurrency=1 for update;if n<>1 then raise_application_error(-20260,'Disabled exact singleton required');end if;
 select count(*) into n from apxgen_invocations where state='RESERVED';if n<>0 then raise_application_error(-20260,'Active reservation blocks installation');end if;
 select count(*) into n from apxgen_runs where state='RUNNING';if n<>0 then raise_application_error(-20260,'Active legacy run blocks installation');end if;
 select count(*) into n from APXGEN_APP_BROKER_TEST.apxgen_app_runs where state='RUNNING';if n<>0 then raise_application_error(-20260,'Active application run blocks installation');end if;
 select count(*) into n from APXGEN_APP_BROKER_TEST.apxgen_app_control_config where config_id=1 and worker_enabled=0;if n<>1 then raise_application_error(-20260,'Worker must remain disabled');end if;
 select count(*) into n from APXGEN_APP_BROKER_TEST.apxgen_app_control_requests where state in('QUEUED','CLAIMED');if n<>0 then raise_application_error(-20260,'Active native request blocks installation');end if;
end;
/
create table apxgen_app_ai_budgets(
 app_run_id varchar2(32) primary key references APXGEN_APP_BROKER_TEST.apxgen_app_runs(run_id),authorization_id varchar2(32) not null unique,
 schema_name varchar2(128) not null check(schema_name='APXGEN_APP_BROKER_TEST'),workspace_id number(16) not null check(workspace_id>0 and workspace_id=trunc(workspace_id)),authorized_by varchar2(255) not null check(authorized_by like 'TEST_ONLY%'),authorized_at timestamp with time zone default systimestamp not null,expires_at timestamp with time zone not null,
 enabled number default 0 not null check(enabled in(0,1)),stopped number default 0 not null check(stopped in(0,1)),limit_usd number not null check(limit_usd>0 and limit_usd<=100),max_requests number not null check(max_requests between 1 and 100 and max_requests=trunc(max_requests)),max_input_tokens number not null check(max_input_tokens between 1 and 8192 and max_input_tokens=trunc(max_input_tokens)),max_output_tokens number not null check(max_output_tokens between 1 and 1024 and max_output_tokens=trunc(max_output_tokens)),model_id varchar2(128) not null,
 protocol_hash varchar2(64) not null,source_hash varchar2(64) not null,evaluator_hash varchar2(64) not null,mapping_hash varchar2(64) not null,
 constraint app_ai_grant_pair_uq unique(app_run_id,authorization_id),
 constraint app_ai_grant_id_ck check(regexp_like(app_run_id,'^[a-f0-9]{32}$','c') and regexp_like(authorization_id,'^[a-f0-9]{32}$','c')),
 constraint app_ai_grant_hash_ck check(regexp_like(protocol_hash,'^[a-f0-9]{64}$','c') and regexp_like(source_hash,'^[a-f0-9]{64}$','c') and regexp_like(evaluator_hash,'^[a-f0-9]{64}$','c') and regexp_like(mapping_hash,'^[a-f0-9]{64}$','c')),
 constraint app_ai_grant_expiry_ck check(expires_at>authorized_at and expires_at<=authorized_at+interval '1' day));
alter table apxgen_invocations modify(run_id null);
alter table apxgen_invocations add(
 subject_kind varchar2(12) default 'DASHBOARD' not null,
 app_run_id varchar2(32),app_parent_id varchar2(32),applied_app_organism_id varchar2(32),app_authorization_id varchar2(32),app_parent_genome_hash varchar2(64),app_protocol_hash varchar2(64),app_source_hash varchar2(64),app_evaluator_hash varchar2(64),app_mapping_hash varchar2(64),credential_static_id varchar2(255),request_hash varchar2(64),response_hash varchar2(64),
 constraint app_ai_subject_shape_ck check(
  (subject_kind='DASHBOARD' and run_id is not null and app_run_id is null and app_parent_id is null and applied_app_organism_id is null and app_authorization_id is null and app_parent_genome_hash is null and app_protocol_hash is null and app_source_hash is null and app_evaluator_hash is null and app_mapping_hash is null and credential_static_id is null and request_hash is null and response_hash is null) or
  (subject_kind='APPLICATION' and run_id is null and organism_id is null and applied_organism is null and app_run_id is not null and app_parent_id is not null and app_authorization_id is not null and app_parent_genome_hash is not null and app_protocol_hash is not null and app_source_hash is not null and app_evaluator_hash is not null and app_mapping_hash is not null and credential_static_id is not null and created_at is not null and generation>=0 and generation=trunc(generation))),
 constraint app_ai_subject_ids_ck check((app_run_id is null or regexp_like(app_run_id,'^[a-f0-9]{32}$','c')) and (app_parent_id is null or regexp_like(app_parent_id,'^[a-f0-9]{32}$','c')) and (applied_app_organism_id is null or regexp_like(applied_app_organism_id,'^[a-f0-9]{32}$','c')) and (app_authorization_id is null or regexp_like(app_authorization_id,'^[a-f0-9]{32}$','c'))),
 constraint app_ai_subject_hash_ck check((app_parent_genome_hash is null or regexp_like(app_parent_genome_hash,'^[a-f0-9]{64}$','c')) and (app_protocol_hash is null or regexp_like(app_protocol_hash,'^[a-f0-9]{64}$','c')) and (app_source_hash is null or regexp_like(app_source_hash,'^[a-f0-9]{64}$','c')) and (app_evaluator_hash is null or regexp_like(app_evaluator_hash,'^[a-f0-9]{64}$','c')) and (app_mapping_hash is null or regexp_like(app_mapping_hash,'^[a-f0-9]{64}$','c')) and (request_hash is null or regexp_like(request_hash,'^[a-f0-9]{64}$','c')) and (response_hash is null or regexp_like(response_hash,'^[a-f0-9]{64}$','c'))),
 constraint app_ai_usage_shape_ck check(subject_kind='DASHBOARD' or
  (max_input_tokens between 1 and 8192 and max_input_tokens=trunc(max_input_tokens) and max_output_tokens between 1 and 1024 and max_output_tokens=trunc(max_output_tokens) and input_rate>0 and output_rate>0 and (error_code is null or regexp_like(error_code,'^[A-Z][A-Z0-9_-]{0,79}$','c')) and
   ((state='RESERVED' and actual_usd is null and input_tokens is null and output_tokens is null and completed_at is null and proposal is null and error_code is null and response_hash is null) or
    (state='RECONCILED' and actual_usd is not null and actual_usd>=0 and input_tokens is not null and input_tokens>=0 and input_tokens=trunc(input_tokens) and output_tokens is not null and output_tokens>=0 and output_tokens=trunc(output_tokens) and completed_at is not null) or
    (state='UNCERTAIN' and actual_usd is null and input_tokens is null and output_tokens is null and proposal is null and error_code is not null and completed_at is not null)))),
 constraint app_ai_grant_fk foreign key(app_run_id,app_authorization_id) references apxgen_app_ai_budgets(app_run_id,authorization_id),
 constraint app_ai_parent_fk foreign key(app_run_id,app_parent_id) references APXGEN_APP_BROKER_TEST.apxgen_app_organisms(run_id,organism_id),
 constraint app_ai_child_fk foreign key(app_run_id,applied_app_organism_id) references APXGEN_APP_BROKER_TEST.apxgen_app_organisms(run_id,organism_id));
create unique index app_ai_generation_uq on apxgen_invocations(case when subject_kind='APPLICATION' then app_run_id end,case when subject_kind='APPLICATION' then generation end);
create unique index app_ai_applied_child_uq on apxgen_invocations(case when subject_kind='APPLICATION' then applied_app_organism_id end);

create or replace trigger apxgen_app_ai_grant_guard
before insert or update or delete on apxgen_app_ai_budgets for each row
declare n number;
begin
 if sys_context('USERENV','CURRENT_USER')<>'APXGEN_AI_BROKER_TEST' or sys_context('USERENV','SESSION_USER') not in('APXGEN_AI_BROKER_TEST','APXGEN_APP_BROKER_TEST') or nvl(apex_application.g_flow_id,0)<>0 or nvl(apex_application.g_instance,0)<>0 or v('APP_ID') is not null or v('APP_USER') is not null then raise_application_error(-20261,'TEST_ONLY direct worker context required');end if;
 if deleting then raise_application_error(-20261,'Authorization history is permanent');end if;
 -- Direct row DML may already hold a row lock: fail fast rather than wait in
 -- reverse order. Broker procedures must acquire this physical singleton first.
 select singleton into n from apxgen_provider_config where singleton=1 for update nowait;
 if inserting then
  if sys_context('USERENV','SESSION_USER')<>'APXGEN_AI_BROKER_TEST' or :new.enabled<>0 or :new.stopped<>0 then raise_application_error(-20261,'Explicit billing-owner disabled enrollment required');end if;
  select count(*) into n from APXGEN_APP_BROKER_TEST.apxgen_app_runs where run_id=:new.app_run_id and population_mode='GA_HAIKU' and state='RUNNING';if n<>1 then raise_application_error(-20261,'New running application AI run required');end if;
  :new.authorized_at:=systimestamp;
 else
  if :new.app_run_id<>:old.app_run_id or :new.authorization_id<>:old.authorization_id or :new.schema_name<>:old.schema_name or :new.workspace_id<>:old.workspace_id or :new.authorized_by<>:old.authorized_by or :new.authorized_at<>:old.authorized_at or :new.expires_at<>:old.expires_at or :new.limit_usd<>:old.limit_usd or :new.max_requests<>:old.max_requests or :new.max_input_tokens<>:old.max_input_tokens or :new.max_output_tokens<>:old.max_output_tokens or :new.model_id<>:old.model_id or :new.protocol_hash<>:old.protocol_hash or :new.source_hash<>:old.source_hash or :new.evaluator_hash<>:old.evaluator_hash or :new.mapping_hash<>:old.mapping_hash then raise_application_error(-20261,'Authorization identity/caps/provenance immutable');end if;
  if :old.stopped=1 and (:new.stopped<>1 or :new.enabled<>:old.enabled) then raise_application_error(-20261,'Stopped grant cannot resume');end if;
  if :new.enabled>:old.enabled and (sys_context('USERENV','SESSION_USER')<>'APXGEN_AI_BROKER_TEST' or :old.stopped<>0 or :new.expires_at<=systimestamp) then raise_application_error(-20261,'Only explicit current billing-owner opt-in may enable a grant');end if;
  if :new.enabled<:old.enabled then :new.stopped:=1;end if;
 end if;
end;
/
create or replace trigger apxgen_app_ai_inv_guard
before insert or update or delete on apxgen_invocations for each row
declare b apxgen_app_ai_budgets%rowtype;n number;
 function differs(a varchar2,b varchar2) return boolean is begin return (a is null and b is not null) or (a is not null and b is null) or (a<>b);end;
begin
 -- Legacy paths and numeric parent APIs remain untouched.
 if (inserting and :new.subject_kind='APPLICATION') or (not inserting and :old.subject_kind='APPLICATION') then
  if sys_context('USERENV','CURRENT_USER')<>'APXGEN_AI_BROKER_TEST' or sys_context('USERENV','SESSION_USER') not in('APXGEN_AI_BROKER_TEST','APXGEN_APP_BROKER_TEST') or nvl(apex_application.g_flow_id,0)<>0 or nvl(apex_application.g_instance,0)<>0 or v('APP_ID') is not null or v('APP_USER') is not null then raise_application_error(-20262,'TEST_ONLY direct worker context required');end if;
  if deleting then raise_application_error(-20262,'Application invocation history is permanent');end if;
  -- Includes legacy recovery updates. Same-transaction re-entry is safe; a
  -- conflicting provider lock refuses direct DML without a lock-order cycle.
  select singleton into n from apxgen_provider_config where singleton=1 for update nowait;
  if inserting then
   select * into b from apxgen_app_ai_budgets where app_run_id=:new.app_run_id and authorization_id=:new.app_authorization_id for update;
   if b.enabled<>1 or b.stopped<>0 or b.expires_at<=systimestamp or :new.state<>'RESERVED' or :new.actual_usd is not null or :new.input_tokens is not null or :new.output_tokens is not null or :new.proposal is not null or :new.error_code is not null or :new.completed_at is not null or :new.applied_app_organism_id is not null or :new.response_hash is not null then raise_application_error(-20262,'Fresh opted-in unfinished application invocation required');end if;
   if :new.app_protocol_hash<>b.protocol_hash or :new.app_source_hash<>b.source_hash or :new.app_evaluator_hash<>b.evaluator_hash or :new.app_mapping_hash<>b.mapping_hash or :new.model_id<>b.model_id or :new.max_input_tokens>b.max_input_tokens or :new.max_output_tokens>b.max_output_tokens then raise_application_error(-20262,'Invocation differs from immutable grant');end if;
   select count(*) into n from APXGEN_APP_BROKER_TEST.apxgen_app_organisms o join APXGEN_APP_BROKER_TEST.apxgen_app_runs r on r.run_id=o.run_id where o.organism_id=:new.app_parent_id and o.run_id=:new.app_run_id and o.generation=:new.generation and o.genome_hash=:new.app_parent_genome_hash and o.selected=1 and o.eligible=1 and o.state='SELECTED' and r.best_organism_id=o.organism_id and r.state='RUNNING' and r.population_mode='GA_HAIKU';if n<>1 then raise_application_error(-20262,'Actual evaluated application incumbent required');end if;
  else
   if differs(:new.subject_kind,:old.subject_kind) or differs(:new.invocation_id,:old.invocation_id) or differs(:new.run_id,:old.run_id) or differs(to_char(:new.organism_id),to_char(:old.organism_id)) or differs(to_char(:new.applied_organism),to_char(:old.applied_organism)) or differs(:new.app_run_id,:old.app_run_id) or differs(:new.app_parent_id,:old.app_parent_id) or differs(:new.app_authorization_id,:old.app_authorization_id) or differs(:new.app_parent_genome_hash,:old.app_parent_genome_hash) or differs(:new.app_protocol_hash,:old.app_protocol_hash) or differs(:new.app_source_hash,:old.app_source_hash) or differs(:new.app_evaluator_hash,:old.app_evaluator_hash) or differs(:new.app_mapping_hash,:old.app_mapping_hash) or differs(:new.credential_static_id,:old.credential_static_id) or :new.generation<>:old.generation or :new.model_id<>:old.model_id or :new.input_rate<>:old.input_rate or :new.output_rate<>:old.output_rate or :new.max_input_tokens<>:old.max_input_tokens or :new.max_output_tokens<>:old.max_output_tokens or :new.reserved_usd<>:old.reserved_usd or :new.created_at<>:old.created_at then raise_application_error(-20262,'Invocation identity/reservation immutable');end if;
   if (:old.state<>'RESERVED' and :new.state<>:old.state) or (:old.state='RESERVED' and :new.state not in('RESERVED','RECONCILED','UNCERTAIN','REJECTED')) then raise_application_error(-20262,'Invalid invocation finalization');end if;
   if :old.actual_usd is not null and (differs(to_char(:new.actual_usd),to_char(:old.actual_usd)) or differs(to_char(:new.input_tokens),to_char(:old.input_tokens)) or differs(to_char(:new.output_tokens),to_char(:old.output_tokens))) then raise_application_error(-20262,'Known usage immutable');end if;
   if :old.proposal is not null and (:new.proposal is null or dbms_lob.compare(:old.proposal,:new.proposal)<>0) then raise_application_error(-20262,'Approved proposal immutable');end if;
   if :old.request_hash is not null and differs(:new.request_hash,:old.request_hash) or :old.response_hash is not null and differs(:new.response_hash,:old.response_hash) or :old.error_code is not null and differs(:new.error_code,:old.error_code) then raise_application_error(-20262,'Recorded evidence immutable');end if;
   if :old.applied_app_organism_id is not null and differs(:new.applied_app_organism_id,:old.applied_app_organism_id) then raise_application_error(-20262,'Application child binds once');end if;
   if :new.applied_app_organism_id is not null and :old.applied_app_organism_id is null then
    if :new.state<>'RECONCILED' or :new.proposal is null or :new.error_code is not null or :new.actual_usd is null or :new.input_tokens is null or :new.output_tokens is null or :new.input_tokens>:new.max_input_tokens or :new.output_tokens>:new.max_output_tokens or :new.actual_usd>:new.reserved_usd then raise_application_error(-20262,'Approved reconciled bounded-usage proposal required');end if;
    select count(*) into n from APXGEN_APP_BROKER_TEST.apxgen_app_organisms where organism_id=:new.applied_app_organism_id and run_id=:new.app_run_id and parent_id=:new.app_parent_id and generation=:new.generation+1 and method='AI_PROPOSAL' and ai_invocation_id=:new.invocation_id;if n<>1 then raise_application_error(-20262,'Actual same-transaction application child/provenance required');end if;
   end if;
  end if;
  -- Uses OLD/NEW only: no mutating-table query and no autonomous transaction.
  -- Also fires when the unchanged legacy recover_stale scans application rows.
  if :new.state='UNCERTAIN' or :new.error_code is not null or :new.input_tokens>:new.max_input_tokens or :new.output_tokens>:new.max_output_tokens or :new.actual_usd>:new.reserved_usd then update apxgen_app_ai_budgets set stopped=1 where app_run_id=:new.app_run_id;end if;
 elsif updating and :new.subject_kind<>:old.subject_kind then raise_application_error(-20262,'Cannot retag a legacy invocation');
 end if;
exception when no_data_found then raise_application_error(-20262,'Actual application authorization required');
end;
/
grant references on apxgen_invocations to APXGEN_APP_BROKER_TEST;
create or replace package apxgen_app_ai_subjects authid definer as
 procedure bind_child(p_invocation varchar2,p_child varchar2);
end;
/
create or replace package body apxgen_app_ai_subjects as
 procedure bind_child(p_invocation varchar2,p_child varchar2) is i apxgen_invocations%rowtype;n number;
 begin
  if sys_context('USERENV','SESSION_USER') not in('APXGEN_AI_BROKER_TEST','APXGEN_APP_BROKER_TEST') or p_invocation is null or p_child is null or not regexp_like(p_invocation,'^[a-f0-9]{32}$','c') or not regexp_like(p_child,'^[a-f0-9]{32}$','c') or nvl(apex_application.g_flow_id,0)<>0 or nvl(apex_application.g_instance,0)<>0 or v('APP_ID') is not null or v('APP_USER') is not null then raise_application_error(-20262,'TEST_ONLY direct worker and exact IDs required');end if;
  select singleton into n from apxgen_provider_config where singleton=1 for update nowait;
  select * into i from apxgen_invocations where invocation_id=p_invocation and subject_kind='APPLICATION' for update nowait;
  if i.applied_app_organism_id=p_child then return;end if;
  if i.applied_app_organism_id is not null then raise_application_error(-20262,'Application child already bound');end if;
  update apxgen_invocations set applied_app_organism_id=p_child where invocation_id=p_invocation;
  -- Deliberately no COMMIT and no autonomous transaction: caller inserts child,
  -- verifies the reciprocal FK and commits the child + binding together.
 end;
end;
/
grant execute on apxgen_app_ai_subjects to APXGEN_APP_BROKER_TEST;
-- Table metadata invalidates dependent %ROWTYPE bodies; source remains unchanged.
alter package apxgen_budget compile body;
commit;
