-- UNINSTALLED TEST_ONLY identities. No runtime history/ledger/credential is copied.
whenever sqlerror exit failure rollback
set define off
declare n number;
begin
 if user<>'APXGEN_APP_BROKER_TEST' or sys_context('USERENV','SESSION_USER')<>user or sys_context('USERENV','CURRENT_SCHEMA')<>user then raise_application_error(-20260,'Fixed direct TEST_ONLY application owner required');end if;
 select count(*) into n from user_objects;if n<>0 then raise_application_error(-20260,'Fresh empty TEST_ONLY schema required; never overwrite');end if;
end;
/
create table apxgen_app_ai_test_marker(kind varchar2(64) not null check(kind='TEST_ONLY_APP_AI_APPLICATION_V1'));
insert into apxgen_app_ai_test_marker values('TEST_ONLY_APP_AI_APPLICATION_V1');
create table apxgen_app_runs(run_id varchar2(32) constraint app_ai_test_app_run_pk primary key,population_mode varchar2(12) not null check(population_mode in('GA_ONLY','GA_HAIKU')),state varchar2(16) not null,best_organism_id varchar2(32));
create table apxgen_app_organisms(
 organism_id varchar2(32) constraint app_ai_test_app_org_pk primary key,run_id varchar2(32) not null references apxgen_app_runs(run_id),generation number not null,parent_id varchar2(32) references apxgen_app_organisms(organism_id),genome_hash varchar2(64) not null,method varchar2(12) not null check(method in('BASELINE','MUTATION','AI_PROPOSAL')),state varchar2(24) not null,eligible number,selected number default 0 not null,ai_invocation_id varchar2(32),constraint app_ai_test_run_org_uq unique(run_id,organism_id),constraint app_ai_test_child_inv_uq unique(ai_invocation_id));
alter table apxgen_app_runs add constraint app_ai_test_best_fk foreign key(best_organism_id) references apxgen_app_organisms(organism_id);
create table apxgen_app_control_config(config_id number primary key check(config_id=1),worker_enabled number default 0 not null check(worker_enabled in(0,1)));
insert into apxgen_app_control_config values(1,0);
create table apxgen_app_control_requests(request_id varchar2(32) primary key,state varchar2(12) not null);
create or replace trigger apxgen_app_ai_test_identity
before update or delete on apxgen_app_organisms for each row
begin
 if deleting or updating('ORGANISM_ID') or updating('RUN_ID') or updating('GENERATION') or updating('PARENT_ID') or updating('GENOME_HASH') or updating('METHOD') or updating('AI_INVOCATION_ID') then raise_application_error(-20263,'TEST_ONLY immutable application identity');end if;
end;
/
-- Explicit fixed fixture-only REFERENCES; these statements are not executed by JS.
grant references on apxgen_app_runs to APXGEN_AI_BROKER_TEST;
grant references on apxgen_app_organisms to APXGEN_AI_BROKER_TEST;
grant select on apxgen_app_ai_test_marker to APXGEN_AI_BROKER_TEST;
grant select on apxgen_app_control_config to APXGEN_AI_BROKER_TEST;
grant select on apxgen_app_control_requests to APXGEN_AI_BROKER_TEST;
grant select on apxgen_app_runs to APXGEN_AI_BROKER_TEST;
grant select on apxgen_app_organisms to APXGEN_AI_BROKER_TEST;
commit;
