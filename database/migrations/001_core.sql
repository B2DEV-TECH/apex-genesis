create table apxgen_runs (
  run_id varchar2(32) primary key,
  label varchar2(160) not null,
  population_mode varchar2(20) not null check (population_mode in ('GA_ONLY','GA_HAIKU','RANDOM_SEARCH')),
  state varchar2(24) default 'CREATED' not null check (state in ('CREATED','READY','RUNNING','PAUSE_REQUESTED','PAUSED','STOP_REQUESTED','STOPPED','COMPLETED','FAILED')),
  seed number(10) not null check(seed between 1 and 2147483646),
  rng_state number(10) not null,
  population_size number(4) not null check(population_size between 4 and 100),
  target_generations number(5) not null check(target_generations between 1 and 1000),
  current_generation number(5) default -1 not null,
  mutation_rate number default .25 not null check(mutation_rate between 0 and 1),
  crossover_rate number default .75 not null check(crossover_rate between 0 and 1),
  elite_count number(3) default 2 not null,
  tournament_size number(2) default 3 not null check(tournament_size between 2 and 10),
  diversity_threshold number default .3 not null check(diversity_threshold between 0 and 1),
  stagnation_limit number default 10 not null,
  generation_timeout number default 1200 not null,
  total_timeout number default 21600 not null,
  engine_version varchar2(40) default '1.0.0' not null,
  evaluation_context varchar2(128),
  created_at timestamp with time zone default systimestamp not null,
  started_at timestamp with time zone,
  heartbeat timestamp with time zone,
  ended_at timestamp with time zone,
  failure varchar2(1000),
  source_run varchar2(32) references apxgen_runs(run_id),
  source_generation number,
  check(elite_count>=0 and elite_count<population_size)
);
create table apxgen_genomes (
  fingerprint varchar2(64) primary key,
  canonical_json clob not null check(canonical_json is json strict with unique keys),
  genes_json varchar2(300) not null check(genes_json is json),
  created_at timestamp with time zone default systimestamp not null
);
create or replace trigger apxgen_genomes_immutable before update on apxgen_genomes
begin raise_application_error(-20001,'Genomes are immutable'); end;
/
create table apxgen_generations (
  run_id varchar2(32) not null references apxgen_runs(run_id),
  generation number(5) not null,
  rng_before number not null,
  rng_after number not null,
  state varchar2(16) default 'EVALUATING' not null check(state in ('EVALUATING','COMPLETE')),
  best_fitness number,mean_fitness number,median_fitness number,variance_fitness number,
  best_so_far number,diversity number,valid_count number,failed_count number,
  mutation_count number,mutation_accepted number,
  started_at timestamp with time zone default systimestamp not null,
  completed_at timestamp with time zone,
  primary key(run_id,generation)
);
create table apxgen_organisms (
  organism_id number generated always as identity primary key,
  run_id varchar2(32) not null,
  generation number(5) not null,
  ordinal number(4) not null,
  fingerprint varchar2(64) not null references apxgen_genomes(fingerprint),
  method varchar2(20) not null check(method in ('INITIAL','ELITE','CROSSOVER','MUTATION','IMMIGRANT','RANDOM','AI','CHECKPOINT')),
  evaluation_state varchar2(16) default 'PENDING' not null check(evaluation_state in ('PENDING','CLAIMED','COMPLETE','FAILED')),
  claim_token varchar2(32),lease_until timestamp with time zone,
  unique(run_id,generation,ordinal),
  foreign key(run_id,generation) references apxgen_generations(run_id,generation)
);
create index apxgen_org_queue on apxgen_organisms(run_id,evaluation_state,generation);
create index apxgen_org_genome on apxgen_organisms(fingerprint);
create table apxgen_parents (
  child_id number not null references apxgen_organisms(organism_id),
  parent_id number not null references apxgen_organisms(organism_id),
  parent_role varchar2(12) not null check(parent_role in ('PRIMARY','SECONDARY')),
  primary key(child_id,parent_role),check(child_id<>parent_id)
);
create index apxgen_parent_idx on apxgen_parents(parent_id);
create table apxgen_evaluations (
  organism_id number primary key references apxgen_organisms(organism_id),
  environment_hash varchar2(128) not null,
  eligible number(1) not null check(eligible in (0,1)),
  fitness number not null check(fitness between 0 and 100),
  accessibility number not null,hierarchy number not null,responsiveness number not null,performance_proxy number not null,
  contrast_ratio number not null,
  measurements clob not null check(measurements is json strict with unique keys),
  cached_from number references apxgen_evaluations(organism_id),
  evaluated_at timestamp with time zone default systimestamp not null
);
create index apxgen_eval_env on apxgen_evaluations(environment_hash);
create table apxgen_events (
  event_id number generated always as identity primary key,
  run_id varchar2(32) not null references apxgen_runs(run_id),
  generation number,event_type varchar2(40) not null,
  details varchar2(2000),occurred_at timestamp with time zone default systimestamp not null
);
create index apxgen_events_run on apxgen_events(run_id,event_id);
create table apxgen_votes (
  vote_id number generated always as identity primary key,
  run_id varchar2(32) not null references apxgen_runs(run_id),
  preferred_id number not null references apxgen_organisms(organism_id),
  alternative_id number not null references apxgen_organisms(organism_id),
  actor varchar2(255) not null,created_at timestamp with time zone default systimestamp,
  check(preferred_id<>alternative_id)
);
create table apxgen_provider_config (
  singleton number primary key check(singleton=1),enabled number(1) default 0 not null check(enabled in(0,1)),
  credential_static_id varchar2(255),model_id varchar2(128),verified_model_id varchar2(128),
  input_usd_per_million number,output_usd_per_million number,pricing_reviewed_at timestamp with time zone,
  model_verified_at timestamp with time zone,daily_limit_usd number default 1 not null,
  max_input_tokens number default 2048 not null,max_output_tokens number default 256 not null,
  max_requests_per_run number default 20 not null,request_interval number default 5 not null,
  max_concurrency number default 1 not null check(max_concurrency=1)
);
insert into apxgen_provider_config(singleton) values(1);
create table apxgen_run_budgets (
  run_id varchar2(32) primary key references apxgen_runs(run_id),
  enabled number(1) default 0 not null check(enabled in(0,1)),
  limit_usd number default 1 not null check(limit_usd between 0 and 100),
  stopped number(1) default 0 not null check(stopped in(0,1))
);
create table apxgen_invocations (
  invocation_id varchar2(32) primary key,run_id varchar2(32) not null references apxgen_runs(run_id),
  generation number not null,organism_id number references apxgen_organisms(organism_id),
  state varchar2(16) not null check(state in('RESERVED','RECONCILED','UNCERTAIN','REJECTED')),
  reserved_usd number not null check(reserved_usd>=0),actual_usd number,
  input_rate number not null,output_rate number not null,
  max_input_tokens number not null,max_output_tokens number not null,
  input_tokens number,output_tokens number,model_id varchar2(128) not null,
  proposal clob check(proposal is json),error_code varchar2(80),
  created_at timestamp with time zone default systimestamp not null,
  completed_at timestamp with time zone
);
create index apxgen_inv_run on apxgen_invocations(run_id,created_at);
commit;
