create or replace package apxgen_export authid definer as
  function index_json return clob;
  function generation_json(p_run varchar2,p_generation number) return clob;
end apxgen_export;
/
create or replace package body apxgen_export as
  function seconds_between(p_a timestamp with time zone,p_b timestamp with time zone) return number is d interval day(9) to second(6):=p_b-p_a;
  begin return round(extract(day from d)*86400+extract(hour from d)*3600+extract(minute from d)*60+extract(second from d),6);end;
  function index_json return clob is
    root json_object_t:=json_object_t();runs json_array_t:=json_array_t();j json_object_t;gens json_array_t;x json_object_t;ai json_object_t;n number;unique_n number;cached_n number;version_no varchar2(100);db_version varchar2(100);attempts number;reconciled number;uncertain_n number;input_n number;output_n number;cost_n number;held_n number;
  begin
    apxgen_security.require_role('READER');
    select version_no into version_no from apex_release;select version_full into db_version from product_component_version where rownum=1;
    root.put('schemaVersion','1.0');root.put('kind','recorded-oracle-experiment');root.put('title','APEX Genesis');root.put('databaseVersion',db_version);root.put('apexVersion',version_no);
    root.put('limitations','A constrained synthetic dashboard and declared technical proxies. Five paired offline seeds support descriptive comparisons. No inference about general usability or aesthetic quality. Viewport geometry checks do not constitute complete accessibility certification.');
    root.put('aiDisclosure','Only runs explicitly labeled GA_HAIKU with recorded provider invocations count as AI evidence. Offline GA_ONLY and RANDOM_SEARCH runs use zero paid model requests. Mock-provider tests are excluded.');
    for r in(select * from apxgen_runs where current_generation>=0 and label not like 'TEST%' order by created_at)loop
      select count(*),sum(case when cached_from is null then 1 else 0 end),sum(case when cached_from is not null then 1 else 0 end)into n,unique_n,cached_n from apxgen_organisms o join apxgen_evaluations e on e.organism_id=o.organism_id where o.run_id=r.run_id;
      if n=0 then continue;end if;
      j:=json_object_t();gens:=json_array_t();j.put('id',r.run_id);j.put('label',r.label);j.put('mode',r.population_mode);j.put('state',r.state);j.put('seed',r.seed);j.put('populationSize',r.population_size);j.put('targetGenerations',r.target_generations);j.put('engineVersion',r.engine_version);j.put('environmentHash',r.evaluation_context);j.put('candidateCount',n);j.put('uniqueEvaluations',unique_n);j.put('cachedEvaluations',cached_n);j.put('showcase',r.label like 'SHOWCASE%');
      j.put('mutationRate',r.mutation_rate);j.put('crossoverRate',r.crossover_rate);j.put('eliteCount',r.elite_count);j.put('tournamentSize',r.tournament_size);j.put('createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'));
      j.put('fitnessWeights',json_element_t.parse(r.fitness_weights));j.put('diversityThreshold',r.diversity_threshold);j.put('stagnationLimit',r.stagnation_limit);j.put('generationTimeout',r.generation_timeout);j.put('totalTimeout',r.total_timeout);
      select count(*),nvl(sum(case when state='RECONCILED' then 1 else 0 end),0),nvl(sum(case when state='UNCERTAIN' then 1 else 0 end),0),nvl(sum(input_tokens),0),nvl(sum(output_tokens),0),nvl(sum(actual_usd),0),nvl(sum(case when state in('UNCERTAIN','RESERVED')then reserved_usd else 0 end),0)into attempts,reconciled,uncertain_n,input_n,output_n,cost_n,held_n from apxgen_invocations where run_id=r.run_id;
      ai:=json_object_t();ai.put('attempts',attempts);ai.put('reconciled',reconciled);ai.put('uncertain',uncertain_n);ai.put('inputTokens',input_n);ai.put('outputTokens',output_n);ai.put('usageBasedCostUsd',cost_n);ai.put('uncertainReservedUsd',held_n);ai.put('invoiceVerified',false);j.put('ai',ai);
      if r.ended_at is not null then j.put('elapsedSeconds',seconds_between(r.started_at,r.ended_at));end if;
      for g in(select * from apxgen_generations where run_id=r.run_id and state='COMPLETE' order by generation)loop
        x:=json_object_t();x.put('generation',g.generation);x.put('bestFitness',g.best_fitness);x.put('meanFitness',g.mean_fitness);x.put('medianFitness',g.median_fitness);x.put('varianceFitness',g.variance_fitness);x.put('bestSoFar',g.best_so_far);x.put('diversity',g.diversity);x.put('validCount',g.valid_count);x.put('failedCount',g.failed_count);x.put('mutationCount',g.mutation_count);x.put('mutationAccepted',g.mutation_accepted);x.put('rngBefore',g.rng_before);x.put('rngAfter',g.rng_after);x.put('elapsedSeconds',seconds_between(g.started_at,g.completed_at));x.put('path',r.run_id||'/generation-'||to_char(g.generation,'FM0000')||'.json');gens.append(x);
      end loop;
      if gens.get_size=0 then continue;end if;j.put('generations',gens);runs.append(j);
    end loop;root.put('runs',runs);return root.to_clob;
  end;
  function generation_json(p_run varchar2,p_generation number) return clob is
    root json_object_t:=json_object_t();organisms json_array_t:=json_array_t();j json_object_t;parents json_array_t;obj json_object_t;n number;
  begin
    apxgen_security.require_role('READER');
    select count(*)into n from apxgen_generations where run_id=p_run and generation=p_generation and state='COMPLETE';if n<>1 then raise_application_error(-20061,'Completed generation required');end if;
    root.put('runId',p_run);root.put('generation',p_generation);
    for o in(select o.organism_id,o.generation,o.ordinal,o.fingerprint,o.method,g.canonical_json,e.eligible,e.fitness,e.accessibility,e.hierarchy,e.responsiveness,e.performance_proxy,e.contrast_ratio,e.measurements,e.cached_from from apxgen_organisms o join apxgen_genomes g on g.fingerprint=o.fingerprint join apxgen_evaluations e on e.organism_id=o.organism_id where o.run_id=p_run and o.generation=p_generation order by o.ordinal)loop
      j:=json_object_t();j.put('id',o.organism_id);j.put('generation',o.generation);j.put('ordinal',o.ordinal);j.put('fingerprint',o.fingerprint);j.put('genome',json_element_t.parse(o.canonical_json));j.put('method',o.method);j.put('eligible',o.eligible);j.put('fitness',o.fitness);j.put('measurements',json_element_t.parse(o.measurements));j.put('cachedFrom',o.cached_from);
      parents:=json_array_t();for p in(select parent_id from apxgen_parents where child_id=o.organism_id order by parent_role)loop parents.append(p.parent_id);end loop;j.put('parents',parents);
      obj:=json_object_t();obj.put('accessibility',o.accessibility);obj.put('hierarchy',o.hierarchy);obj.put('responsiveness',o.responsiveness);obj.put('performanceProxy',o.performance_proxy);obj.put('contrastRatio',o.contrast_ratio);j.put('objectives',obj);organisms.append(j);
    end loop;root.put('organisms',organisms);return root.to_clob;
  end;
end apxgen_export;
/
