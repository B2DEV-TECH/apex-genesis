create or replace package apxgen_app_evolution authid definer as
 -- Initial steady-state (one challenger per generation) GA_ONLY protocol.
 function create_run(p_seed number,p_generations number,p_materialization_budget number,p_label varchar2) return varchar2;
 function next_candidate(p_run varchar2) return varchar2;
 procedure record_phase(p_organism varchar2,p_state varchar2,p_artifact_hash varchar2 default null,p_application_id number default null);
 procedure evaluate(p_organism varchar2,p_metrics clob);
 procedure decide(p_organism varchar2);
 procedure reject(p_organism varchar2,p_reason varchar2);
end apxgen_app_evolution;
/
create or replace package body apxgen_app_evolution as
 c_baseline constant varchar2(1000):='{"schemaVersion":"2.0","application":"GENESIS_ORDER_LAB","dataSource":"GENESIS_ORDERS_SAFE_V","tasks":["locateOrder","filterOrders","updateOrder"],"traits":{"report":"classicReport","edit":"page","filters":"above","summary":"before","navigation":"side","density":"comfortable"}}';
 procedure event(p_id varchar2,p_state varchar2,p_detail varchar2 default null) is
 begin insert into apxgen_app_events(organism_id,state,detail) values(p_id,p_state,substr(p_detail,1,240));end;
 function create_run(p_seed number,p_generations number,p_materialization_budget number,p_label varchar2) return varchar2 is
  r varchar2(32):=lower(rawtohex(sys_guid()));o varchar2(32):=lower(rawtohex(sys_guid()));g clob;
 begin
  if p_seed is null or p_seed<>trunc(p_seed) or p_seed not between 1 and 2147483646 or p_generations is null or p_generations<>trunc(p_generations) or p_generations not between 1 and 10 or p_materialization_budget is null or p_materialization_budget<>trunc(p_materialization_budget) or p_materialization_budget not between 1 and 128 or p_label is null or length(p_label)>120 then raise_application_error(-20131,'Invalid bounded application run configuration');end if;
  g:=apxgen_app_genome.canonical(c_baseline);
  insert into apxgen_app_runs(run_id,label,seed,rng_state,max_generations,materialization_budget) values(r,p_label,p_seed,p_seed,p_generations,p_materialization_budget);
  insert into apxgen_app_organisms(organism_id,run_id,generation,genome_json,genome_hash,method) values(o,r,0,g,apxgen_app_genome.fingerprint(g),'BASELINE');
  event(o,'GENOME_CREATED','Baseline; no application imported');return r;
 end;
 function next_candidate(p_run varchar2) return varchar2 is
  r apxgen_app_runs%rowtype;p apxgen_app_organisms%rowtype;g clob;o varchar2(32):=lower(rawtohex(sys_guid()));n number;
 begin
  select * into r from apxgen_app_runs where run_id=p_run for update nowait;
  if r.state<>'RUNNING' then raise_application_error(-20131,'Application run is not running');end if;
  select count(*) into n from apxgen_app_organisms where run_id=p_run and state not in('SELECTED','REJECTED');
  if n<>0 or r.best_organism_id is null then raise_application_error(-20131,'Resolve the current candidate before creating a descendant');end if;
  if r.current_generation>=r.max_generations then update apxgen_app_runs set state='COMPLETE' where run_id=p_run;return null;end if;
  select * into p from apxgen_app_organisms where organism_id=r.best_organism_id and selected=1 and eligible=1;
  g:=apxgen_app_genome.mutate(p.genome_json,r.rng_state);
  insert into apxgen_app_organisms(organism_id,run_id,generation,parent_id,genome_json,genome_hash,method) values(o,p_run,r.current_generation+1,p.organism_id,g,apxgen_app_genome.fingerprint(g),'MUTATION');
  update apxgen_app_runs set current_generation=current_generation+1,rng_state=r.rng_state where run_id=p_run;
  event(o,'GENOME_CREATED','One bounded PL/SQL structural mutation');return o;
 end;
 procedure record_phase(p_organism varchar2,p_state varchar2,p_artifact_hash varchar2 default null,p_application_id number default null) is
  o apxgen_app_organisms%rowtype;r apxgen_app_runs%rowtype;expected varchar2(24);n number;
 begin
  -- Consistent lock order: run, then organism; workers serialize run transitions.
  select * into r from apxgen_app_runs where run_id=(select run_id from apxgen_app_organisms where organism_id=p_organism) for update nowait;
  select * into o from apxgen_app_organisms where organism_id=p_organism for update nowait;
  if r.state<>'RUNNING' then raise_application_error(-20132,'Application run is not running');end if;
  expected:=case o.state when 'GENOME_CREATED' then 'DEFINITION_GENERATED' when 'DEFINITION_GENERATED' then 'VALIDATION_STARTED' when 'VALIDATION_STARTED' then 'VALIDATED' when 'VALIDATED' then 'IMPORT_STARTED' when 'IMPORT_STARTED' then 'IMPORTED' when 'IMPORTED' then 'RUNTIME_VERIFIED' when 'RUNTIME_VERIFIED' then 'TESTING' end;
  if expected is null or p_state is null or p_state<>expected then raise_application_error(-20132,'Application phase cannot be skipped');end if;
  if p_state='DEFINITION_GENERATED' and (p_artifact_hash is null or not regexp_like(p_artifact_hash,'^[a-f0-9]{64}$')) then raise_application_error(-20132,'Definition hash required');end if;
  if p_state='IMPORT_STARTED' then
   if p_application_id is null or p_application_id<1 or p_application_id<>trunc(p_application_id) or p_application_id in(120,121) then raise_application_error(-20132,'A disposable application slot is required');end if;
   select count(*) into n from genesis_order_lab_slots where application_id=p_application_id and owner_run_id=r.run_id and owner_organism_id=o.organism_id and slot_state='ACTIVE' and lease_until>systimestamp;
   if n<>1 then raise_application_error(-20132,'Explicit active slot ownership required');end if;
   if r.materializations>=r.materialization_budget then raise_application_error(-20132,'Application materialization budget exhausted');end if;
   update apxgen_app_runs set materializations=materializations+1 where run_id=r.run_id;
  end if;
  update apxgen_app_organisms set state=p_state,artifact_hash=case when p_state='DEFINITION_GENERATED' then p_artifact_hash else artifact_hash end,application_id=case when p_state='IMPORT_STARTED' then p_application_id else application_id end where organism_id=p_organism;
  event(p_organism,p_state);
 end;
 procedure evaluate(p_organism varchar2,p_metrics clob) is
  o apxgen_app_organisms%rowtype;r apxgen_app_runs%rowtype;v_eligible number;v_fitness number;a number;n number;x number;p number;s number;
 begin
  select * into r from apxgen_app_runs where run_id=(select run_id from apxgen_app_organisms where organism_id=p_organism) for update nowait;
  select * into o from apxgen_app_organisms where organism_id=p_organism for update nowait;
  if r.state<>'RUNNING' or o.state<>'TESTING' then raise_application_error(-20133,'Real functional testing in a running run must precede evaluation');end if;
  apxgen_app_fitness.score(o.genome_json,p_metrics,v_eligible,v_fitness,a,n,x,p,s);
  update apxgen_app_organisms set state='EVALUATED',metrics_json=p_metrics,eligible=v_eligible,fitness=v_fitness where organism_id=p_organism;
  event(p_organism,'EVALUATED','Versioned Oracle task-based engineering proxy');
 end;
 procedure decide(p_organism varchar2) is
  r apxgen_app_runs%rowtype;o apxgen_app_organisms%rowtype;best number:=null;survives number:=0;
 begin
  select * into r from apxgen_app_runs where run_id=(select run_id from apxgen_app_organisms where organism_id=p_organism) for update nowait;
  select * into o from apxgen_app_organisms where organism_id=p_organism for update nowait;
  if r.state<>'RUNNING' or o.state<>'EVALUATED' then raise_application_error(-20133,'An evaluated candidate in a running run is required');end if;
  if r.best_organism_id is not null then select fitness into best from apxgen_app_organisms where organism_id=r.best_organism_id;end if;
  if o.eligible=1 and (best is null or o.fitness>best) then survives:=1;end if;
  update apxgen_app_organisms set selected=survives,state=case survives when 1 then 'SELECTED' else 'REJECTED' end,reason=case survives when 1 then 'Eligible improvement selected by Oracle' else 'Failed eligibility or did not exceed the surviving parent' end where organism_id=p_organism;
  if survives=1 then update apxgen_app_runs set best_organism_id=p_organism where run_id=r.run_id;end if;
  if o.generation=0 and survives=0 then update apxgen_app_runs set state='FAILED' where run_id=r.run_id;
  elsif o.generation>=r.max_generations then update apxgen_app_runs set state='COMPLETE' where run_id=r.run_id;end if;
  event(p_organism,case survives when 1 then 'SELECTED' else 'REJECTED' end);
 end;
 procedure reject(p_organism varchar2,p_reason varchar2) is
  o apxgen_app_organisms%rowtype;r apxgen_app_runs%rowtype;
 begin
  select * into r from apxgen_app_runs where run_id=(select run_id from apxgen_app_organisms where organism_id=p_organism) for update nowait;
  select * into o from apxgen_app_organisms where organism_id=p_organism for update nowait;
  if r.state<>'RUNNING' or o.state in('SELECTED','REJECTED','EVALUATED') or p_reason is null then raise_application_error(-20133,'A pending candidate and rejection reason are required');end if;
  update apxgen_app_organisms set state='REJECTED',eligible=0,fitness=0,reason=substr(p_reason,1,240) where organism_id=p_organism;
  if o.generation=0 then update apxgen_app_runs set state='FAILED' where run_id=r.run_id;
  elsif o.generation>=r.max_generations then update apxgen_app_runs set state='COMPLETE' where run_id=r.run_id;end if;
  event(p_organism,'REJECTED',p_reason);
 end;
end apxgen_app_evolution;
/
