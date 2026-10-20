create or replace package apxgen_budget authid definer as
  function reserve(p_run varchar2,p_generation number,p_organism number) return varchar2;
  procedure reconcile(p_id varchar2,p_input number,p_output number);
  procedure uncertain(p_id varchar2,p_error varchar2);
  procedure stop_ai(p_run varchar2);
  procedure recover_stale;
end apxgen_budget;
/
create or replace package body apxgen_budget as
  function reserve(p_run varchar2,p_generation number,p_organism number) return varchar2 is
    pragma autonomous_transaction;
    c apxgen_provider_config%rowtype;b apxgen_run_budgets%rowtype;cost number;spent number;daily number;lifetime number;n number;id varchar2(32):=lower(rawtohex(sys_guid()));population_mode varchar2(20);state varchar2(24);
  begin
    select * into c from apxgen_provider_config where singleton=1 for update;
    select * into b from apxgen_run_budgets where run_id=p_run for update;
    select population_mode,state into population_mode,state from apxgen_runs where run_id=p_run;
    if c.enabled<>1 or b.enabled<>1 or b.stopped=1 or population_mode<>'GA_HAIKU' or state<>'RUNNING' then raise_application_error(-20040,'AI disabled or stopped');end if;
    if c.model_verified_at is null or c.model_verified_at<systimestamp-interval '1' day or c.pricing_reviewed_at is null or c.pricing_reviewed_at<systimestamp-interval '1' day or c.verified_model_id is null or c.credential_static_id is null or c.input_usd_per_million is null or c.output_usd_per_million is null or c.input_usd_per_million<=0 or c.output_usd_per_million<=0 then raise_application_error(-20041,'Fresh model verification and reviewed prices required');end if;
    if c.max_input_tokens not between 1 and 8192 or c.max_output_tokens not between 1 and 1024 or c.max_requests_per_run not between 1 and 100 or c.request_interval<1 or c.daily_limit_usd<=0 then raise_application_error(-20041,'Unsafe provider limits');end if;
    select count(*)into n from apxgen_organisms where organism_id=p_organism and run_id=p_run and generation=p_generation and evaluation_state='COMPLETE';if n<>1 then raise_application_error(-20041,'Evaluated parent required');end if;
    select count(*)into n from apxgen_invocations where state='RESERVED';if n>=c.max_concurrency then raise_application_error(-20042,'AI concurrency limit');end if;
    select count(*),nvl(sum(nvl(actual_usd,reserved_usd)),0)into n,spent from apxgen_invocations where run_id=p_run;
    if n>=c.max_requests_per_run then raise_application_error(-20043,'AI request count limit');end if;
    select count(*)into n from apxgen_invocations where run_id=p_run and generation=p_generation;if n>=1 then raise_application_error(-20043,'One AI request per generation');end if;
    select nvl(sum(nvl(actual_usd,reserved_usd)),0)into daily from apxgen_invocations where created_at>=trunc(systimestamp at time zone 'UTC');
    select nvl(sum(nvl(actual_usd,reserved_usd)),0)into lifetime from apxgen_invocations;
    cost:=(c.max_input_tokens*c.input_usd_per_million+c.max_output_tokens*c.output_usd_per_million)/1000000;
    if spent+cost>b.limit_usd or daily+cost>c.daily_limit_usd or lifetime+cost>c.total_limit_usd then
      update apxgen_run_budgets set stopped=1 where run_id=p_run;commit;raise_application_error(-20044,'Budget exhausted; explicit owner reset required');
    end if;
    insert into apxgen_invocations(invocation_id,run_id,generation,organism_id,state,reserved_usd,input_rate,output_rate,max_input_tokens,max_output_tokens,model_id)values(id,p_run,p_generation,p_organism,'RESERVED',cost,c.input_usd_per_million,c.output_usd_per_million,c.max_input_tokens,c.max_output_tokens,c.verified_model_id);
    commit;return id;
  exception when others then rollback;raise;
  end;
  procedure reconcile(p_id varchar2,p_input number,p_output number) is
    pragma autonomous_transaction;c apxgen_provider_config%rowtype;i apxgen_invocations%rowtype;cost number;
  begin
    select * into c from apxgen_provider_config where singleton=1 for update;
    select * into i from apxgen_invocations where invocation_id=p_id for update;
    if i.state<>'RESERVED' then raise_application_error(-20045,'Reservation already finalized');end if;
    if p_input is null or p_output is null or p_input<0 or p_output<0 or p_input<>trunc(p_input) or p_output<>trunc(p_output) then raise_application_error(-20045,'Invalid usage; retain reservation');end if;
    cost:=(p_input*i.input_rate+p_output*i.output_rate)/1000000;
    update apxgen_invocations set state='RECONCILED',input_tokens=p_input,output_tokens=p_output,actual_usd=cost,completed_at=systimestamp where invocation_id=p_id;
    if p_input>i.max_input_tokens or p_output>i.max_output_tokens or cost>i.reserved_usd then update apxgen_run_budgets set stopped=1 where run_id=i.run_id;end if;
    commit;
  exception when others then rollback;raise;end;
  procedure uncertain(p_id varchar2,p_error varchar2) is pragma autonomous_transaction;n number;
  begin
    select singleton into n from apxgen_provider_config where singleton=1 for update;
    update apxgen_invocations set state='UNCERTAIN',error_code=substr(p_error,1,80),completed_at=systimestamp where invocation_id=p_id and state='RESERVED';
    update apxgen_run_budgets set stopped=1 where run_id=(select run_id from apxgen_invocations where invocation_id=p_id) and exists(select 1 from apxgen_invocations where invocation_id=p_id and state='UNCERTAIN');
    commit;
  exception when others then rollback;raise;end;
  procedure stop_ai(p_run varchar2) is pragma autonomous_transaction;
  begin update apxgen_run_budgets set stopped=1 where run_id=p_run;commit;end;
  procedure recover_stale is pragma autonomous_transaction;n number;
  begin
    select singleton into n from apxgen_provider_config where singleton=1 for update;
    for i in(select invocation_id,run_id from apxgen_invocations where state='RESERVED' and created_at<systimestamp-interval '120' second for update)loop
      update apxgen_invocations set state='UNCERTAIN',error_code='STALE_RESERVATION',completed_at=systimestamp where invocation_id=i.invocation_id;
      update apxgen_run_budgets set stopped=1 where run_id=i.run_id;
    end loop;
    for i in(select invocation_id,run_id from apxgen_invocations where state='RECONCILED' and proposal is null and error_code is null and created_at<systimestamp-interval '120' second for update)loop
      update apxgen_invocations set error_code='STALE_RESPONSE',completed_at=systimestamp where invocation_id=i.invocation_id;
      update apxgen_run_budgets set stopped=1 where run_id=i.run_id;
    end loop;commit;
  exception when others then rollback;raise;end;
end apxgen_budget;
/
