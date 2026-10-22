-- UNINSTALLED TEST_ONLY fixture. Never run in APXGEN_LAB or a runtime schema.
whenever sqlerror exit failure rollback
set define off
declare n number;
begin
 if user<>'APXGEN_AI_BROKER_TEST' or sys_context('USERENV','SESSION_USER')<>user or sys_context('USERENV','CURRENT_SCHEMA')<>user then raise_application_error(-20260,'Fixed direct TEST_ONLY billing owner required');end if;
 select count(*) into n from user_objects;if n<>0 then raise_application_error(-20260,'Fresh empty TEST_ONLY schema required; never overwrite');end if;
end;
/
create table apxgen_app_ai_test_marker(kind varchar2(64) not null constraint app_ai_test_billing_kind_ck check(kind='TEST_ONLY_APP_AI_BILLING_V1'));
insert into apxgen_app_ai_test_marker values('TEST_ONLY_APP_AI_BILLING_V1');
create table apxgen_runs(run_id varchar2(32) constraint app_ai_test_run_pk primary key,population_mode varchar2(20) not null,state varchar2(24) not null,label varchar2(160) not null check(label like 'TEST_ONLY%'));
create table apxgen_organisms(organism_id number constraint app_ai_test_org_pk primary key,run_id varchar2(32) not null references apxgen_runs(run_id),generation number not null,evaluation_state varchar2(24) not null);
create table apxgen_run_budgets(run_id varchar2(32) constraint app_ai_test_budget_pk primary key references apxgen_runs(run_id),enabled number default 0 not null check(enabled in(0,1)),limit_usd number default 1 not null check(limit_usd between 0 and 100),stopped number default 0 not null check(stopped in(0,1)));
create table apxgen_provider_config(
 singleton number constraint app_ai_test_provider_pk primary key check(singleton=1),enabled number default 0 not null check(enabled in(0,1)),credential_static_id varchar2(255),model_id varchar2(128),verified_model_id varchar2(128),input_usd_per_million number,output_usd_per_million number,pricing_reviewed_at timestamp with time zone,model_verified_at timestamp with time zone,daily_limit_usd number default 1 not null,max_input_tokens number default 2048 not null,max_output_tokens number default 256 not null,max_requests_per_run number default 20 not null,request_interval number default 5 not null,max_concurrency number default 1 not null check(max_concurrency=1),total_limit_usd number default 1 not null check(total_limit_usd between 0 and 100));
insert into apxgen_provider_config(singleton) values(1);
create table apxgen_invocations(
 invocation_id varchar2(32) constraint app_ai_test_inv_pk primary key,run_id varchar2(32) not null references apxgen_runs(run_id),generation number not null,organism_id number references apxgen_organisms(organism_id),state varchar2(16) not null check(state in('RESERVED','RECONCILED','UNCERTAIN','REJECTED')),reserved_usd number not null check(reserved_usd>=0),actual_usd number,input_rate number not null,output_rate number not null,max_input_tokens number not null,max_output_tokens number not null,input_tokens number,output_tokens number,model_id varchar2(128) not null,proposal clob check(proposal is json),error_code varchar2(80),created_at timestamp with time zone default systimestamp not null,completed_at timestamp with time zone,applied_organism number references apxgen_organisms(organism_id));
-- Compile the unchanged legacy package from its original source, not a fork.
@@../../packages/apxgen_budget.sql
commit;
