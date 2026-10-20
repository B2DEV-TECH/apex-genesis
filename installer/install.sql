whenever sqlerror exit failure rollback
set define off
@@../database/migrations/001_core.sql
@@../database/migrations/002_ai_offspring.sql
@@../database/migrations/003_access.sql
@@../database/migrations/004_controls.sql
@@../database/migrations/005_total_budget.sql
@@../database/packages/apxgen_security.sql
@@../database/packages/apxgen_genome.sql
@@../database/packages/apxgen_genetics.sql
@@../database/packages/apxgen_fitness.sql
@@../database/packages/apxgen_budget.sql
@@../database/packages/apxgen_ai.sql
@@../database/packages/apxgen_evolution.sql
@@../database/packages/apxgen_export.sql
@@../database/packages/apxgen_web.sql
declare n number;begin
select count(*) into n from user_objects where object_name in ('APXGEN_RUNS','APXGEN_GENOMES','APXGEN_ORGANISMS','APXGEN_EVALUATIONS','APXGEN_INVOCATIONS') and object_type='TABLE';
if n<>5 then raise_application_error(-20099,'Foundation scripts were not loaded');end if;
select count(*) into n from user_errors where name like 'APXGEN%';
if n>0 then raise_application_error(-20099,'Installation has compilation errors; inspect USER_ERRORS');end if;
end;
/
commit;
