create or replace package apxgen_autonomy authid definer as
  -- Supervised autonomous operation. Oracle remains the owner of the genetic
  -- algorithm; this package only decides WHEN finite runs exist and records
  -- provenance, leases, commands and publication bookkeeping.
  c_fitness_version constant varchar2(40):='fitness-1.1.0';
  c_ga_version constant varchar2(40):='1.1.0';
  c_job constant varchar2(30):='APXGEN_AUTONOMY_TICK';

  -- Single-instance lease (token checked under the singleton row lock).
  function acquire_lease(p_host varchar2,p_pid number,p_version varchar2,p_seconds number default 90) return varchar2;
  procedure renew_lease(p_token varchar2,p_state varchar2,p_detail varchar2,p_metrics clob default null,p_seconds number default 90);
  procedure release_lease(p_token varchar2,p_state varchar2,p_detail varchar2);
  procedure assert_lease(p_token varchar2);

  -- Command channel (APEX ops panel and CLI enqueue; supervisor applies).
  function enqueue(p_command varchar2,p_actor varchar2 default null) return number;
  procedure apply_command(p_token varchar2,p_id number);
  procedure complete_command(p_token varchar2,p_id number,p_state varchar2,p_result varchar2);

  procedure log(p_level varchar2,p_source varchar2,p_message varchar2,p_details clob default null);
  procedure set_config(p_config clob,p_actor varchar2 default null);

  -- Run policy.
  function active_run return varchar2;
  function admission(p_detail out varchar2) return number;
  function start_next_run(p_token varchar2,p_environment_hash varchar2,p_environment clob) return varchar2;
  function reconcile(p_token varchar2) return varchar2;
  procedure assess_stagnation(p_token varchar2,p_run varchar2);
  procedure shutdown_pause(p_token varchar2,p_reason varchar2 default 'SUPERVISOR_SHUTDOWN');
  procedure watchdog_report(p_report clob);
  function generations_today return number;
  function storage_bytes return number;

  -- Database-side orchestration job (one job, not one per run).
  procedure ensure_scheduler;
  procedure db_tick;

  -- Publication bookkeeping.
  function publication_begin(p_token varchar2,p_run varchar2,p_kind varchar2,p_generation number,p_target varchar2,p_key varchar2,p_sha varchar2,p_bytes number) return number;
  procedure publication_end(p_token varchar2,p_id number,p_state varchar2,p_error varchar2 default null);
  procedure mark_published(p_token varchar2,p_run varchar2,p_generation number,p_final number);

  function status_json return clob;
  function utc_text(p timestamp with time zone) return varchar2;
  function log_json(p_limit number default 100) return clob;
  function publications_json(p_limit number default 50) return clob;
