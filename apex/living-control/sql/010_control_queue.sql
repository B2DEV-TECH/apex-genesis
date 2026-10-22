-- Additive control infrastructure; a separately allocated control app is required.
-- This migration neither imports an app nor authorizes any worker or principal.
declare n number;
begin
 if user<>'APXGEN_ORDER_LAB' or sys_context('USERENV','CURRENT_SCHEMA')<>user then
  raise_application_error(-20140,'Dedicated Order Lab owner required');
 end if;
 select count(*) into n from user_objects where object_name in
 ('APXGEN_APP_CONTROL_CONFIG','APXGEN_APP_CONTROL_USERS','APXGEN_APP_CONTROL_REQUESTS',
  'APXGEN_APP_CONTROL_EVENTS','APXGEN_APP_CONTROL','APXGEN_CONTROL_REQ_IMMUTABLE','APXGEN_CONTROL_EVT_IMMUTABLE');
 if n<>0 then raise_application_error(-20140,'Control objects already exist; no replacement allowed');end if;
 select count(*) into n from user_tables where table_name in('APXGEN_APP_RUNS','APXGEN_APP_ORGANISMS','APXGEN_APP_EVENTS');
 if n<>3 then raise_application_error(-20140,'Reviewed application evolution schema required');end if;
end;
/
create table apxgen_app_control_config (
 config_id number(1) primary key check(config_id=1),
 enabled number(1) default 0 not null check(enabled in(0,1)),
 schema_name varchar2(128),workspace_id number(16),control_application_id number(10),
 max_generations number(2) default 1 not null check(max_generations between 1 and 10),
 max_materializations number(2) default 2 not null check(max_materializations between 2 and 22),
 worker_enabled number(1) default 0 not null check(worker_enabled in(0,1)),
 worker_binding varchar2(64),worker_seen_at timestamp with time zone,
 constraint apxgen_control_binding_ck check(enabled=0 or
  (schema_name is not null and workspace_id is not null and workspace_id>0 and workspace_id=trunc(workspace_id)
   and control_application_id is not null and control_application_id>0 and control_application_id=trunc(control_application_id))),
 -- All existing dashboard and experiment evidence applications are excluded.
 constraint apxgen_control_app_ck check(control_application_id not in(120,121,130,131,132,133)),
 constraint apxgen_control_worker_ck check(worker_enabled=0 or worker_binding is not null)
);
insert into apxgen_app_control_config(config_id) values(1);
create table apxgen_app_control_users (
 username varchar2(255) primary key check(username=upper(username)),
 control_role varchar2(8) not null check(control_role in('READER','OPERATOR')),
 enabled number(1) default 0 not null check(enabled in(0,1))
);
create table apxgen_app_control_requests (
 request_id varchar2(32) primary key,
 created_by varchar2(255) not null,
 label varchar2(120) not null,
 population_mode varchar2(12) default 'GA_ONLY' not null check(population_mode='GA_ONLY'),
 seed number(10) not null check(seed between 1 and 2147483646 and seed=trunc(seed)),
 generations number(2) not null check(generations between 1 and 10),
 materialization_budget number(2) not null check(materialization_budget between 2 and 22),
 state varchar2(12) default 'DRAFT' not null check(state in('DRAFT','QUEUED','CLAIMED','COMPLETED','FAILED','UNCERTAIN','CANCELLED')),
 run_id varchar2(32) unique references apxgen_app_runs(run_id),
 claim_token varchar2(32),claim_binding varchar2(64),lease_until timestamp with time zone,
 created_at timestamp with time zone default systimestamp not null,
 queued_at timestamp with time zone,claimed_at timestamp with time zone,completed_at timestamp with time zone,
 constraint apxgen_control_budget_ck check(materialization_budget>=generations+1),
 constraint apxgen_control_claim_ck check(state<>'CLAIMED' or
  (claim_token is not null and claim_binding is not null and lease_until is not null and claimed_at is not null))
);
create table apxgen_app_control_events (
 event_id number generated always as identity primary key,
 request_id varchar2(32) not null references apxgen_app_control_requests(request_id),
 state varchar2(20) not null,
 actor varchar2(255) not null,
 recorded_at timestamp with time zone default systimestamp not null
);
create or replace trigger apxgen_control_req_immutable
before insert or update or delete on apxgen_app_control_requests for each row
begin
 if deleting then raise_application_error(-20140,'Control requests are permanent');end if;
 if inserting then
  if :new.state<>'DRAFT' or :new.run_id is not null or :new.claim_token is not null or :new.claimed_at is not null
   or :new.claim_binding is not null or :new.lease_until is not null or :new.queued_at is not null
   or :new.completed_at is not null then raise_application_error(-20140,'Create an unclaimed draft first');end if;
 elsif updating then
  if updating('REQUEST_ID') or updating('CREATED_BY') or updating('LABEL') or updating('POPULATION_MODE')
   or updating('SEED') or updating('GENERATIONS') or updating('MATERIALIZATION_BUDGET') or updating('CREATED_AT')
   or :old.state in('COMPLETED','FAILED','UNCERTAIN','CANCELLED') then
   raise_application_error(-20140,'Request configuration and terminal outcomes are immutable');
  end if;
  if :new.state<>:old.state and not
   ((:old.state='DRAFT' and :new.state in('QUEUED','CANCELLED'))
    or (:old.state='QUEUED' and :new.state in('CLAIMED','CANCELLED'))
    or (:old.state='CLAIMED' and :new.state in('COMPLETED','FAILED','UNCERTAIN'))) then
   raise_application_error(-20140,'Unsupported control request transition');
  end if;
  if updating('RUN_ID') and (:old.state<>'CLAIMED' or :old.run_id is not null or :new.run_id is null) then
   raise_application_error(-20140,'Only an unlinked worker claim may attach one real run');
  end if;
  if (updating('CLAIM_TOKEN') or updating('CLAIM_BINDING') or updating('CLAIMED_AT'))
   and not(:old.state='QUEUED' and :new.state='CLAIMED') then
   raise_application_error(-20140,'Worker claim identity is immutable');
  end if;
  if updating('QUEUED_AT') and not(:old.state='DRAFT' and :new.state='QUEUED' and :new.queued_at is not null) then
   raise_application_error(-20140,'Queue admission time is immutable');
  end if;
  if updating('LEASE_UNTIL') and not((:old.state='QUEUED' and :new.state='CLAIMED')
   or (:old.state='CLAIMED' and :new.state='CLAIMED')) then raise_application_error(-20140,'Only a worker claim may hold a lease');end if;
  if updating('COMPLETED_AT') and not(:new.state in('COMPLETED','FAILED','UNCERTAIN','CANCELLED')
   and :new.state<>:old.state and :new.completed_at is not null) then raise_application_error(-20140,'Completion time is immutable');end if;
  if :new.state='QUEUED' and :new.queued_at is null then raise_application_error(-20140,'Queue admission time required');end if;
  if :new.state in('COMPLETED','FAILED','UNCERTAIN','CANCELLED') and :new.completed_at is null then
   raise_application_error(-20140,'Terminal completion time required');
  end if;
 end if;
end;
/
create or replace trigger apxgen_control_evt_immutable
before update or delete on apxgen_app_control_events
begin raise_application_error(-20140,'Control request audit is append only');end;
/
