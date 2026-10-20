create or replace package apxgen_ai authid definer as
  procedure verify_model;
  function message_request(p_model varchar2,p_parent clob,p_max_output number default null) return clob;
  function apply_proposal(p_parent clob,p_proposal clob) return clob;
  procedure accept_response(p_invocation varchar2,p_response clob);
  procedure propose(p_run varchar2,p_parent number);
end apxgen_ai;
/
create or replace package body apxgen_ai as
  c_url constant varchar2(100):='https://api.anthropic.com';
  procedure context is
    n number;
  begin
    select workspace_id into n from apex_workspace_schemas where schema=user and rownum=1;
    apex_util.set_security_group_id(n);
  end;
  procedure headers is
  begin apex_web_service.g_request_headers.delete;apex_web_service.g_request_headers(1).name:='anthropic-version';apex_web_service.g_request_headers(1).value:='2023-06-01';apex_web_service.g_request_headers(2).name:='content-type';apex_web_service.g_request_headers(2).value:='application/json';end;
  procedure verify_model is c apxgen_provider_config%rowtype;response clob;o json_object_t;id varchar2(128);
  begin
    select * into c from apxgen_provider_config where singleton=1;
    if c.enabled<>1 or c.credential_static_id is null or not regexp_like(c.model_id,'^[a-zA-Z0-9.-]{1,128}$')then raise_application_error(-20050,'Owner configuration required');end if;
    context;headers;response:=apex_web_service.make_rest_request(p_url=>c_url||'/v1/models/'||c.model_id,p_http_method=>'GET',p_transfer_timeout=>20,p_credential_static_id=>c.credential_static_id);
    if apex_web_service.g_status_code<>200 then raise_application_error(-20051,'Model lookup failed');end if;
    o:=json_object_t.parse(response);id:=o.get_string('id');if id is null then raise_application_error(-20051,'Model lookup missing ID');end if;
    if not o.get_object('capabilities').get_object('thinking').get_object('types').get_object('disabled').get_boolean('supported') then raise_application_error(-20051,'This adapter requires verified support for disabling thinking');end if;
    update apxgen_provider_config set verified_model_id=id,model_verified_at=systimestamp where singleton=1;commit;
  end;
  function message_request(p_model varchar2,p_parent clob,p_max_output number default null) return clob is
    req json_object_t:=json_object_t();messages json_array_t:=json_array_t();msg json_object_t:=json_object_t();prompt clob;
  begin
    apxgen_genome.validate(p_parent);
    prompt:='Propose one to three constrained mutations. Return only {"operations":[{"gene":"columns","value":2}]}. Allowed: columns integer 1..4; navigation top|left; order a permutation of metrics,filters,revenue,orders; chart bars|line; table table|cards; palette 0..3; fontSize 12,14,16,18,20; spacing 4,8,12,16,20,24; radius 0,4,8,12,16,20; collapseDetails boolean; sort name|value. Preserve all data. No code, markup, URLs or explanations. Optimize potential readability, hierarchy and responsive composition. Parent: '||p_parent;
    req.put('model',p_model);req.put('thinking',json_object_t('{"type":"disabled"}'));
    msg.put('role','user');msg.put('content',prompt);messages.append(msg);req.put('messages',messages);
    if p_max_output is not null then req.put('max_tokens',p_max_output);end if;
    return req.to_clob;
  end;
  function apply_proposal(p_parent clob,p_proposal clob) return clob is
    parent json_object_t;proposal json_object_t;ops json_array_t;op json_object_t;k varchar2(80);target json_object_t;result clob;seen varchar2(500):=':';strict_json number;
  begin
    select case when p_proposal is json strict with unique keys then 1 else 0 end into strict_json from dual;
    if strict_json<>1 then raise_application_error(-20052,'Strict unique-key mutation JSON required');end if;
    parent:=json_object_t.parse(apxgen_genome.canonical(p_parent));proposal:=json_object_t.parse(p_proposal);
    if proposal.get_size<>1 or not proposal.has('operations')then raise_application_error(-20052,'Only operations allowed');end if;
    ops:=proposal.get_array('operations');if ops.get_size<1 or ops.get_size>3 then raise_application_error(-20052,'One to three mutations required');end if;
    for i in 0..ops.get_size-1 loop op:=treat(ops.get(i) as json_object_t);if op.get_size<>2 or not op.has('gene') or not op.has('value')then raise_application_error(-20052,'Invalid mutation operation');end if;
      k:=op.get_string('gene');if instr(seen,':'||k||':')>0 then raise_application_error(-20052,'Repeated mutation');end if;seen:=seen||k||':';
      if k in('columns','navigation','order','chart','table')then target:=parent.get_object('layout');elsif k in('palette','fontSize','spacing','radius')then target:=parent.get_object('style');elsif k in('collapseDetails','sort')then target:=parent.get_object('behavior');else raise_application_error(-20052,'Unsupported mutation gene');end if;
      target.put(k,op.get('value'));
      if k in('columns','navigation','order','chart','table')then parent.put('layout',target);elsif k in('palette','fontSize','spacing','radius')then parent.put('style',target);else parent.put('behavior',target);end if;
    end loop;
    result:=parent.to_clob;apxgen_genome.validate(result);return apxgen_genome.canonical(result);
  end;
  procedure accept_response(p_invocation varchar2,p_response clob) is
    r json_object_t;u json_object_t;content json_array_t;block json_object_t;v_proposal clob;parent clob;child clob;i apxgen_invocations%rowtype;inputn number;outputn number;
  begin
    r:=json_object_t.parse(p_response);
    select * into i from apxgen_invocations where invocation_id=p_invocation;
    if i.state<>'RESERVED' then raise_application_error(-20053,'Unreserved response');end if;
    if nvl(r.get_string('model'),'MISSING')<>i.model_id then raise_application_error(-20053,'Unexpected response model');end if;
    u:=r.get_object('usage');inputn:=u.get_number('input_tokens');outputn:=u.get_number('output_tokens');
    if nvl(u.get_number('cache_creation_input_tokens'),0)<>0 or nvl(u.get_number('cache_read_input_tokens'),0)<>0 then raise_application_error(-20053,'Unexpected cached usage');end if;
    apxgen_budget.reconcile(p_invocation,inputn,outputn);
    if nvl(r.get_string('stop_reason'),'MISSING')<>'end_turn' then
      update apxgen_invocations set error_code=case r.get_string('stop_reason') when 'max_tokens' then 'OUTPUT_TRUNCATED' else 'UNSUPPORTED_STOP' end where invocation_id=p_invocation;commit;
      raise_application_error(-20053,'Truncated or unsupported stop reason');end if;
    content:=r.get_array('content');if content.get_size<>1 then raise_application_error(-20053,'Expected one text block');end if;
    block:=treat(content.get(0)as json_object_t);if block.get_string('type')<>'text' then raise_application_error(-20053,'Text mutation expected');end if;v_proposal:=block.get_clob('text');
    select g.canonical_json into parent from apxgen_organisms o join apxgen_genomes g on g.fingerprint=o.fingerprint where o.organism_id=i.organism_id;child:=apply_proposal(parent,v_proposal);
    update apxgen_invocations set proposal=v_proposal where invocation_id=p_invocation;commit;
  exception when others then
    update apxgen_invocations set error_code=nvl(error_code,'RESPONSE_REJECTED') where invocation_id=p_invocation;commit;
    apxgen_budget.uncertain(p_invocation,'RESPONSE_REJECTED');raise;
  end;
  procedure propose(p_run varchar2,p_parent number) is
    c apxgen_provider_config%rowtype;g clob;gen number;id varchar2(32);response clob;req clob;count_response json_object_t;tokens number;
  begin
    select * into c from apxgen_provider_config where singleton=1;
    select o.generation,x.canonical_json into gen,g from apxgen_organisms o join apxgen_genomes x on x.fingerprint=o.fingerprint where o.organism_id=p_parent and o.run_id=p_run;
    -- Reserve before either external operation. No lock is held during HTTP.
    id:=apxgen_budget.reserve(p_run,gen,p_parent);
    -- Use exactly the model and token limits covered by this committed reservation,
    -- even if an owner edits provider settings concurrently after our first read.
    select model_id,max_input_tokens,max_output_tokens into c.verified_model_id,c.max_input_tokens,c.max_output_tokens from apxgen_invocations where invocation_id=id;
    req:=message_request(c.verified_model_id,g);
    context;headers;
    response:=apex_web_service.make_rest_request(p_url=>c_url||'/v1/messages/count_tokens',p_http_method=>'POST',p_body=>req,p_transfer_timeout=>20,p_credential_static_id=>c.credential_static_id);
    if apex_web_service.g_status_code<>200 then raise_application_error(-20054,'Token count failed');end if;
    count_response:=json_object_t.parse(response);tokens:=count_response.get_number('input_tokens');if tokens is null or tokens>c.max_input_tokens then raise_application_error(-20054,'Input token limit');end if;
    select stopped into tokens from apxgen_run_budgets where run_id=p_run;if tokens=1 then raise_application_error(-20054,'AI stop requested');end if;
    req:=message_request(c.verified_model_id,g,c.max_output_tokens);
    response:=apex_web_service.make_rest_request(p_url=>c_url||'/v1/messages',p_http_method=>'POST',p_body=>req,p_transfer_timeout=>30,p_credential_static_id=>c.credential_static_id);
    if apex_web_service.g_status_code<>200 then raise_application_error(-20055,'HTTP_'||apex_web_service.g_status_code);end if;
    accept_response(id,response);
  exception when others then if id is not null then apxgen_budget.uncertain(id,'PROVIDER_FAILURE');end if;raise;end;
end apxgen_ai;
/
