-- Separate application protocol. Never install this into the active dashboard LAB.
declare n number;
begin
  if user in ('SYS','SYSTEM','APXGEN_LAB','APXGEN_VERIFY') then
    raise_application_error(-20130,'A dedicated application sandbox is required');
  end if;
  select count(*) into n from user_objects where object_name in
    ('APXGEN_APP_RUNS','APXGEN_APP_ORGANISMS','APXGEN_APP_EVENTS','APXGEN_APP_EVOLUTION','APXGEN_APP_IDENTITY_IMMUTABLE','APXGEN_APP_EVENTS_IMMUTABLE');
  if n<>0 then raise_application_error(-20130,'Application evolution objects already exist');end if;
end;
/
create table apxgen_app_runs (
 run_id varchar2(32) primary key,
 label varchar2(120) not null,
 population_mode varchar2(12) default 'GA_ONLY' not null check(population_mode='GA_ONLY'),
 seed number(10) not null,rng_state number(10) not null,
 max_generations number(2) not null check(max_generations between 1 and 10),
 current_generation number(2) default 0 not null,
 materialization_budget number(3) not null check(materialization_budget between 1 and 128),
 materializations number(3) default 0 not null,
 best_organism_id varchar2(32),
 fitness_definition varchar2(40) default 'order-lab-task-proxy/2.0.0' not null,
 state varchar2(16) default 'RUNNING' not null check(state in('RUNNING','COMPLETE','FAILED','CANCELLED')),
 created_at timestamp with time zone default systimestamp not null
);
create table apxgen_app_organisms (
 organism_id varchar2(32) primary key,
 run_id varchar2(32) not null references apxgen_app_runs(run_id),
 generation number(2) not null,
 parent_id varchar2(32) references apxgen_app_organisms(organism_id),
 genome_json clob not null check(genome_json is json strict with unique keys),
 genome_hash varchar2(64) not null,
 method varchar2(12) not null check(method in('BASELINE','MUTATION')),
 state varchar2(24) default 'GENOME_CREATED' not null,
 artifact_hash varchar2(64),application_id number,
 metrics_json clob check(metrics_json is json strict with unique keys),
 eligible number(1),fitness number,
 selected number(1) default 0 not null check(selected in(0,1)),
 reason varchar2(240),created_at timestamp with time zone default systimestamp not null,
 constraint apxgen_app_generation_uq unique(run_id,generation),
 constraint apxgen_app_state_ck check(state in('GENOME_CREATED','DEFINITION_GENERATED','VALIDATION_STARTED','VALIDATED','IMPORT_STARTED','IMPORTED','RUNTIME_VERIFIED','TESTING','EVALUATED','SELECTED','REJECTED'))
);
alter table apxgen_app_runs add constraint apxgen_app_best_fk foreign key(best_organism_id) references apxgen_app_organisms(organism_id);
create table apxgen_app_events (
 event_id number generated always as identity primary key,
 organism_id varchar2(32) not null references apxgen_app_organisms(organism_id),
 state varchar2(24) not null,detail varchar2(240),
 recorded_at timestamp with time zone default systimestamp not null
);
create or replace trigger apxgen_app_identity_immutable
before update or delete on apxgen_app_organisms for each row
begin
 if deleting or updating('ORGANISM_ID') or updating('RUN_ID') or updating('GENERATION') or updating('PARENT_ID') or updating('GENOME_JSON') or updating('GENOME_HASH') or updating('METHOD') then
  raise_application_error(-20130,'Application DNA and lineage are immutable');
 end if;
 if updating and :old.state in('SELECTED','REJECTED') then raise_application_error(-20130,'Terminal candidate evidence is immutable');end if;
 if :old.metrics_json is not null and (updating('METRICS_JSON') or updating('ELIGIBLE') or updating('FITNESS')) then raise_application_error(-20130,'Evaluated observations and scores are immutable');end if;
end;
/
create or replace trigger apxgen_app_events_immutable
before update or delete on apxgen_app_events
begin raise_application_error(-20130,'Application phase history is immutable');end;
/