end apxgen_autonomy;
/
create or replace package body apxgen_autonomy as

  function utc_text(p timestamp with time zone) return varchar2 is
  begin return to_char(sys_extract_utc(p),'YYYY-MM-DD"T"HH24:MI:SS"Z"');end;

  procedure log(p_level varchar2,p_source varchar2,p_message varchar2,p_details clob default null) is
    pragma autonomous_transaction;
  begin
    insert into apxgen_supervisor_log(log_level,source,message,details)
    values(p_level,p_source,substr(p_message,1,2000),p_details);
    commit;
  end;

  procedure run_event(p_run varchar2,p_type varchar2,p_detail varchar2) is
  begin
    insert into apxgen_events(run_id,generation,event_type,details)
    select run_id,current_generation,p_type,substr(p_detail,1,2000) from apxgen_runs where run_id=p_run;
  end;

  -------------------------------------------------------------------------
  -- Lease
  -------------------------------------------------------------------------
  function acquire_lease(p_host varchar2,p_pid number,p_version varchar2,p_seconds number default 90) return varchar2 is
    s apxgen_supervisor%rowtype;v_token varchar2(32);
  begin
    if p_seconds not between 30 and 600 then raise_application_error(-20070,'Lease duration outside limits');end if;
    select * into s from apxgen_supervisor where singleton=1 for update;
    if s.lease_token is not null and s.lease_until>systimestamp then
      rollback;return null;                       -- another live instance owns the lab
    end if;
    v_token:=lower(rawtohex(sys_guid()));
    update apxgen_supervisor set lease_token=v_token,lease_until=systimestamp+numtodsinterval(p_seconds,'SECOND'),
      host=substr(p_host,1,128),pid=p_pid,version=substr(p_version,1,40),instance_started_at=systimestamp,
      heartbeat=systimestamp,state='STARTING',detail=case when s.lease_token is not null then 'Expired lease taken over' else 'Lease acquired' end
    where singleton=1;
    commit;
    log('INFO','SUPERVISOR','Lease acquired by pid '||p_pid||case when s.lease_token is not null then ' (previous lease expired)' end);
    return v_token;
  end;

  procedure assert_lease(p_token varchar2) is s apxgen_supervisor%rowtype;
  begin
    select * into s from apxgen_supervisor where singleton=1 for update;
    if p_token is null or s.lease_token is null or s.lease_token<>p_token or s.lease_until<systimestamp then
      raise_application_error(-20070,'Supervisor lease lost');
    end if;
  end;

  procedure renew_lease(p_token varchar2,p_state varchar2,p_detail varchar2,p_metrics clob default null,p_seconds number default 90) is
  begin
    assert_lease(p_token);
    update apxgen_supervisor set lease_until=systimestamp+numtodsinterval(least(greatest(p_seconds,30),600),'SECOND'),
      heartbeat=systimestamp,state=p_state,detail=substr(p_detail,1,1000),metrics=nvl(p_metrics,metrics)
    where singleton=1;
  end;

  procedure release_lease(p_token varchar2,p_state varchar2,p_detail varchar2) is
  begin
    assert_lease(p_token);
    update apxgen_supervisor set lease_token=null,lease_until=null,heartbeat=systimestamp,state=p_state,detail=substr(p_detail,1,1000)
    where singleton=1;
  end;

  -------------------------------------------------------------------------
  -- Configuration
  -------------------------------------------------------------------------
  procedure set_config(p_config clob,p_actor varchar2 default null) is
    j json_object_t;k json_key_list;valid_json number;c apxgen_autonomy_config%rowtype;
    function num(p_key varchar2,p_old number) return number is
    begin
      if not j.has(p_key) then return p_old;end if;
      if not j.get(p_key).is_number then raise_application_error(-20071,'Numeric configuration required: '||p_key);end if;
      return j.get_number(p_key);
    end;
    function txt(p_key varchar2,p_old varchar2) return varchar2 is
    begin
      if not j.has(p_key) then return p_old;end if;
      if not j.get(p_key).is_string then raise_application_error(-20071,'Text configuration required: '||p_key);end if;
      return j.get_string(p_key);
    end;
  begin
    apxgen_security.require_role('OWNER');
    select case when p_config is json strict with unique keys then 1 else 0 end into valid_json from dual;
    if valid_json<>1 then raise_application_error(-20071,'Strict configuration JSON required');end if;
    j:=json_object_t.parse(p_config);k:=j.get_keys;
    for i in 1..k.count loop
      if k(i) not in('populationMode','populationSize','generationsPerRun','researchPolicy','independentQuota','stagnationWindow',
        'stagnationAction','autoNextRun','dailyGenerationCap','runCooldownSeconds','generationIntervalSeconds','storageBudgetMb',
        'maxRunRecoveries','generationTimeout','totalTimeout','publishEnabled','publishEveryGenerations','publishMinIntervalSeconds',
        'labelPrefix','baseSeed') then
        raise_application_error(-20071,'Unknown or protected configuration property');   -- paidAi is intentionally absent
      end if;
    end loop;
    select * into c from apxgen_autonomy_config where singleton=1 for update;
    -- Values are resolved in PL/SQL first; table check constraints enforce every bound.
    c.population_mode:=txt('populationMode',c.population_mode);c.population_size:=num('populationSize',c.population_size);
    c.generations_per_run:=num('generationsPerRun',c.generations_per_run);c.research_policy:=txt('researchPolicy',c.research_policy);
    c.independent_quota:=num('independentQuota',c.independent_quota);c.stagnation_window:=num('stagnationWindow',c.stagnation_window);
    c.stagnation_action:=txt('stagnationAction',c.stagnation_action);c.auto_next_run:=num('autoNextRun',c.auto_next_run);
    c.daily_generation_cap:=num('dailyGenerationCap',c.daily_generation_cap);c.run_cooldown_seconds:=num('runCooldownSeconds',c.run_cooldown_seconds);
    c.generation_interval_seconds:=num('generationIntervalSeconds',c.generation_interval_seconds);c.storage_budget_mb:=num('storageBudgetMb',c.storage_budget_mb);
    c.max_run_recoveries:=num('maxRunRecoveries',c.max_run_recoveries);c.generation_timeout:=num('generationTimeout',c.generation_timeout);
    c.total_timeout:=num('totalTimeout',c.total_timeout);c.publish_enabled:=num('publishEnabled',c.publish_enabled);
    c.publish_every_generations:=num('publishEveryGenerations',c.publish_every_generations);
    c.publish_min_interval_seconds:=num('publishMinIntervalSeconds',c.publish_min_interval_seconds);
    c.label_prefix:=substr(txt('labelPrefix',c.label_prefix),1,40);c.base_seed:=num('baseSeed',c.base_seed);
    c.updated_at:=systimestamp;c.updated_by:=substr(nvl(p_actor,nvl(v('APP_USER'),sys_context('USERENV','SESSION_USER'))),1,255);
    update apxgen_autonomy_config set row=c
    where singleton=1;
    log('INFO','OPERATOR','Autonomy configuration changed',j.to_clob);
  end;

  -------------------------------------------------------------------------
  -- Measurements used by policy and status
  -------------------------------------------------------------------------
  function active_run return varchar2 is v_run varchar2(32);
  begin
    select run_id into v_run from apxgen_autonomy_runs where outcome='ACTIVE' order by sequence_no desc fetch first 1 row only;
    return v_run;
  exception when no_data_found then return null;end;

  function generations_today return number is n number;
  begin
    -- Generations created (beyond generation 0) since 00:00 UTC by autonomous runs.
    select count(*) into n from apxgen_generations g join apxgen_autonomy_runs a on a.run_id=g.run_id
    where g.generation>0 and g.started_at>=from_tz(cast(trunc(sys_extract_utc(systimestamp)) as timestamp),'UTC');
    return n;
  end;

  function storage_bytes return number is n number;
  begin select nvl(sum(bytes),0) into n from user_segments;return n;end;

  function quota_bytes return number is n number;
  begin
    select max(max_bytes) into n from user_ts_quotas where tablespace_name=(select default_tablespace from user_users);
    return case when n is null or n<0 then null else n end;
  end;

  function admission(p_detail out varchar2) return number is
    c apxgen_autonomy_config%rowtype;n number;last_end timestamp with time zone;used number;quota number;
    c_run_margin constant number:=16*1024*1024;   -- measured ~4 MiB per 100x12 run; 4x margin
  begin
    select * into c from apxgen_autonomy_config where singleton=1;
    if c.enabled=0 then p_detail:='Autonomous operation disabled';return 0;end if;
    if c.desired_state<>'RUNNING' then p_detail:='Paused by operator';return 0;end if;
    select count(*) into n from apxgen_autonomy_runs where outcome='ACTIVE';
    if n>=c.max_active_runs then p_detail:='Active run limit reached';return 0;end if;
    select max(ended_at) into last_end from apxgen_autonomy_runs;
    if last_end is not null and systimestamp<last_end+numtodsinterval(c.run_cooldown_seconds,'SECOND') then
      p_detail:='Cooldown until '||utc_text(last_end+numtodsinterval(c.run_cooldown_seconds,'SECOND'));return 0;
    end if;
    used:=generations_today;
    if used+c.generations_per_run>c.daily_generation_cap then
      p_detail:='Daily generation cap: '||used||' used of '||c.daily_generation_cap||'; next run needs '||c.generations_per_run;return 0;
    end if;
    used:=storage_bytes;quota:=quota_bytes;
    if used+c_run_margin>c.storage_budget_mb*1024*1024 or (quota is not null and used+c_run_margin>quota) then
      p_detail:='Storage budget reached ('||round(used/1048576)||' MiB used of '||c.storage_budget_mb||' MiB budget)';return 0;
    end if;
    p_detail:='Admitted';return 1;
  end;

  -------------------------------------------------------------------------
  -- Run creation and reconciliation
  -------------------------------------------------------------------------
  function population_hash(p_run varchar2) return varchar2 is h varchar2(64);
  begin
    select lower(rawtohex(standard_hash(listagg(fingerprint,',') within group(order by ordinal),'SHA256'))) into h
    from apxgen_organisms where run_id=p_run and generation=0;
    return h;
  end;

  procedure record_run(p_seq number,p_run varchar2,p_policy varchar2,p_seed number,p_source varchar2,p_source_gen number,
                       p_recovery_of number,p_env_hash varchar2,p_env clob,p_protocol varchar2) is
    v_hash varchar2(64):=population_hash(p_run);
  begin
    insert into apxgen_autonomy_runs(sequence_no,run_id,policy,seed,source_run,source_generation,recovery_of,initial_population_hash,
      fitness_version,ga_version,protocol_version,environment_hash,environment)
    values(p_seq,p_run,p_policy,p_seed,p_source,p_source_gen,p_recovery_of,v_hash,
      c_fitness_version,c_ga_version,p_protocol,p_env_hash,p_env);
  end;

  function start_next_run(p_token varchar2,p_environment_hash varchar2,p_environment clob) return varchar2 is
    c apxgen_autonomy_config%rowtype;v_detail varchar2(400);v_seq number;v_seed number;v_run varchar2(32);v_policy varchar2(12);
    v_done number;v_src apxgen_autonomy_runs%rowtype;v_src_gen number;v_valid number;v_restart number;
  begin
    assert_lease(p_token);
    select * into c from apxgen_autonomy_config where singleton=1 for update;   -- serializes sequence allocation
    if admission(v_detail)<>1 then return null;end if;
    if p_environment_hash is null or not regexp_like(p_environment_hash,'^[a-f0-9]{64}$') then raise_application_error(-20072,'Evaluator environment hash required');end if;
    select case when p_environment is json strict then 1 else 0 end into v_valid from dual;
    if v_valid<>1 then raise_application_error(-20072,'Evaluator environment JSON required');end if;
    select nvl(max(sequence_no),0)+1 into v_seq from apxgen_autonomy_runs;

    -- Independent runs first; lineage continues the latest finished autonomous run.
    select count(*) into v_done from apxgen_autonomy_runs where policy='INDEPENDENT' and outcome in('COMPLETED','STAGNATED');
    v_policy:=case c.research_policy when 'INDEPENDENT' then 'INDEPENDENT' when 'LINEAGE' then 'LINEAGE'
                else case when v_done<c.independent_quota then 'INDEPENDENT' else 'LINEAGE' end end;
    if v_policy='LINEAGE' then
      begin
        select a.* into v_src from apxgen_autonomy_runs a join apxgen_runs r on r.run_id=a.run_id
        where a.outcome in('COMPLETED','STAGNATED') and r.population_mode=c.population_mode and r.population_size=c.population_size
        order by a.ended_at desc,a.sequence_no desc fetch first 1 row only;
        select max(generation) into v_src_gen from apxgen_generations where run_id=v_src.run_id and state='COMPLETE';
        -- Continuing a lineage that just stagnated would only replay the same
        -- plateau, so the policy restarts exploration with an independent seed.
        if v_src.outcome='STAGNATED' then v_policy:='INDEPENDENT';v_restart:=v_src.sequence_no;end if;
      exception when no_data_found then v_policy:='INDEPENDENT';end;
    end if;

    if v_policy='INDEPENDENT' then
      -- Deterministic seed policy: Knuth multiplicative step over the sequence number.
      v_seed:=1+mod(c.base_seed+v_seq*2654435761,2147483646);
      v_run:=apxgen_evolution.create_run(substr(c.label_prefix||' #'||v_seq||' '||c.population_mode||' seed '||v_seed,1,160),
                                         c.population_mode,v_seed,c.population_size,c.generations_per_run);
      apxgen_evolution.configure(v_run,'{"stagnationLimit":'||c.stagnation_window||',"generationTimeout":'||c.generation_timeout||',"totalTimeout":'||c.total_timeout||'}');
      apxgen_evolution.initialize(v_run);
      record_run(v_seq,v_run,'INDEPENDENT',v_seed,null,null,null,p_environment_hash,p_environment,c.protocol_version);
    else
      v_run:=apxgen_evolution.duplicate_run(v_src.run_id,v_src_gen,c.generations_per_run,
               substr(c.label_prefix||' #'||v_seq||' LINEAGE of #'||v_src.sequence_no||' g'||v_src_gen,1,160));
      select seed into v_seed from apxgen_runs where run_id=v_run;
      record_run(v_seq,v_run,'LINEAGE',v_seed,v_src.run_id,v_src_gen,null,p_environment_hash,p_environment,c.protocol_version);
    end if;
    run_event(v_run,'AUTONOMY_CREATED','Sequence '||v_seq||'; policy '||v_policy||
      case when v_restart is not null then '; restart after stagnation of #'||v_restart end||'; '||c.population_mode||' data, no model requests');
    log('INFO','SUPERVISOR','Created run #'||v_seq||' ('||v_policy||case when v_restart is not null then ', restart after stagnated #'||v_restart end||') '||v_run);
    return v_run;
  end;

  procedure pause_owned(p_run varchar2,p_by varchar2) is v_state varchar2(24);
  begin
    select state into v_state from apxgen_runs where run_id=p_run;
    if v_state='RUNNING' then
      apxgen_evolution.control(p_run,'PAUSE');apxgen_evolution.advance(p_run);
      update apxgen_autonomy_runs set paused_by=p_by where run_id=p_run;
      log('INFO','SUPERVISOR','Paused run '||p_run||' ('||p_by||')');
    end if;
  end;

  procedure resume_owned(p_run varchar2) is v_state varchar2(24);
  begin
    select state into v_state from apxgen_runs where run_id=p_run;
    if v_state='PAUSE_REQUESTED' then apxgen_evolution.advance(p_run);select state into v_state from apxgen_runs where run_id=p_run;end if;
    if v_state='PAUSED' then
      apxgen_evolution.control(p_run,'RESUME');
      update apxgen_autonomy_runs set paused_by=null where run_id=p_run;
      log('INFO','SUPERVISOR','Resumed run '||p_run);
    end if;
  end;

  function recovery_depth(p_seq number) return number is n number;
  begin
    select count(*)-1 into n from apxgen_autonomy_runs start with sequence_no=p_seq connect by prior recovery_of=sequence_no;
    return n;
  end;

  function reconcile(p_token varchar2) return varchar2 is
    c apxgen_autonomy_config%rowtype;a apxgen_autonomy_runs%rowtype;r apxgen_runs%rowtype;v_last number;v_new varchar2(32);v_seq number;
  begin
    assert_lease(p_token);
    select * into c from apxgen_autonomy_config where singleton=1 for update;
    begin
      select * into a from apxgen_autonomy_runs where outcome='ACTIVE' order by sequence_no desc fetch first 1 row only;
    exception when no_data_found then return 'NO_ACTIVE_RUN';end;
    select * into r from apxgen_runs where run_id=a.run_id;

    if r.state='COMPLETED' then
      update apxgen_autonomy_runs set outcome='COMPLETED',ended_at=nvl(r.ended_at,systimestamp) where sequence_no=a.sequence_no;
      log('INFO','SUPERVISOR','Run #'||a.sequence_no||' completed at generation '||r.current_generation);
      if c.auto_next_run=0 then update apxgen_autonomy_config set desired_state='PAUSED',updated_at=systimestamp,updated_by='POLICY' where singleton=1;end if;
      return 'COMPLETED';
    elsif r.state='STOPPED' then
      update apxgen_autonomy_runs set outcome=case when stop_reason='STAGNATION' then 'STAGNATED' else 'STOPPED' end,
        ended_at=nvl(r.ended_at,systimestamp) where sequence_no=a.sequence_no;
      log('INFO','SUPERVISOR','Run #'||a.sequence_no||' stopped ('||nvl(a.stop_reason,'operator')||')');
      if c.auto_next_run=0 then update apxgen_autonomy_config set desired_state='PAUSED',updated_at=systimestamp,updated_by='POLICY' where singleton=1;end if;
      return 'STOPPED';
    elsif r.state='FAILED' then
      if c.enabled=0 then return 'FAILED_AWAITING_ENABLE';end if;
      -- Recovery continuation from the last completed generation (bounded depth).
      select max(generation) into v_last from apxgen_generations where run_id=r.run_id and state='COMPLETE';
      if v_last is null or v_last>=r.target_generations or recovery_depth(a.sequence_no)>=c.max_run_recoveries then
        update apxgen_autonomy_runs set outcome='FAILED',ended_at=nvl(r.ended_at,systimestamp) where sequence_no=a.sequence_no;
        log('ERROR','SUPERVISOR','Run #'||a.sequence_no||' failed without recovery: '||r.failure);
        return 'FAILED';
      end if;
      select nvl(max(sequence_no),0)+1 into v_seq from apxgen_autonomy_runs;
      v_new:=apxgen_evolution.duplicate_run(r.run_id,v_last,r.target_generations-v_last,
               substr(c.label_prefix||' #'||v_seq||' RECOVERY of #'||a.sequence_no||' g'||v_last,1,160));
      update apxgen_autonomy_runs set outcome='RECOVERED',ended_at=nvl(r.ended_at,systimestamp) where sequence_no=a.sequence_no;
      record_run(v_seq,v_new,'RECOVERY',r.seed,r.run_id,v_last,a.sequence_no,a.environment_hash,a.environment,a.protocol_version);
      run_event(v_new,'AUTONOMY_RECOVERY','Continuation of '||r.run_id||' from completed generation '||v_last||' after: '||r.failure);
      log('WARN','SUPERVISOR','Run #'||a.sequence_no||' failed ('||r.failure||'); continuation #'||v_seq||' from generation '||v_last);
      return 'RECOVERED';
    end if;

    -- Apply desired state to the live run.
    if (c.enabled=0 or c.desired_state='PAUSED') and r.state='RUNNING' then
      pause_owned(r.run_id,case when c.enabled=0 then 'DISABLED' else 'OPERATOR' end);return 'PAUSED';
    elsif c.enabled=1 and c.desired_state='RUNNING' and r.state in('PAUSED','PAUSE_REQUESTED')
          and a.paused_by in('DISABLED','SUPERVISOR_SHUTDOWN','OPERATOR') then
      resume_owned(r.run_id);return 'RESUMED';
    end if;
    return r.state;
  end;

  procedure assess_stagnation(p_token varchar2,p_run varchar2) is
    c apxgen_autonomy_config%rowtype;a apxgen_autonomy_runs%rowtype;v_cur number;v_best number;v_first number;v_without number;
    v_old number;v_div number;v_acc number;v_rep number;v_json varchar2(1000);
  begin
    assert_lease(p_token);
    select * into c from apxgen_autonomy_config where singleton=1;
    select * into a from apxgen_autonomy_runs where run_id=p_run;
    if a.outcome<>'ACTIVE' then return;end if;
    select max(generation) into v_cur from apxgen_generations where run_id=p_run and state='COMPLETE';
    if v_cur is null or v_cur<c.stagnation_window then return;end if;
    select best_so_far into v_best from apxgen_generations where run_id=p_run and generation=v_cur;
    select min(generation) into v_first from apxgen_generations where run_id=p_run and state='COMPLETE' and best_so_far>=v_best;
    v_without:=v_cur-v_first;
    select best_so_far into v_old from apxgen_generations where run_id=p_run and generation=v_cur-c.stagnation_window;
    select avg(diversity),sum(mutation_accepted)/nullif(sum(mutation_count),0) into v_div,v_acc
    from apxgen_generations where run_id=p_run and state='COMPLETE' and generation>v_cur-c.stagnation_window;
    -- Share of new (non-elite) candidates in the window whose phenotype already appeared earlier in this run.
    select avg(case when exists(select 1 from apxgen_organisms p where p.run_id=o.run_id and p.fingerprint=o.fingerprint and p.generation<o.generation) then 1 else 0 end)
      into v_rep from apxgen_organisms o
    where o.run_id=p_run and o.generation>v_cur-c.stagnation_window and o.generation<=v_cur and o.method not in('ELITE','CHECKPOINT');
    select json_object('generation' value v_cur,'window' value c.stagnation_window,'bestSoFar' value v_best,
      'improvementInWindow' value round(v_best-v_old,6),'generationsWithoutImprovement' value v_without,
      'meanDiversity' value round(v_div,4),'mutationAcceptance' value round(v_acc,4),'repeatedPhenotypeFrequency' value round(v_rep,4),
      'stagnant' value case when v_without>=c.stagnation_window then 'true' else 'false' end format json,
      'action' value c.stagnation_action) into v_json from dual;
    update apxgen_autonomy_runs set stagnation=v_json where run_id=p_run;
    if v_without>=c.stagnation_window and a.stagnation_generation is null then
      update apxgen_autonomy_runs set stagnation_generation=v_cur where run_id=p_run;
      run_event(p_run,'AUTONOMY_STAGNATION','Policy action '||c.stagnation_action||' after '||v_without||' generations without best-so-far improvement');
      log('WARN','SUPERVISOR','Stagnation in '||p_run||' at generation '||v_cur||'; action '||c.stagnation_action,v_json);
      if c.stagnation_action='NEW_RUN' then
        update apxgen_autonomy_runs set stop_reason='STAGNATION' where run_id=p_run;
        apxgen_evolution.control(p_run,'STOP');apxgen_evolution.advance(p_run);
      elsif c.stagnation_action='PAUSE' then
        pause_owned(p_run,'STAGNATION');
      end if;
    end if;
  end;

  -- Graceful shutdown: park the active run so total_timeout pauses are explicit
  -- and reconcile resumes it automatically when the supervisor returns.
  procedure shutdown_pause(p_token varchar2,p_reason varchar2 default 'SUPERVISOR_SHUTDOWN') is v_run varchar2(32);
  begin
    assert_lease(p_token);
    if p_reason not in('SUPERVISOR_SHUTDOWN','SAFE_STOP') then raise_application_error(-20074,'Unsupported pause reason');end if;
    v_run:=active_run;
    if v_run is not null then pause_owned(v_run,p_reason);end if;
  end;

  -- The watchdog never holds the lease; it only records what it observed.
  procedure watchdog_report(p_report clob) is valid_json number;
  begin
    select case when p_report is json strict then 1 else 0 end into valid_json from dual;
    if valid_json<>1 or dbms_lob.getlength(p_report)>4000 then raise_application_error(-20074,'Watchdog report must be compact JSON');end if;
    update apxgen_supervisor set watchdog=p_report,watchdog_at=systimestamp where singleton=1;
    commit;
  end;

  -------------------------------------------------------------------------
  -- Commands
  -------------------------------------------------------------------------
  function enqueue(p_command varchar2,p_actor varchar2 default null) return number is v_id number;v_n number;
  begin
    apxgen_security.require_role('OPERATOR');
    if p_command not in('ENABLE','DISABLE','PAUSE','RESUME','STOP_RUN','PUBLISH_NOW','SHUTDOWN') then
      raise_application_error(-20073,'Unsupported autonomy command');
    end if;
    select count(*) into v_n from apxgen_commands where state='PENDING';
    if v_n>=20 then raise_application_error(-20073,'Command queue full');end if;
    insert into apxgen_commands(command,requested_by)
    values(p_command,substr(nvl(p_actor,nvl(v('APP_USER'),sys_context('USERENV','OS_USER'))),1,255))
    returning command_id into v_id;
    log('INFO','OPERATOR','Command '||p_command||' requested (#'||v_id||')');
    return v_id;
  end;

  procedure complete_command(p_token varchar2,p_id number,p_state varchar2,p_result varchar2) is
  begin
    assert_lease(p_token);
    update apxgen_commands set state=p_state,result=substr(p_result,1,1000),completed_at=systimestamp where command_id=p_id and state='PENDING';
  end;

  procedure apply_command(p_token varchar2,p_id number) is k apxgen_commands%rowtype;v_run varchar2(32);v_state varchar2(24);
  begin
    assert_lease(p_token);
    select * into k from apxgen_commands where command_id=p_id and state='PENDING' for update;
    v_run:=active_run;
    if k.command='ENABLE' then
      update apxgen_autonomy_config set enabled=1,updated_at=systimestamp,updated_by=k.requested_by where singleton=1;
      ensure_scheduler;   -- a run paused because of DISABLE is resumed by reconcile
    elsif k.command='DISABLE' then
      update apxgen_autonomy_config set enabled=0,updated_at=systimestamp,updated_by=k.requested_by where singleton=1;
      if v_run is not null then pause_owned(v_run,'DISABLED');end if;
      ensure_scheduler;
    elsif k.command='PAUSE' then
      update apxgen_autonomy_config set desired_state='PAUSED',updated_at=systimestamp,updated_by=k.requested_by where singleton=1;
      if v_run is not null then pause_owned(v_run,'OPERATOR');end if;
    elsif k.command='RESUME' then
      update apxgen_autonomy_config set desired_state='RUNNING',updated_at=systimestamp,updated_by=k.requested_by where singleton=1;
      if v_run is not null then resume_owned(v_run);end if;   -- also resumes a stagnation pause: explicit operator decision
    elsif k.command='STOP_RUN' then
      if v_run is null then
        update apxgen_commands set state='REJECTED',result='No active autonomous run',completed_at=systimestamp where command_id=p_id;return;
      end if;
      select state into v_state from apxgen_runs where run_id=v_run;
      if v_state in('RUNNING','PAUSED','PAUSE_REQUESTED') then
        update apxgen_autonomy_runs set stop_reason='OPERATOR' where run_id=v_run;
        apxgen_evolution.control(v_run,'STOP');apxgen_evolution.advance(v_run);
      end if;
    else
      raise_application_error(-20073,'Command is applied by the supervisor process');
    end if;
    update apxgen_commands set state='DONE',result='Applied',completed_at=systimestamp where command_id=p_id;
    log('INFO','SUPERVISOR','Command '||k.command||' (#'||p_id||') applied');
  end;

  -------------------------------------------------------------------------
  -- Scheduler: one repeating job ticks the active autonomous run.
  -------------------------------------------------------------------------
  procedure ensure_scheduler is n number;v_enabled number;
  begin
    select enabled into v_enabled from apxgen_autonomy_config where singleton=1;
    select count(*) into n from user_scheduler_jobs where job_name=c_job;
    if n=0 then
      dbms_scheduler.create_job(job_name=>c_job,job_type=>'PLSQL_BLOCK',job_action=>'begin apxgen_autonomy.db_tick; end;',
        start_date=>systimestamp,repeat_interval=>'FREQ=SECONDLY;INTERVAL=10',enabled=>false,auto_drop=>false,
        comments=>'Genesis autonomous run orchestration; browser measurement still requires the supervisor');
    end if;
    if v_enabled=1 then dbms_scheduler.enable(c_job);else dbms_scheduler.disable(c_job,force=>true);end if;
  end;

  procedure db_tick is v_run varchar2(32);v_enabled number;v_recent number;
  begin
    select enabled into v_enabled from apxgen_autonomy_config where singleton=1;
    if v_enabled=0 then return;end if;
    v_run:=active_run;
    if v_run is null then return;end if;
    apxgen_evolution.tick(v_run);
  exception when others then
    if sqlcode=-54 then return;end if;          -- the supervisor is ticking the same run right now
    declare v_code number:=sqlcode;begin
      select count(*) into v_recent from apxgen_supervisor_log where source='DATABASE' and logged_at>systimestamp-interval '10' minute;
      if v_recent=0 then log('WARN','DATABASE','Scheduler tick rejected with code '||v_code);end if;
    end;
  end;

  -------------------------------------------------------------------------
  -- Publication bookkeeping
  -------------------------------------------------------------------------
  function publication_begin(p_token varchar2,p_run varchar2,p_kind varchar2,p_generation number,p_target varchar2,p_key varchar2,p_sha varchar2,p_bytes number) return number is v_id number;
  begin
    assert_lease(p_token);
    insert into apxgen_publications(run_id,kind,generation,target,object_key,sha256,bytes,attempts)
    values(p_run,p_kind,p_generation,p_target,p_key,p_sha,p_bytes,1) returning publication_id into v_id;
    return v_id;
  end;

  procedure publication_end(p_token varchar2,p_id number,p_state varchar2,p_error varchar2 default null) is
  begin
    assert_lease(p_token);
    update apxgen_publications set state=p_state,error=substr(p_error,1,1000),completed_at=systimestamp where publication_id=p_id;
  end;

  procedure mark_published(p_token varchar2,p_run varchar2,p_generation number,p_final number) is
  begin
    assert_lease(p_token);
    update apxgen_autonomy_runs set published_generation=greatest(published_generation,p_generation),
      published_final=greatest(published_final,p_final),published_at=systimestamp where run_id=p_run;
  end;

  -------------------------------------------------------------------------
  -- Status for the APEX operations panel and the CLI
  -------------------------------------------------------------------------
  function status_json return clob is
    j json_object_t:=json_object_t();x json_object_t;s apxgen_supervisor%rowtype;c apxgen_autonomy_config%rowtype;
    a apxgen_autonomy_runs%rowtype;r apxgen_runs%rowtype;v_detail varchar2(400);n number;v_json clob;w json_array_t:=json_array_t();
    v_job_state varchar2(30);v_job_last timestamp with time zone;v_job_failures number;v_usd number;
  begin
    select * into s from apxgen_supervisor where singleton=1;
    select * into c from apxgen_autonomy_config where singleton=1;
    x:=json_object_t();
    x.put('state',s.state);x.put('detail',s.detail);x.put('host',s.host);x.put('pid',s.pid);x.put('version',s.version);
    x.put('leaseHeld',case when s.lease_token is not null and s.lease_until>systimestamp then true else false end);
    x.put('leaseUntil',utc_text(s.lease_until));x.put('heartbeat',utc_text(s.heartbeat));x.put('startedAt',utc_text(s.instance_started_at));
    x.put('heartbeatAgeSeconds',case when s.heartbeat is not null then round((cast(systimestamp as date)-cast(s.heartbeat as date))*86400) end);
    if s.metrics is not null then x.put('metrics',json_element_t.parse(s.metrics));end if;
    if s.watchdog is not null then x.put('watchdog',json_element_t.parse(s.watchdog));x.put('watchdogAt',utc_text(s.watchdog_at));end if;
    j.put('supervisor',x);

    select json_object('enabled' value c.enabled,'desiredState' value c.desired_state,'populationMode' value c.population_mode,
      'populationSize' value c.population_size,'generationsPerRun' value c.generations_per_run,'researchPolicy' value c.research_policy,
      'independentQuota' value c.independent_quota,'stagnationWindow' value c.stagnation_window,'stagnationAction' value c.stagnation_action,
      'autoNextRun' value c.auto_next_run,'maxActiveRuns' value c.max_active_runs,'dailyGenerationCap' value c.daily_generation_cap,
      'runCooldownSeconds' value c.run_cooldown_seconds,'generationIntervalSeconds' value c.generation_interval_seconds,
      'storageBudgetMb' value c.storage_budget_mb,'maxRunRecoveries' value c.max_run_recoveries,'publishEnabled' value c.publish_enabled,
      'publishEveryGenerations' value c.publish_every_generations,'publishMinIntervalSeconds' value c.publish_min_interval_seconds,
      'paidAi' value c.paid_ai,'labelPrefix' value c.label_prefix,'baseSeed' value c.base_seed,'protocolVersion' value c.protocol_version,
      'updatedAt' value utc_text(c.updated_at),'updatedBy' value c.updated_by returning clob) into v_json from dual;
    j.put('config',json_element_t.parse(v_json));

    begin
      select state,last_start_date,failure_count into v_job_state,v_job_last,v_job_failures from user_scheduler_jobs where job_name=c_job;
    exception when no_data_found then v_job_state:='MISSING';end;
    x:=json_object_t();x.put('job',c_job);x.put('state',v_job_state);x.put('lastStart',utc_text(v_job_last));x.put('failures',v_job_failures);
    j.put('scheduler',x);

    x:=json_object_t();
    begin
      select * into a from apxgen_autonomy_runs where outcome='ACTIVE' order by sequence_no desc fetch first 1 row only;
      select * into r from apxgen_runs where run_id=a.run_id;
      x.put('sequence',a.sequence_no);x.put('runId',r.run_id);x.put('label',r.label);x.put('policy',a.policy);x.put('seed',a.seed);
      x.put('state',r.state);x.put('generation',r.current_generation);x.put('target',r.target_generations);x.put('pausedBy',a.paused_by);
      x.put('environmentHash',a.environment_hash);x.put('startedAt',utc_text(r.started_at));
      select count(*) into n from apxgen_organisms where run_id=r.run_id and evaluation_state in('PENDING','CLAIMED');x.put('pendingEvaluations',n);
      select count(*) into n from apxgen_organisms where run_id=r.run_id and evaluation_state='FAILED';x.put('failedEvaluations',n);
      select max(generation),max(completed_at) into n,v_job_last from apxgen_generations where run_id=r.run_id and state='COMPLETE';
      x.put('lastCheckpointGeneration',n);x.put('lastCheckpointAt',utc_text(v_job_last));
      select max(best_so_far) into n from apxgen_generations where run_id=r.run_id;x.put('bestSoFar',n);
      x.put('publishedGeneration',a.published_generation);x.put('publishedAt',utc_text(a.published_at));
      if a.stagnation is not null then x.put('stagnation',json_element_t.parse(a.stagnation));end if;
      j.put('activeRun',x);
    exception when no_data_found then j.put_null('activeRun');end;

    x:=json_object_t();
    x.put('generationsToday',generations_today);x.put('dailyCap',c.daily_generation_cap);
    select count(*) into n from apxgen_autonomy_runs;x.put('autonomousRuns',n);
    select count(*) into n from apxgen_autonomy_runs where outcome in('COMPLETED','STAGNATED');x.put('finishedRuns',n);
    select count(*) into n from apxgen_autonomy_runs where outcome='FAILED';x.put('failedRuns',n);
    select count(*) into n from apxgen_autonomy_runs where outcome='RECOVERED';x.put('recoveredRuns',n);
    x.put('storageBytes',storage_bytes);x.put('storageBudgetBytes',c.storage_budget_mb*1048576);x.put('quotaBytes',quota_bytes);
    x.put('admission',case when admission(v_detail)=1 then 'ADMITTED' else 'WAITING' end);x.put('admissionDetail',v_detail);
    j.put('budgets',x);

    -- Paid AI is structurally disabled for autonomous runs; report the evidence.
    x:=json_object_t();x.put('paidAiEnabled',false);
    select count(*) into n from apxgen_invocations i join apxgen_autonomy_runs a2 on a2.run_id=i.run_id;x.put('autonomousInvocations',n);
    select count(*),nvl(sum(actual_usd),0) into n,v_usd from apxgen_invocations;x.put('ledgerInvocations',n);x.put('ledgerUsageUsd',v_usd);
    select count(*) into n from apxgen_invocations where state in('RESERVED','UNCERTAIN');x.put('openReservations',n);
    j.put('ai',x);

    x:=json_object_t();
    begin
      select json_object('id' value publication_id,'kind' value kind,'runId' value run_id,'generation' value generation,'target' value target,
        'state' value state,'key' value object_key,'sha256' value sha256,'bytes' value bytes,'error' value error,
        'createdAt' value utc_text(created_at),'completedAt' value utc_text(completed_at) returning clob)
        into v_json from apxgen_publications where kind='POINTER' and state='LIVE' order by publication_id desc fetch first 1 row only;
      x.put('lastLive',json_element_t.parse(v_json));
    exception when no_data_found then x.put_null('lastLive');end;
    begin
      select json_object('id' value publication_id,'kind' value kind,'state' value state,'error' value error,'createdAt' value utc_text(created_at) returning clob)
        into v_json from apxgen_publications where state='FAILED' order by publication_id desc fetch first 1 row only;
      x.put('lastError',json_element_t.parse(v_json));
    exception when no_data_found then x.put_null('lastError');end;
    select count(*) into n from apxgen_autonomy_runs a3 where (a3.outcome<>'ACTIVE' and a3.published_final=0)
      or (a3.outcome='ACTIVE' and (select nvl(max(generation),-1) from apxgen_generations g where g.run_id=a3.run_id and g.state='COMPLETE')>a3.published_generation);
    x.put('runsWithUnpublishedProgress',n);
    j.put('publication',x);

    select count(*) into n from apxgen_commands where state='PENDING';j.put('pendingCommands',n);

    -- Warnings
    if s.heartbeat is null or s.heartbeat<systimestamp-interval '3' minute then w.append('Supervisor heartbeat is stale or missing');end if;
    if s.state='SAFE_STOPPED' then w.append('Supervisor is in a safe-stopped state; operator action required');end if;
    if c.enabled=1 and v_job_state not in('SCHEDULED','RUNNING') then w.append('Scheduler job is not scheduled');end if;
    if storage_bytes>c.storage_budget_mb*1048576*.9 then w.append('Storage is above 90% of the configured budget');end if;
    select count(*) into n from apxgen_invocations where state in('RESERVED','UNCERTAIN');
    if n>0 then w.append('Open AI reservations exist (historical ledger); they are not reset automatically');end if;
    j.put('warnings',w);j.put('generatedAt',utc_text(systimestamp));
    return j.to_clob;
  end;

  function log_json(p_limit number default 100) return clob is v clob;
  begin
    select json_arrayagg(json_object('id' value log_id,'at' value utc_text(logged_at),'level' value log_level,'source' value source,'message' value message returning clob) order by log_id desc returning clob)
    into v from (select * from apxgen_supervisor_log order by log_id desc fetch first least(greatest(nvl(p_limit,100),1),500) rows only);
    return nvl(v,'[]');
  end;

  function publications_json(p_limit number default 50) return clob is v clob;
  begin
    select json_arrayagg(json_object('id' value publication_id,'runId' value run_id,'kind' value kind,'generation' value generation,'target' value target,
      'state' value state,'key' value object_key,'sha256' value sha256,'bytes' value bytes,'attempts' value attempts,'error' value error,
      'createdAt' value utc_text(created_at),'completedAt' value utc_text(completed_at) returning clob) order by publication_id desc returning clob)
    into v from (select * from apxgen_publications order by publication_id desc fetch first least(greatest(nvl(p_limit,50),1),200) rows only);
    return nvl(v,'[]');
  end;
end apxgen_autonomy;
/
