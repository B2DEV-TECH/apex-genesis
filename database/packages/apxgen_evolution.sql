create or replace package apxgen_evolution authid definer as
  function create_run(p_label varchar2,p_mode varchar2 default 'GA_ONLY',p_seed number default 42,p_size number default 12,p_generations number default 100) return varchar2;
  procedure initialize(p_run varchar2);
  procedure configure(p_run varchar2,p_config clob);
  procedure run_generations(p_run varchar2,p_count number);
  procedure advance(p_run varchar2);
  procedure control(p_run varchar2,p_action varchar2);
  procedure claim(p_run varchar2,p_organism out number,p_token out varchar2,p_genome out clob);
  -- Autonomous runs are claimable only by the holder of the supervisor lease.
  procedure claim(p_run varchar2,p_lease varchar2,p_organism out number,p_token out varchar2,p_genome out clob);
  procedure submit_evaluation(p_organism number,p_token varchar2,p_environment varchar2,p_metrics clob,p_cached_from number default null);
  procedure fail_evaluation(p_organism number,p_token varchar2,p_environment varchar2,p_reason varchar2);
  -- p_target_generations/p_label are optional (autonomy continuations and lineage runs); defaults keep the original behaviour.
  function duplicate_run(p_run varchar2,p_generation number default 0,p_target_generations number default null,p_label varchar2 default null) return varchar2;
  procedure schedule_run(p_run varchar2);
  procedure tick(p_run varchar2);
