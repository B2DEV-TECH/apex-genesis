create or replace package apxgen_genome authid definer as
  type genes is table of pls_integer index by pls_integer;
  function next_random(p_state in out number,p_limit pls_integer) return pls_integer;
  function random_genes(p_state in out number) return genes;
  function limits(p_gene pls_integer) return pls_integer;
  function from_genes(p_genes genes) return clob;
  function to_genes(p_json clob) return genes;
  function canonical(p_json clob) return clob;
  function fingerprint(p_json clob) return varchar2;
  function persist(p_genes genes) return varchar2;
  procedure validate(p_json clob);
end apxgen_genome;
/
create or replace package body apxgen_genome as
  function limits(p_gene pls_integer) return pls_integer is
  begin return case p_gene when 1 then 4 when 2 then 2 when 3 then 24 when 4 then 2 when 5 then 2 when 6 then 4 when 7 then 5 when 8 then 6 when 9 then 6 when 10 then 2 when 11 then 2 else 0 end; end;
  function next_random(p_state in out number,p_limit pls_integer) return pls_integer is
  begin
    if p_limit<1 or p_state<1 or p_state>=2147483647 or p_state<>trunc(p_state) then raise_application_error(-20002,'Invalid RNG input');end if;
    p_state:=mod(p_state*16807,2147483647);return floor((p_state-1)/2147483646*p_limit);
  end;
  function random_genes(p_state in out number) return genes is g genes;
  begin for i in 1..11 loop g(i):=next_random(p_state,limits(i));end loop;return g;end;
  function order_array(p_index pls_integer) return json_array_t is
    items sys.odcivarchar2list:=sys.odcivarchar2list('metrics','filters','revenue','orders');
    a json_array_t:=json_array_t();idx pls_integer:=p_index;k pls_integer;f pls_integer;
  begin
    for n in reverse 1..4 loop
      f:=case n when 4 then 6 when 3 then 2 else 1 end;k:=floor(idx/f)+1;idx:=mod(idx,f);
      a.append(items(k));for j in k..n-1 loop items(j):=items(j+1);end loop;
    end loop;return a;
  end;
  function from_genes(p_genes genes) return clob is
    o json_object_t:=json_object_t();l json_object_t:=json_object_t();s json_object_t:=json_object_t();b json_object_t:=json_object_t();
  begin
    if p_genes.count<>11 then raise_application_error(-20003,'Eleven genes required');end if;
    for i in 1..11 loop if not p_genes.exists(i) or p_genes(i) is null or p_genes(i)<0 or p_genes(i)>=limits(i) then raise_application_error(-20003,'Gene outside bounds');end if;end loop;
    o.put('schemaVersion','1.0');l.put('columns',p_genes(1)+1);l.put('navigation',case p_genes(2) when 0 then 'top' else 'left' end);l.put('order',order_array(p_genes(3)));
    l.put('chart',case p_genes(4) when 0 then 'bars' else 'line' end);l.put('table',case p_genes(5) when 0 then 'table' else 'cards' end);
    s.put('palette',p_genes(6));s.put('fontSize',12+p_genes(7)*2);s.put('spacing',4+p_genes(8)*4);s.put('radius',p_genes(9)*4);
    b.put('collapseDetails',p_genes(10)=1);b.put('sort',case p_genes(11) when 0 then 'name' else 'value' end);
    o.put('layout',l);o.put('style',s);o.put('behavior',b);return o.to_clob;
  end;
  function to_genes(p_json clob) return genes is
    o json_object_t;l json_object_t;s json_object_t;b json_object_t;g genes;a json_array_t;ord pls_integer:=-1;
  begin
    o:=json_object_t.parse(p_json);o.on_error(1);
    if o.get_size<>4 or o.get_string('schemaVersion')<>'1.0' then raise_application_error(-20004,'Invalid envelope');end if;
    l:=o.get_object('layout');s:=o.get_object('style');b:=o.get_object('behavior');l.on_error(1);s.on_error(1);b.on_error(1);
    if l.get_size<>5 or s.get_size<>4 or b.get_size<>2 then raise_application_error(-20004,'Unknown properties');end if;
    a:=l.get_array('order');for i in 0..23 loop if a.to_string=order_array(i).to_string then ord:=i;exit;end if;end loop;
    g(1):=l.get_number('columns')-1;g(2):=case l.get_string('navigation') when 'top' then 0 when 'left' then 1 else -1 end;g(3):=ord;
    g(4):=case l.get_string('chart') when 'bars' then 0 when 'line' then 1 else -1 end;g(5):=case l.get_string('table') when 'table' then 0 when 'cards' then 1 else -1 end;
    g(6):=s.get_number('palette');g(7):=(s.get_number('fontSize')-12)/2;g(8):=(s.get_number('spacing')-4)/4;g(9):=s.get_number('radius')/4;
    g(10):=case when b.get_boolean('collapseDetails') then 1 else 0 end;g(11):=case b.get_string('sort') when 'name' then 0 when 'value' then 1 else -1 end;
    -- Reconstructing catches fractional numbers, coercions, unknown keys and types.
    declare c clob:=from_genes(g);matches number;begin
      select case when p_json is json strict with unique keys and json_equal(p_json,c) then 1 else 0 end into matches from dual;
      if matches<>1 then raise_application_error(-20004,'Genome is not in grammar');end if;
    end;
    return g;
  exception when others then raise_application_error(-20004,'Genome rejected by strict grammar');
  end;
  procedure validate(p_json clob) is g genes;begin g:=to_genes(p_json);end;
  function canonical(p_json clob) return clob is begin return from_genes(to_genes(p_json));end;
  function fingerprint(p_json clob) return varchar2 is c clob:=canonical(p_json);
  begin return lower(rawtohex(dbms_crypto.hash(utl_i18n.string_to_raw(dbms_lob.substr(c,32767,1),'AL32UTF8'),dbms_crypto.hash_sh256)));end;
  function persist(p_genes genes) return varchar2 is c clob:=from_genes(p_genes);h varchar2(64);a json_array_t:=json_array_t();serialized varchar2(300);
  begin h:=fingerprint(c);for i in 1..11 loop a.append(p_genes(i));end loop;
    serialized:=a.to_string;
    begin insert into apxgen_genomes(fingerprint,canonical_json,genes_json) values(h,c,serialized);exception when dup_val_on_index then null;end;
    return h;
  end;
end apxgen_genome;
/
