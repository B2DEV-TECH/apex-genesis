create or replace package apxgen_genetics authid definer as
  function mutate(p_genes apxgen_genome.genes,p_state in out number,p_rate number) return apxgen_genome.genes;
  function crossover(p_a apxgen_genome.genes,p_b apxgen_genome.genes,p_state in out number) return apxgen_genome.genes;
end apxgen_genetics;
/
create or replace package body apxgen_genetics as
  function mutate(p_genes apxgen_genome.genes,p_state in out number,p_rate number) return apxgen_genome.genes is g apxgen_genome.genes:=p_genes;v pls_integer;
  begin
    if p_rate<0 or p_rate>1 or p_rate is null then raise_application_error(-20010,'Invalid mutation rate');end if;
    for i in 1..11 loop if apxgen_genome.next_random(p_state,1000000)<p_rate*1000000 then
      v:=apxgen_genome.next_random(p_state,apxgen_genome.limits(i)-1);if v>=g(i) then v:=v+1;end if;g(i):=v;
    end if;end loop;return g;
  end;
  function crossover(p_a apxgen_genome.genes,p_b apxgen_genome.genes,p_state in out number) return apxgen_genome.genes is g apxgen_genome.genes;
  begin for i in 1..11 loop if apxgen_genome.next_random(p_state,2)=0 then g(i):=p_a(i);else g(i):=p_b(i);end if;end loop;return g;end;
end apxgen_genetics;
/