end apxgen_evolution;
/
create or replace package body apxgen_evolution as
  procedure event(p_run varchar2,p_generation number,p_type varchar2,p_detail varchar2) is
  begin insert into apxgen_events(run_id,generation,event_type,details)values(p_run,p_generation,p_type,substr(p_detail,1,2000));end;
  function create_run(p_label varchar2,p_mode varchar2 default 'GA_ONLY',p_seed number default 42,p_size number default 12,p_generations number default 100) return varchar2 is id varchar2(32):=lower(rawtohex(sys_guid()));
  begin
    if p_seed is null or p_seed<>trunc(p_seed) or p_seed not between 1 and 2147483646 or p_size<>trunc(p_size) or p_generations<>trunc(p_generations) then raise_application_error(-20020,'Invalid experiment parameters');end if;
    insert into apxgen_runs(run_id,label,population_mode,seed,rng_state,population_size,target_generations,state,engine_version)values(id,p_label,p_mode,p_seed,p_seed,p_size,p_generations,'READY','1.1.0');
    insert into apxgen_run_budgets(run_id)values(id);event(id,null,'CREATED','Provider disabled; browser evaluation required');return id;
  end;
  procedure configure(p_run varchar2,p_config clob) is
    r apxgen_runs%rowtype;j json_object_t;keys json_key_list;w json_object_t;wk json_key_list;total number:=0;valid_json number;
    function value_of(k varchar2,old_value number,lo number,hi number,whole boolean default false) return number is n number;
    begin
      if not j.has(k) then return old_value;end if;
      if not j.get(k).is_number then raise_application_error(-20026,'Numeric configuration required');end if;
      n:=j.get_number(k);if n is null or n<lo or n>hi or (whole and n<>trunc(n))then raise_application_error(-20026,'Configuration outside safe limits');end if;return n;
    end;
  begin
    select * into r from apxgen_runs where run_id=p_run for update nowait;
    if r.state<>'READY' or r.current_generation<>-1 then raise_application_error(-20026,'Configuration is immutable after initialization');end if;
    select case when p_config is json strict with unique keys then 1 else 0 end into valid_json from dual;
    if valid_json<>1 then raise_application_error(-20026,'Strict configuration JSON required');end if;
    j:=json_object_t.parse(p_config);keys:=j.get_keys;
    for i in 1..keys.count loop if keys(i) not in('mutationRate','crossoverRate','eliteCount','tournamentSize','diversityThreshold','stagnationLimit','generationTimeout','totalTimeout','fitnessWeights')then raise_application_error(-20026,'Unknown configuration property');end if;end loop;
    r.mutation_rate:=value_of('mutationRate',r.mutation_rate,0,1);r.crossover_rate:=value_of('crossoverRate',r.crossover_rate,0,1);
    r.elite_count:=value_of('eliteCount',r.elite_count,0,r.population_size-1,true);r.tournament_size:=value_of('tournamentSize',r.tournament_size,2,10,true);
    r.diversity_threshold:=value_of('diversityThreshold',r.diversity_threshold,0,1);r.stagnation_limit:=value_of('stagnationLimit',r.stagnation_limit,1,1000,true);
    r.generation_timeout:=value_of('generationTimeout',r.generation_timeout,30,7200,true);r.total_timeout:=value_of('totalTimeout',r.total_timeout,30,86400,true);
    if r.total_timeout<r.generation_timeout then raise_application_error(-20026,'Total timeout must cover a generation');end if;
    if j.has('fitnessWeights')then
      w:=j.get_object('fitnessWeights');wk:=w.get_keys;
      if wk.count<>4 then raise_application_error(-20026,'Exactly four fitness weights required');end if;
      for i in 1..wk.count loop
        if wk(i) not in('accessibility','hierarchy','responsiveness','performance') or not w.get(wk(i)).is_number then raise_application_error(-20026,'Unknown or invalid fitness weight');end if;
        if w.get_number(wk(i))<0 or w.get_number(wk(i))>1 then raise_application_error(-20026,'Fitness weight outside limits');end if;total:=total+w.get_number(wk(i));
      end loop;
      if abs(total-1)>.000000001 then raise_application_error(-20026,'Fitness weights must sum to one');end if;r.fitness_weights:=w.to_string;
    end if;
    update apxgen_runs set mutation_rate=r.mutation_rate,crossover_rate=r.crossover_rate,elite_count=r.elite_count,tournament_size=r.tournament_size,diversity_threshold=r.diversity_threshold,stagnation_limit=r.stagnation_limit,generation_timeout=r.generation_timeout,total_timeout=r.total_timeout,fitness_weights=r.fitness_weights where run_id=p_run;
    event(p_run,null,'CONFIGURED',j.to_string);
  end;
  procedure run_generations(p_run varchar2,p_count number) is r apxgen_runs%rowtype;gs varchar2(16);boundary number;
  begin
    select * into r from apxgen_runs where run_id=p_run for update nowait;
    if p_count is null or p_count<>trunc(p_count) or p_count not between 1 and 100 or r.state not in('RUNNING','PAUSED')then raise_application_error(-20027,'Run count must be 1 to 100 for a running or paused experiment');end if;
    select state into gs from apxgen_generations where run_id=p_run and generation=r.current_generation;
    boundary:=least(r.target_generations,r.current_generation+p_count-case when gs='EVALUATING' then 1 else 0 end);
    update apxgen_runs set state='RUNNING',pause_at_generation=boundary,heartbeat=systimestamp where run_id=p_run;
    event(p_run,r.current_generation,'RUN_BOUNDED','Pause after completed generation '||boundary);
  end;
  function add_organism(p_run varchar2,p_gen number,p_ordinal number,p_g apxgen_genome.genes,p_method varchar2,p_parent number default null,p_second number default null) return number is
    id number;h varchar2(64):=apxgen_genome.persist(p_g);
  begin
    insert into apxgen_organisms(run_id,generation,ordinal,fingerprint,method)values(p_run,p_gen,p_ordinal,h,p_method)returning organism_id into id;
    if p_parent is not null then insert into apxgen_parents values(id,p_parent,'PRIMARY');end if;
    if p_second is not null and p_second<>p_parent then insert into apxgen_parents values(id,p_second,'SECONDARY');end if;return id;
  end;
  procedure initialize(p_run varchar2) is r apxgen_runs%rowtype;g apxgen_genome.genes;id number;
  begin
    select * into r from apxgen_runs where run_id=p_run for update nowait;
    if r.current_generation>=0 then return;end if;
    if r.state<>'READY' then raise_application_error(-20021,'Run is not ready');end if;
    insert into apxgen_generations(run_id,generation,rng_before,rng_after)values(p_run,0,r.rng_state,r.rng_state);
    for i in 1..r.population_size loop g:=apxgen_genome.random_genes(r.rng_state);
      if i=1 then g(1):=3;g(2):=1;g(3):=23;g(4):=0;g(5):=0;g(6):=0;g(7):=1;g(8):=0;g(9):=1;g(10):=0;g(11):=0;end if;
      id:=add_organism(p_run,0,i,g,'INITIAL');
    end loop;
    update apxgen_generations set rng_after=r.rng_state where run_id=p_run and generation=0;
    update apxgen_runs set current_generation=0,rng_state=r.rng_state,state='RUNNING',started_at=systimestamp,heartbeat=systimestamp where run_id=p_run;
    event(p_run,0,'INITIALIZED','Shared seeded starting population');
  end;
  procedure claim_any(p_run varchar2,p_organism out number,p_token out varchar2,p_genome out clob) is
    cursor q is select o.organism_id,o.fingerprint from apxgen_organisms o join apxgen_runs r on r.run_id=o.run_id where o.run_id=p_run and r.state='RUNNING' and (o.evaluation_state='PENDING' or (o.evaluation_state='CLAIMED' and o.lease_until<systimestamp)) order by o.ordinal for update of o.evaluation_state skip locked;
  begin
    p_organism:=null;p_token:=null;p_genome:=null;
    for x in q loop p_organism:=x.organism_id;p_token:=lower(rawtohex(sys_guid()));select canonical_json into p_genome from apxgen_genomes where fingerprint=x.fingerprint;
      update apxgen_organisms set evaluation_state='CLAIMED',claim_token=p_token,lease_until=systimestamp+numtodsinterval(120,'SECOND')where organism_id=x.organism_id;exit;
    end loop;
  end;
  procedure claim(p_run varchar2,p_organism out number,p_token out varchar2,p_genome out clob) is n number;
  begin
    -- A manual worker must never evaluate a run that the supervisor owns.
    select count(*) into n from apxgen_autonomy_runs where run_id=p_run;
    if n>0 then raise_application_error(-20075,'Autonomous runs are evaluated only by the lease-holding supervisor');end if;
    claim_any(p_run,p_organism,p_token,p_genome);
  end;
  procedure claim(p_run varchar2,p_lease varchar2,p_organism out number,p_token out varchar2,p_genome out clob) is
  begin
    apxgen_autonomy.assert_lease(p_lease);
    claim_any(p_run,p_organism,p_token,p_genome);
  end;
  procedure submit_evaluation(p_organism number,p_token varchar2,p_environment varchar2,p_metrics clob,p_cached_from number default null) is
    o apxgen_organisms%rowtype;c clob;e number;f number;a number;h number;r number;p number;cr number;env varchar2(128);weights varchar2(400);n number;metrics_data clob:=p_metrics;
  begin
    select * into o from apxgen_organisms where organism_id=p_organism for update;
    if o.evaluation_state<>'CLAIMED' or o.claim_token<>p_token or p_token is null or o.lease_until<systimestamp then raise_application_error(-20022,'Evaluation lease rejected');end if;
    if p_environment is null then raise_application_error(-20022,'Evaluation environment required');end if;
    select evaluation_context,fitness_weights into env,weights from apxgen_runs where run_id=o.run_id for update;
    if env is not null and env<>p_environment then raise_application_error(-20022,'Evaluation environment changed');end if;
    if p_cached_from is not null then
      select count(*) into n from apxgen_evaluations e join apxgen_organisms x on x.organism_id=e.organism_id where e.organism_id=p_cached_from and x.fingerprint=o.fingerprint and e.environment_hash=p_environment;
      if n<>1 then raise_application_error(-20022,'Invalid evaluation cache reference');end if;
      select measurements into metrics_data from apxgen_evaluations where organism_id=p_cached_from;
    end if;
    select canonical_json into c from apxgen_genomes where fingerprint=o.fingerprint;
    apxgen_fitness.score(c,metrics_data,e,f,a,h,r,p,cr,weights);
    insert into apxgen_evaluations(organism_id,environment_hash,eligible,fitness,accessibility,hierarchy,responsiveness,performance_proxy,contrast_ratio,measurements,cached_from)values(p_organism,p_environment,e,f,a,h,r,p,cr,metrics_data,p_cached_from);
    update apxgen_organisms set evaluation_state='COMPLETE',claim_token=null,lease_until=null where organism_id=p_organism;
    update apxgen_runs set evaluation_context=p_environment,heartbeat=systimestamp where run_id=o.run_id;
  end;
  procedure fail_evaluation(p_organism number,p_token varchar2,p_environment varchar2,p_reason varchar2) is m clob;
  begin
    m:='{"overflow":0,"overlap":0,"clipped":0,"missing":1,"unnamed":0,"axeCritical":0,"focusVisible":0,"domNodes":1,"viewportsTested":3,"errors":1,"renderMs":0}';
    submit_evaluation(p_organism,p_token,p_environment,m);
    update apxgen_organisms set evaluation_state='FAILED' where organism_id=p_organism;
    insert into apxgen_events(run_id,generation,event_type,details) select run_id,generation,'EVALUATION_FAILED',substr(p_reason,1,1000)from apxgen_organisms where organism_id=p_organism;
  end;
  procedure finalize_generation(r apxgen_runs%rowtype) is
    best number;avgf number;med number;v number;validn number;failedn number;div_value number;bestever number;mc number;ma number;
  begin
    select max(e.fitness),avg(e.fitness),median(e.fitness),var_pop(e.fitness),sum(e.eligible),sum(case when o.evaluation_state='FAILED' then 1 else 0 end),count(distinct o.fingerprint)/count(*)
      into best,avgf,med,v,validn,failedn,div_value from apxgen_organisms o join apxgen_evaluations e on e.organism_id=o.organism_id where o.run_id=r.run_id and o.generation=r.current_generation;
    select greatest(nvl(max(best_so_far),0),best)into bestever from apxgen_generations where run_id=r.run_id;
    select count(*),nvl(sum(case when e.fitness>nvl((select max(pe.fitness)from apxgen_parents p join apxgen_evaluations pe on pe.organism_id=p.parent_id where p.child_id=o.organism_id),0) and e.eligible=1 then 1 else 0 end),0)
      into mc,ma from apxgen_organisms o join apxgen_evaluations e on e.organism_id=o.organism_id where o.run_id=r.run_id and o.generation=r.current_generation and o.method in('MUTATION','CROSSOVER','AI','IMMIGRANT');
    update apxgen_generations set state='COMPLETE',best_fitness=best,mean_fitness=avgf,median_fitness=med,variance_fitness=v,best_so_far=bestever,diversity=div_value,valid_count=validn,failed_count=failedn,mutation_count=mc,mutation_accepted=ma,completed_at=systimestamp where run_id=r.run_id and generation=r.current_generation;
    event(r.run_id,r.current_generation,'GENERATION_COMPLETE','Eligible '||validn||'/'||r.population_size||'; best='||to_char(best,'FM990D999999','NLS_NUMERIC_CHARACTERS=''.,'''));
    if validn=0 then event(r.run_id,r.current_generation,'NO_ELIGIBLE_CANDIDATES','All candidates failed hard constraints');end if;
    if div_value<r.diversity_threshold then event(r.run_id,r.current_generation,'LOW_DIVERSITY','Immigrants are used after bounded duplicate retries');end if;
  end;
  function needs_ai(r apxgen_runs%rowtype) return boolean is n number;attempts number;
  begin
    if r.population_mode<>'GA_HAIKU' or r.state<>'RUNNING' or r.current_generation>=r.target_generations then return false;end if;
    select count(*) into n from apxgen_invocations where run_id=r.run_id and generation=r.current_generation and (state='RESERVED' or (state='RECONCILED' and proposal is null and error_code is null));if n>0 then return true;end if;
    select count(*)into attempts from apxgen_invocations where run_id=r.run_id and generation=r.current_generation;if attempts>0 then return false;end if;
    select count(*)into n from apxgen_provider_config c join apxgen_run_budgets b on b.run_id=r.run_id where c.singleton=1 and c.enabled=1 and b.enabled=1 and b.stopped=0 and c.request_interval>=1 and mod(r.current_generation+1,c.request_interval)=0;
    if n=0 then return false;end if;
    select count(*)into n from apxgen_generations where run_id=r.run_id and generation=r.current_generation and state='COMPLETE' and valid_count>0;
    return n=1;
  end;
  procedure advance(p_run varchar2) is
    r apxgen_runs%rowtype;pending number;gs varchar2(16);g apxgen_genome.genes;a apxgen_genome.genes;b apxgen_genome.genes;id number;parent number;second number;method varchar2(20);h varchar2(64);dups number;before_rng number;stagnant number;started timestamp with time zone;ai_id varchar2(32);ai_json clob;ai_parent number;child_json clob;
    type ids is table of number index by pls_integer;parents ids;scores ids;cnt pls_integer:=0;
    function tournament return number is idx pls_integer;winner pls_integer;
    begin winner:=apxgen_genome.next_random(r.rng_state,cnt)+1;
      for j in 2..r.tournament_size loop idx:=apxgen_genome.next_random(r.rng_state,cnt)+1;if scores(idx)>scores(winner)then winner:=idx;end if;end loop;return parents(winner);
    end;
    function genes_of(p_id number) return apxgen_genome.genes is c clob;begin select g.canonical_json into c from apxgen_organisms o join apxgen_genomes g on g.fingerprint=o.fingerprint where o.organism_id=p_id;return apxgen_genome.to_genes(c);end;
  begin
    select * into r from apxgen_runs where run_id=p_run for update nowait;
    if r.state='PAUSE_REQUESTED' then update apxgen_runs set state='PAUSED',heartbeat=systimestamp where run_id=p_run;event(p_run,r.current_generation,'PAUSED','In-flight evaluation may finish; no new work claimed');return;end if;
    if r.state='STOP_REQUESTED' then update apxgen_runs set state='STOPPED',ended_at=systimestamp where run_id=p_run;event(p_run,r.current_generation,'STOPPED','No new generations');return;end if;
    if r.state<>'RUNNING' then return;end if;
    select state,started_at into gs,started from apxgen_generations where run_id=p_run and generation=r.current_generation;
    if systimestamp>r.started_at+numtodsinterval(r.total_timeout,'SECOND') or (gs='EVALUATING' and systimestamp>started+numtodsinterval(r.generation_timeout,'SECOND')) then update apxgen_runs set state='FAILED',failure='Experiment or generation time limit exceeded',ended_at=systimestamp where run_id=p_run;event(p_run,r.current_generation,'TIMEOUT','Resume requires explicit checkpoint duplication');return;end if;
    select count(*)into pending from apxgen_organisms where run_id=p_run and generation=r.current_generation and evaluation_state not in('COMPLETE','FAILED');
    if pending>0 then return;end if;
    if gs<>'COMPLETE' then finalize_generation(r);end if;
    if r.current_generation>=r.target_generations then update apxgen_runs set state='COMPLETED',ended_at=systimestamp,heartbeat=systimestamp where run_id=p_run;event(p_run,r.current_generation,'COMPLETED','Target reached');return;end if;
    if r.pause_at_generation is not null and r.current_generation>=r.pause_at_generation then update apxgen_runs set state='PAUSED',heartbeat=systimestamp where run_id=p_run;event(p_run,r.current_generation,'PAUSED','Bounded generation request completed');return;end if;
    if needs_ai(r) then
      select count(*)into pending from apxgen_events where run_id=p_run and generation=r.current_generation and event_type='AI_BOUNDARY_WAIT';
      if pending=0 then event(p_run,r.current_generation,'AI_BOUNDARY_WAIT','Waiting for a bounded provider attempt before offspring creation');end if;
      return;
    end if;
    select count(*)into stagnant from apxgen_generations where run_id=p_run and generation>r.current_generation-r.stagnation_limit and best_fitness=(select best_so_far from apxgen_generations where run_id=p_run and generation=r.current_generation);
    if stagnant>=r.stagnation_limit then event(p_run,r.current_generation,'STAGNATION','No score improvement in configured window');end if;
    for x in(select o.organism_id,e.fitness,e.eligible from apxgen_organisms o join apxgen_evaluations e on e.organism_id=o.organism_id where o.run_id=p_run and o.generation=r.current_generation order by e.eligible desc,e.fitness desc,o.ordinal)loop cnt:=cnt+1;parents(cnt):=x.organism_id;scores(cnt):=round(x.fitness*1000000)+x.eligible*1000000000;end loop;
    before_rng:=r.rng_state;r.current_generation:=r.current_generation+1;
    insert into apxgen_generations(run_id,generation,rng_before,rng_after)values(p_run,r.current_generation,before_rng,before_rng);
    for i in 1..r.population_size loop
      parent:=null;second:=null;ai_id:=null;
      if r.population_mode='RANDOM_SEARCH' then g:=apxgen_genome.random_genes(r.rng_state);method:='RANDOM';
      elsif i<=r.elite_count then parent:=parents(i);g:=genes_of(parent);method:='ELITE';
      else
        parent:=tournament;a:=genes_of(parent);g:=a;method:='MUTATION';
        if apxgen_genome.next_random(r.rng_state,1000000)<r.crossover_rate*1000000 then second:=tournament;b:=genes_of(second);g:=apxgen_genetics.crossover(a,b,r.rng_state);method:='CROSSOVER';end if;
        g:=apxgen_genetics.mutate(g,r.rng_state,r.mutation_rate);
        for attempt in 1..5 loop h:=apxgen_genome.fingerprint(apxgen_genome.from_genes(g));select count(*)into dups from apxgen_organisms where run_id=p_run and generation=r.current_generation and fingerprint=h;exit when dups=0;g:=apxgen_genetics.mutate(g,r.rng_state,greatest(r.mutation_rate,.5));end loop;
        if dups>0 then g:=apxgen_genome.random_genes(r.rng_state);method:='IMMIGRANT';parent:=null;second:=null;end if;
      end if;
      if r.population_mode='GA_HAIKU' and i=r.elite_count+1 then
        begin
          select invocation_id,proposal,organism_id into ai_id,ai_json,ai_parent from apxgen_invocations where run_id=p_run and generation=r.current_generation-1 and state='RECONCILED' and proposal is not null and error_code is null and applied_organism is null order by created_at fetch first 1 row only;
          child_json:=apxgen_genome.from_genes(genes_of(ai_parent));g:=apxgen_genome.to_genes(apxgen_ai.apply_proposal(child_json,ai_json));parent:=ai_parent;second:=null;method:='AI';
        exception when no_data_found then null;end;
      end if;
      id:=add_organism(p_run,r.current_generation,i,g,method,parent,second);
      if ai_id is not null then update apxgen_invocations set applied_organism=id where invocation_id=ai_id;event(p_run,r.current_generation,'AI_OFFSPRING','Approved mutation enters unchanged fitness pipeline');end if;
    end loop;
    update apxgen_generations set rng_after=r.rng_state where run_id=p_run and generation=r.current_generation;
    update apxgen_runs set current_generation=r.current_generation,rng_state=r.rng_state,heartbeat=systimestamp where run_id=p_run;
    event(p_run,r.current_generation,'GENERATION_CREATED','Database operators; candidates await browser observations');
  end;
  procedure control(p_run varchar2,p_action varchar2) is r apxgen_runs%rowtype;
  begin select * into r from apxgen_runs where run_id=p_run for update nowait;
    if p_action='PAUSE' and r.state='RUNNING' then update apxgen_runs set state='PAUSE_REQUESTED' where run_id=p_run;
    elsif p_action='RESUME' and r.state='PAUSED' then update apxgen_runs set state='RUNNING',pause_at_generation=null,heartbeat=systimestamp where run_id=p_run;
    elsif p_action='STOP' and r.state in('RUNNING','PAUSED','PAUSE_REQUESTED','READY')then update apxgen_runs set state='STOP_REQUESTED' where run_id=p_run;
    else raise_application_error(-20023,'Invalid state transition');end if;event(p_run,r.current_generation,p_action,'Explicit operator request');
  end;
  function duplicate_run(p_run varchar2,p_generation number default 0,p_target_generations number default null,p_label varchar2 default null) return varchar2 is r apxgen_runs%rowtype;id varchar2(32);n number;oid number;g apxgen_genome.genes;state_rng number;
  begin
    select * into r from apxgen_runs where run_id=p_run;select count(*)into n from apxgen_generations where run_id=p_run and generation=p_generation and state='COMPLETE';
    if n<>1 then raise_application_error(-20024,'Completed checkpoint required');end if;
    id:=create_run(nvl(substr(p_label,1,160),substr('Checkpoint of '||r.label,1,120)),r.population_mode,r.seed,r.population_size,nvl(p_target_generations,r.target_generations));
    select rng_after into state_rng from apxgen_generations where run_id=p_run and generation=p_generation;
    insert into apxgen_generations(run_id,generation,rng_before,rng_after) values(id,0,state_rng,state_rng);
    for x in(select o.organism_id,o.ordinal,g.canonical_json from apxgen_organisms o join apxgen_genomes g on g.fingerprint=o.fingerprint where o.run_id=p_run and o.generation=p_generation order by ordinal)loop g:=apxgen_genome.to_genes(x.canonical_json);oid:=add_organism(id,0,x.ordinal,g,'CHECKPOINT',x.organism_id);end loop;
    update apxgen_runs set source_run=p_run,source_generation=p_generation,current_generation=0,rng_state=state_rng,state='RUNNING',started_at=systimestamp,heartbeat=systimestamp,mutation_rate=r.mutation_rate,crossover_rate=r.crossover_rate,elite_count=r.elite_count,tournament_size=r.tournament_size,diversity_threshold=r.diversity_threshold,stagnation_limit=r.stagnation_limit,generation_timeout=r.generation_timeout,total_timeout=r.total_timeout,fitness_weights=r.fitness_weights where run_id=id;return id;
  end;
  procedure tick(p_run varchar2) is r apxgen_runs%rowtype;n number;parent_id number;error_no number;
  begin
    apxgen_budget.recover_stale;advance(p_run);commit;
    select * into r from apxgen_runs where run_id=p_run;
    if needs_ai(r) then
      select count(*)into n from apxgen_invocations where run_id=p_run and generation=r.current_generation;
      if n=0 then
        select o.organism_id into parent_id from apxgen_organisms o join apxgen_evaluations e on e.organism_id=o.organism_id where o.run_id=p_run and o.generation=r.current_generation and e.eligible=1 order by e.fitness desc,o.ordinal fetch first 1 row only;
        begin apxgen_ai.propose(p_run,parent_id);exception when others then
          error_no:=sqlcode;select count(*)into n from apxgen_invocations where run_id=p_run and generation=r.current_generation;
          if n=0 then apxgen_budget.stop_ai(p_run);end if;
          event(p_run,r.current_generation,'AI_FALLBACK','Provider attempt rejected with code '||error_no||'; no unrecorded retry');commit;
        end;
      end if;
    end if;
    advance(p_run);commit;
    select state into r.state from apxgen_runs where run_id=p_run;
    if r.state in('COMPLETED','STOPPED','FAILED')then
      select count(*)into n from user_scheduler_jobs where job_name='APXGEN_'||upper(substr(p_run,1,24));
      if n=1 then dbms_scheduler.disable('APXGEN_'||substr(p_run,1,24),force=>true);end if;
    end if;
  exception when others then rollback;raise;end;
  procedure schedule_run(p_run varchar2) is n number;
  begin
    if not regexp_like(p_run,'^[a-f0-9]{32}$')then raise_application_error(-20025,'Invalid run');end if;
    select count(*)into n from apxgen_runs where run_id=p_run and state='RUNNING';if n<>1 then raise_application_error(-20025,'Running run required');end if;
    dbms_scheduler.create_job(job_name=>'APXGEN_'||substr(p_run,1,24),job_type=>'PLSQL_BLOCK',job_action=>'begin apxgen_evolution.tick('''||p_run||'''); end;',start_date=>systimestamp,repeat_interval=>'FREQ=SECONDLY;INTERVAL=10',enabled=>true,auto_drop=>false,comments=>'Genesis generation orchestration; browser evaluation worker still required');
  end;
end apxgen_evolution;
/
