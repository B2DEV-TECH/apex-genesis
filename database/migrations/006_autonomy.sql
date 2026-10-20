-- Migration 006: supervised autonomous operation.
-- Adds operational state only. Existing runs, generations, organisms,
-- evaluations, fitness weights and the published archives are untouched.

-- Singleton policy row. Paid AI is structurally impossible here: the check
-- constraint pins paid_ai to 0 and the mode list excludes GA_HAIKU.
create table apxgen_autonomy_config (
  singleton number primary key check(singleton=1),
  enabled number(1) default 0 not null check(enabled in(0,1)),
  desired_state varchar2(12) default 'RUNNING' not null check(desired_state in('RUNNING','PAUSED')),
  population_mode varchar2(20) default 'GA_ONLY' not null check(population_mode in('GA_ONLY','RANDOM_SEARCH')),
  population_size number(4) default 12 not null check(population_size between 4 and 100),
  generations_per_run number(5) default 100 not null check(generations_per_run between 1 and 1000),
  research_policy varchar2(24) default 'INDEPENDENT_THEN_LINEAGE' not null
    check(research_policy in('INDEPENDENT','LINEAGE','INDEPENDENT_THEN_LINEAGE')),
  independent_quota number(5) default 5 not null check(independent_quota between 0 and 10000),
  stagnation_window number(5) default 25 not null check(stagnation_window between 2 and 1000),
  stagnation_action varchar2(12) default 'CONTINUE' not null check(stagnation_action in('CONTINUE','NEW_RUN','PAUSE')),
  auto_next_run number(1) default 1 not null check(auto_next_run in(0,1)),
  max_active_runs number(2) default 1 not null check(max_active_runs=1),
  daily_generation_cap number(6) default 300 not null check(daily_generation_cap between 1 and 100000),
  run_cooldown_seconds number(6) default 600 not null check(run_cooldown_seconds between 0 and 86400),
  generation_interval_seconds number(5) default 60 not null check(generation_interval_seconds between 0 and 3600),
  storage_budget_mb number(7) default 440 not null check(storage_budget_mb between 10 and 1000000),
  max_run_recoveries number(3) default 3 not null check(max_run_recoveries between 0 and 20),
  generation_timeout number(5) default 7200 not null check(generation_timeout between 30 and 7200),
  total_timeout number(6) default 86400 not null check(total_timeout between 30 and 86400),
  publish_enabled number(1) default 0 not null check(publish_enabled in(0,1)),
  publish_every_generations number(4) default 10 not null check(publish_every_generations between 1 and 1000),
  publish_min_interval_seconds number(6) default 900 not null check(publish_min_interval_seconds between 60 and 86400),
  paid_ai number(1) default 0 not null check(paid_ai=0),
  label_prefix varchar2(40) default 'AUTONOMOUS' not null,
  base_seed number(10) default 20261020 not null check(base_seed between 1 and 2147483646),
  protocol_version varchar2(40) default 'autonomy-1.0.0' not null,
  updated_at timestamp with time zone default systimestamp not null,
  updated_by varchar2(255) default 'INSTALL' not null,
  check(total_timeout>=generation_timeout)
);
insert into apxgen_autonomy_config(singleton) values(1);

-- Singleton supervisor lease. Only the holder of lease_token may claim work,
-- create runs or publish. A process mutex alone is not trusted.
create table apxgen_supervisor (
  singleton number primary key check(singleton=1),
  lease_token varchar2(32),
  lease_until timestamp with time zone,
  host varchar2(128),
  pid number,
  instance_started_at timestamp with time zone,
  heartbeat timestamp with time zone,
  state varchar2(16) default 'STOPPED' not null
    check(state in('STARTING','RUNNING','IDLE','PAUSED','BACKOFF','STOPPING','STOPPED','SAFE_STOPPED')),
  detail varchar2(1000),
  metrics clob check(metrics is json),
  version varchar2(40),
  watchdog_at timestamp with time zone,
  watchdog clob check(watchdog is json)
);
insert into apxgen_supervisor(singleton) values(1);

-- Durable command channel. APEX and the CLI enqueue; the lease holder applies.
create table apxgen_commands (
  command_id number generated always as identity primary key,
  command varchar2(16) not null
    check(command in('ENABLE','DISABLE','PAUSE','RESUME','STOP_RUN','PUBLISH_NOW','SHUTDOWN')),
  state varchar2(12) default 'PENDING' not null check(state in('PENDING','DONE','REJECTED')),
  requested_by varchar2(255) not null,
  requested_at timestamp with time zone default systimestamp not null,
  completed_at timestamp with time zone,
  result varchar2(1000)
);
create index apxgen_commands_pending on apxgen_commands(state,command_id);

-- Provenance of every autonomously created run (seed policy record).
create table apxgen_autonomy_runs (
  sequence_no number(10) primary key,
  run_id varchar2(32) not null unique references apxgen_runs(run_id),
  policy varchar2(12) not null check(policy in('INDEPENDENT','LINEAGE','RECOVERY')),
  seed number(10) not null,
  source_run varchar2(32) references apxgen_runs(run_id),
  source_generation number(5),
  recovery_of number(10) references apxgen_autonomy_runs(sequence_no),
  initial_population_hash varchar2(64),
  fitness_version varchar2(40) not null,
  ga_version varchar2(40) not null,
  protocol_version varchar2(40) not null,
  environment_hash varchar2(128) not null,
  environment clob not null check(environment is json),
  outcome varchar2(12) default 'ACTIVE' not null
    check(outcome in('ACTIVE','COMPLETED','STOPPED','FAILED','RECOVERED','STAGNATED')),
  paused_by varchar2(32),
  stop_reason varchar2(32),
  stagnation clob check(stagnation is json),
  stagnation_generation number(5),
  published_generation number(5) default -1 not null,
  published_final number(1) default 0 not null check(published_final in(0,1)),
  published_at timestamp with time zone,
  created_at timestamp with time zone default systimestamp not null,
  ended_at timestamp with time zone
);

-- Publication attempts. Immutable objects are content-addressed; the pointer
-- (latest.json) is the only mutable key and is moved after verification.
create table apxgen_publications (
  publication_id number generated always as identity primary key,
  run_id varchar2(32) references apxgen_runs(run_id),
  kind varchar2(12) not null check(kind in('SNAPSHOT','FINAL','CATALOG','POINTER')),
  generation number(5),
  target varchar2(12) not null check(target in('R2','DIRECTORY')),
  state varchar2(12) default 'STAGED' not null check(state in('STAGED','VERIFIED','LIVE','FAILED','ROLLED_BACK')),
  object_key varchar2(400),
  sha256 varchar2(64),
  bytes number,
  attempts number(4) default 0 not null,
  error varchar2(1000),
  created_at timestamp with time zone default systimestamp not null,
  completed_at timestamp with time zone
);
create index apxgen_publications_run on apxgen_publications(run_id,publication_id);

-- Operational log (no secrets; messages are composed by the supervisor).
create table apxgen_supervisor_log (
  log_id number generated always as identity primary key,
  logged_at timestamp with time zone default systimestamp not null,
  log_level varchar2(8) not null check(log_level in('INFO','WARN','ERROR')),
  source varchar2(12) not null check(source in('SUPERVISOR','WATCHDOG','PUBLISHER','OPERATOR','DATABASE')),
  message varchar2(2000) not null,
  details clob check(details is json)
);
commit;
