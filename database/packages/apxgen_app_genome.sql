create or replace package apxgen_app_genome authid definer as
  -- Additive application grammar. The dashboard packages stay intact.
  c_schema_version constant varchar2(10):='2.0';
  procedure validate(p_genome clob);
  function canonical(p_genome clob) return clob;
  function fingerprint(p_genome clob) return varchar2;
  function random_genome(p_state in out number) return clob;
  function mutate(p_parent clob,p_state in out number) return clob;
  function crossover(p_a clob,p_b clob,p_state in out number) return clob;
  function apply_proposal(p_parent clob,p_proposal clob) return clob;
end apxgen_app_genome;
/
create or replace package body apxgen_app_genome as
  type alleles is table of pls_integer index by pls_integer;

  function trait_name(p_index pls_integer) return varchar2 is
  begin
    return case p_index when 1 then 'report' when 2 then 'edit' when 3 then 'filters'
      when 4 then 'summary' when 5 then 'navigation' when 6 then 'density' end;
  end;

  function trait_value(p_index pls_integer,p_allele pls_integer) return varchar2 is
  begin
    if p_allele is null or p_allele not in(0,1) then
      raise_application_error(-20110,'Application trait is outside the grammar');
    end if;
    return case p_index
      when 1 then case p_allele when 0 then 'classicReport' else 'interactiveReport' end
      when 2 then case p_allele when 0 then 'page' else 'modal' end
      when 3 then case p_allele when 0 then 'above' else 'beside' end
      when 4 then case p_allele when 0 then 'before' else 'after' end
      when 5 then case p_allele when 0 then 'side' else 'top' end
      when 6 then case p_allele when 0 then 'comfortable' else 'compact' end end;
  end;

  function required_text(p_object json_object_t,p_key varchar2) return varchar2 is
    v json_element_t;txt varchar2(32767);
  begin
    if not p_object.has(p_key) then raise_application_error(-20110,'Missing application property');end if;
    v:=p_object.get(p_key);
    if v is null or not v.is_string then raise_application_error(-20110,'Application strings must not be coerced');end if;
    txt:=p_object.get_string(p_key);
    if txt is null then raise_application_error(-20110,'Empty application strings are rejected');end if;
    return txt;
  end;

  function from_alleles(p_values alleles) return clob is
    v_text varchar2(2000):='{"schemaVersion":"2.0","application":"GENESIS_ORDER_LAB","dataSource":"GENESIS_ORDERS_SAFE_V","tasks":["locateOrder","filterOrders","updateOrder"],"traits":{';
  begin
    if p_values.count<>6 then raise_application_error(-20110,'Six application traits required');end if;
    for i in 1..6 loop
      if not p_values.exists(i) then raise_application_error(-20110,'Missing application trait');end if;
      if i>1 then v_text:=v_text||',';end if;
      -- Every interpolated value is a fixed allele, never user-authored text.
      v_text:=v_text||'"'||trait_name(i)||'":"'||trait_value(i,p_values(i))||'"';
    end loop;
    return to_clob(v_text||'}}');
  end;

  function to_alleles(p_genome clob) return alleles is
    o json_object_t;t json_object_t;tasks json_array_t;v json_element_t;
    g alleles;txt varchar2(32767);strict_json number;equivalent number;c clob;
  begin
    if p_genome is null or dbms_lob.getlength(p_genome)>4096 then
      raise_application_error(-20110,'Application genome is absent or too large');
    end if;
    select case when p_genome is json strict with unique keys then 1 else 0 end into strict_json from dual;
    if strict_json<>1 then raise_application_error(-20110,'Strict unique-key application JSON required');end if;
    o:=json_object_t.parse(p_genome);o.on_error(1);
    if o.get_size<>5 or required_text(o,'schemaVersion')<>'2.0'
      or required_text(o,'application')<>'GENESIS_ORDER_LAB'
      or required_text(o,'dataSource')<>'GENESIS_ORDERS_SAFE_V' then
      raise_application_error(-20110,'Application envelope rejected');
    end if;
    tasks:=o.get_array('tasks');tasks.on_error(1);
    if tasks.get_size<>3 then raise_application_error(-20110,'Three fixed Order Lab tasks required');end if;
    for i in 0..2 loop
      v:=tasks.get(i);
      if v is null or not v.is_string then raise_application_error(-20110,'Task names must be strings');end if;
      txt:=tasks.get_string(i);
      if txt<>case i when 0 then 'locateOrder' when 1 then 'filterOrders' else 'updateOrder' end then
        raise_application_error(-20110,'Order Lab tasks cannot change');
      end if;
    end loop;
    t:=o.get_object('traits');t.on_error(1);
    if t.get_size<>6 then raise_application_error(-20110,'Unknown application traits');end if;
    for i in 1..6 loop
      txt:=required_text(t,trait_name(i));
      if txt=trait_value(i,0) then g(i):=0;
      elsif txt=trait_value(i,1) then g(i):=1;
      else raise_application_error(-20110,'Application trait value rejected');end if;
    end loop;
    c:=from_alleles(g);
    select case when json_equal(p_genome,c) then 1 else 0 end into equivalent from dual;
    if equivalent<>1 then raise_application_error(-20110,'Application genome does not match its grammar');end if;
    return g;
  exception when others then
    raise_application_error(-20110,'Application genome rejected by strict grammar');
  end;

  procedure validate(p_genome clob) is g alleles;
  begin g:=to_alleles(p_genome);end;

  function canonical(p_genome clob) return clob is
  begin return from_alleles(to_alleles(p_genome));end;

  function fingerprint(p_genome clob) return varchar2 is c clob:=canonical(p_genome);
  begin
    return lower(rawtohex(dbms_crypto.hash(
      utl_i18n.string_to_raw(dbms_lob.substr(c,32767,1),'AL32UTF8'),dbms_crypto.hash_sh256)));
  end;

  procedure validate_seed(p_state number) is
  begin
    if p_state is null or p_state<>trunc(p_state) or p_state not between 1 and 2147483646 then
      raise_application_error(-20110,'Invalid application RNG state');
    end if;
  end;

  function next_random(p_state in out number,p_limit pls_integer) return pls_integer is
  begin
    -- Same Park-Miller arithmetic as genome 1.x, without its table dependencies.
    -- A standalone sandbox must never install a second historical AI ledger.
    validate_seed(p_state);
    if p_limit is null or p_limit<1 then raise_application_error(-20110,'Invalid application RNG limit');end if;
    p_state:=mod(p_state*16807,2147483647);
    return floor((p_state-1)/2147483646*p_limit);
  end;

  function random_genome(p_state in out number) return clob is g alleles;
  begin
    validate_seed(p_state);
    for i in 1..6 loop g(i):=next_random(p_state,2);end loop;
    return from_alleles(g);
  end;

  function mutate(p_parent clob,p_state in out number) return clob is
    g alleles:=to_alleles(p_parent);idx pls_integer;
  begin
    validate_seed(p_state);idx:=next_random(p_state,6)+1;
    g(idx):=1-g(idx);return from_alleles(g);
  end;

  function crossover(p_a clob,p_b clob,p_state in out number) return clob is
    a alleles:=to_alleles(p_a);b alleles:=to_alleles(p_b);g alleles;
  begin
    validate_seed(p_state);
    for i in 1..6 loop
      if next_random(p_state,2)=0 then g(i):=a(i);else g(i):=b(i);end if;
    end loop;
    return from_alleles(g);
  end;

  function apply_proposal(p_parent clob,p_proposal clob) return clob is
    g alleles:=to_alleles(p_parent);o json_object_t;ops json_array_t;op json_object_t;
    key_name varchar2(32767);value_name varchar2(32767);idx pls_integer;strict_json number;
    seen alleles;
  begin
    if p_proposal is null or dbms_lob.getlength(p_proposal)>2048 then
      raise_application_error(-20111,'Application proposal is absent or too large');
    end if;
    select case when p_proposal is json strict with unique keys then 1 else 0 end into strict_json from dual;
    if strict_json<>1 then raise_application_error(-20111,'Strict unique-key proposal JSON required');end if;
    o:=json_object_t.parse(p_proposal);o.on_error(1);
    if o.get_size<>1 or not o.has('operations') then raise_application_error(-20111,'Only operations are accepted');end if;
    ops:=o.get_array('operations');ops.on_error(1);
    if ops.get_size not between 1 and 3 then raise_application_error(-20111,'One to three operations required');end if;
    for i in 0..ops.get_size-1 loop
      op:=treat(ops.get(i) as json_object_t);op.on_error(1);
      if op.get_size<>2 then raise_application_error(-20111,'Unknown proposal properties');end if;
      key_name:=required_text(op,'trait');value_name:=required_text(op,'value');idx:=0;
      for j in 1..6 loop if key_name=trait_name(j) then idx:=j;exit;end if;end loop;
      if idx=0 or seen.exists(idx) then raise_application_error(-20111,'Unknown or repeated proposal trait');end if;
      seen(idx):=1;
      if value_name=trait_value(idx,0) then g(idx):=0;
      elsif value_name=trait_value(idx,1) then g(idx):=1;
      else raise_application_error(-20111,'Proposal value is outside the grammar');end if;
    end loop;
    return from_alleles(g);
  exception when others then
    raise_application_error(-20111,'Application proposal rejected by strict grammar');
  end;
end apxgen_app_genome;
/
