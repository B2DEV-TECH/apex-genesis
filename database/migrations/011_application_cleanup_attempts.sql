-- Source only until separately reviewed and explicitly installed in the owner sandbox.
-- A STARTED row is committed by the SAME guarded connection before APEX removal.
-- Never insert through a second connection while holding the organism FK row lock.
declare n number;
begin
  if user in ('SYS','SYSTEM','INTERNAL','APXGEN_LAB','APXGEN_VERIFY') or
     sys_context('USERENV','SESSION_USER')<>sys_context('USERENV','CURRENT_SCHEMA') then
    raise_application_error(-20137,'A direct dedicated application owner is required');
  end if;
  select count(*) into n from user_objects where object_name in
    ('APXGEN_APP_CLEANUP_ATTEMPTS','APXGEN_APP_CLEANUP_IMMUTABLE');
  if n<>0 then raise_application_error(-20137,'Cleanup audit objects already exist; no overwrite allowed');end if;
end;
/
create table apxgen_app_cleanup_attempts (
  attempt_id varchar2(32) primary key,
  organism_id varchar2(32) not null unique references apxgen_app_organisms(organism_id),
  run_id varchar2(32) not null,
  application_id number(10) not null,
  genome_hash varchar2(64) not null,
  artifact_hash varchar2(64) not null,
  policy_hash varchar2(64) not null,
  archive_hash varchar2(64) not null,
  snapshot_hash varchar2(64) not null,
  evidence_hash varchar2(64) not null,
  authorization_hash varchar2(64) not null,
  state varchar2(12) default 'STARTED' not null,
  created_at timestamp with time zone default systimestamp not null,
  completed_at timestamp with time zone,
  error_code varchar2(80),
  constraint apxgen_cleanup_ids_ck check(
    regexp_like(attempt_id,'^[a-f0-9]{32}$','c') and
    regexp_like(organism_id,'^[a-f0-9]{32}$','c') and
    regexp_like(run_id,'^[a-f0-9]{32}$','c')),
  constraint apxgen_cleanup_app_ck check(application_id in(130,131,132,133)),
  constraint apxgen_cleanup_hashes_ck check(
    regexp_like(genome_hash,'^[a-f0-9]{64}$','c') and
    regexp_like(artifact_hash,'^[a-f0-9]{64}$','c') and
    regexp_like(policy_hash,'^[a-f0-9]{64}$','c') and
    regexp_like(archive_hash,'^[a-f0-9]{64}$','c') and
    regexp_like(snapshot_hash,'^[a-f0-9]{64}$','c') and
    regexp_like(evidence_hash,'^[a-f0-9]{64}$','c') and
    regexp_like(authorization_hash,'^[a-f0-9]{64}$','c')),
  constraint apxgen_cleanup_state_ck check(
    (state='STARTED' and completed_at is null and error_code is null) or
    (state='VERIFIED' and completed_at is not null and error_code is null) or
    (state='UNCERTAIN' and completed_at is not null and error_code is not null and
      regexp_like(error_code,'^[A-Z][A-Z0-9_-]{0,79}$','c')))
);
create or replace trigger apxgen_app_cleanup_immutable
before insert or update or delete on apxgen_app_cleanup_attempts for each row
declare
  owner_run varchar2(32);owner_app number;owner_genome varchar2(64);
  owner_artifact varchar2(64);candidate_state varchar2(24);run_state varchar2(16);n number;
begin
  if sys_context('USERENV','SESSION_USER')<>sys_context('USERENV','CURRENT_SCHEMA') or
     sys_context('USERENV','SESSION_USER')<>sys_context('USERENV','CURRENT_USER') or
     sys_context('USERENV','SESSION_USER') in('SYS','SYSTEM','INTERNAL','APXGEN_LAB','APXGEN_VERIFY') then
    raise_application_error(-20137,'Cleanup audit accepts only its direct dedicated owner');
  end if;
  if nvl(apex_application.g_flow_id,0)<>0 or nvl(apex_application.g_instance,0)<>0 or
     v('APP_ID') is not null or v('APP_USER') is not null then
    raise_application_error(-20137,'Cleanup audit refuses an attached APEX/browser context');
  end if;
  if deleting then raise_application_error(-20137,'Cleanup attempts are permanent; retries cannot erase history');end if;
  if inserting then
    if :new.state<>'STARTED' or :new.completed_at is not null or :new.error_code is not null then
      raise_application_error(-20137,'A cleanup attempt must start unfinished');
    end if;
    select run_id,application_id,genome_hash,artifact_hash,state
      into owner_run,owner_app,owner_genome,owner_artifact,candidate_state
      from apxgen_app_organisms where organism_id=:new.organism_id;
    if owner_app is null or owner_artifact is null or
       owner_run<>:new.run_id or owner_app<>:new.application_id or
       owner_genome<>:new.genome_hash or owner_artifact<>:new.artifact_hash or
       candidate_state not in('SELECTED','REJECTED') then
      raise_application_error(-20137,'Cleanup owner, canonical DNA or artifact differs');
    end if;
    select state into run_state from apxgen_app_runs where run_id=owner_run;
    if run_state not in('COMPLETE','FAILED','CANCELLED') then
      raise_application_error(-20137,'Initial cleanup executor accepts terminal owner runs only');
    end if;
    select count(*) into n from apxgen_app_events where organism_id=:new.organism_id
      and state in('CLEANUP_STARTED','DISPOSED','CLEANUP_UNCERTAIN');
    if n<>0 then raise_application_error(-20137,'Legacy cleanup history blocks a new attempt');end if;
    :new.created_at:=systimestamp;
  else
    if :old.state<>'STARTED' or :new.state not in('VERIFIED','UNCERTAIN') or
       :new.completed_at is null then
      raise_application_error(-20137,'Cleanup may be finalized exactly once');
    end if;
    if :new.attempt_id<>:old.attempt_id or :new.organism_id<>:old.organism_id or
       :new.run_id<>:old.run_id or :new.application_id<>:old.application_id or
       :new.genome_hash<>:old.genome_hash or :new.artifact_hash<>:old.artifact_hash or
       :new.policy_hash<>:old.policy_hash or :new.archive_hash<>:old.archive_hash or
       :new.snapshot_hash<>:old.snapshot_hash or :new.evidence_hash<>:old.evidence_hash or
       :new.authorization_hash<>:old.authorization_hash or :new.created_at<>:old.created_at then
      raise_application_error(-20137,'Cleanup identity, hashes and creation are immutable');
    end if;
    :new.completed_at:=systimestamp;
  end if;
exception
  when no_data_found then raise_application_error(-20137,'Cleanup requires its actual immutable organism and run');
end;
/
comment on table apxgen_app_cleanup_attempts is
  'Permanent one-attempt-per-organism cleanup audit; STARTED is uncertain after a crash and never authorizes a retry.';
