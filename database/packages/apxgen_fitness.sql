create or replace package apxgen_fitness authid definer as
  function contrast(p_hex1 varchar2,p_hex2 varchar2) return number;
  procedure score(p_genome clob,p_metrics clob,p_eligible out number,p_fitness out number,p_access out number,p_hierarchy out number,p_responsive out number,p_performance out number,p_contrast out number);
end apxgen_fitness;
/
create or replace package body apxgen_fitness as
  function luminance(p_hex varchar2) return number is n number;v number;total number:=0;
  begin
    for i in 0..2 loop n:=to_number(substr(p_hex,2+i*2,2),'XX')/255;
      if n<=.04045 then v:=n/12.92;else v:=power((n+.055)/1.055,2.4);end if;
      total:=total+v*case i when 0 then .2126 when 1 then .7152 else .0722 end;
    end loop;return total;
  end;
  function contrast(p_hex1 varchar2,p_hex2 varchar2) return number is a number:=luminance(p_hex1);b number:=luminance(p_hex2);
  begin return (greatest(a,b)+.05)/(least(a,b)+.05);end;
  procedure score(p_genome clob,p_metrics clob,p_eligible out number,p_fitness out number,p_access out number,p_hierarchy out number,p_responsive out number,p_performance out number,p_contrast out number) is
    g apxgen_genome.genes:=apxgen_genome.to_genes(p_genome);m json_object_t:=json_object_t.parse(p_metrics);o json_object_t:=json_object_t.parse(p_genome);a json_array_t:=o.get_object('layout').get_array('order');
    bg varchar2(7);surface varchar2(7);txt varchar2(7);accent varchar2(7);metrics_pos number;filters_pos number;hard number;nodes number;
    function metric(k varchar2) return number is v number;
    begin if not m.has(k) or not m.get(k).is_number then raise_application_error(-20012,'Missing numeric browser metric');end if;v:=m.get_number(k);if v<0 then raise_application_error(-20012,'Negative browser metric');end if;return v;end;
  begin
    case g(6)
      when 0 then bg:='#10151c';surface:='#1b2430';txt:='#f4f4f5';accent:='#f5a640';
      when 1 then bg:='#f4f1eb';surface:='#ffffff';txt:='#20252d';accent:='#754200';
      when 2 then bg:='#101b19';surface:='#1a2a25';txt:='#e7f5ed';accent:='#78e1b0';
      else bg:='#343840';surface:='#424650';txt:='#797d85';accent:='#999999';
    end case;
    p_contrast:=least(contrast(txt,bg),contrast(txt,surface),contrast(accent,bg),contrast(bg,accent));
    nodes:=metric('domNodes');
    if nodes<1 or metric('viewportsTested')<>3 or metric('focusVisible')<>1 then hard:=1;else hard:=0;end if;
    hard:=hard+metric('overflow')+metric('overlap')+metric('missing')+metric('unnamed')+metric('clipped')+metric('axeCritical')+metric('errors');
    p_eligible:=case when p_contrast>=4.5 and g(7)>=1 and hard=0 then 1 else 0 end;
    p_access:=least(100,60+least(20,(p_contrast-4.5)*4)+least(20,g(7)*5));
    for i in 0..3 loop if a.get_string(i)='metrics' then metrics_pos:=i;elsif a.get_string(i)='filters' then filters_pos:=i;end if;end loop;
    p_hierarchy:=greatest(0,100-metrics_pos*15-greatest(0,filters_pos-1)*15-case when filters_pos=0 then 5 else 0 end-abs(g(8)-3)*5);
    p_responsive:=case when metric('overflow')+metric('overlap')+metric('clipped')=0 then 100 else 0 end;
    p_performance:=greatest(0,least(100,100-(nodes-40)*.5));
    p_fitness:=case when p_eligible=1 then round(.4*p_access+.25*p_hierarchy+.25*p_responsive+.1*p_performance,6) else 0 end;
  end;
end apxgen_fitness;
/
