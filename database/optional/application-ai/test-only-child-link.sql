-- Last TEST_ONLY fixture step, after the billing-side subject migration.
whenever sqlerror exit failure rollback
set define off
declare k varchar2(64);n number;
begin
 if user<>'APXGEN_APP_BROKER_TEST' or sys_context('USERENV','SESSION_USER')<>user or sys_context('USERENV','CURRENT_SCHEMA')<>user then raise_application_error(-20260,'Fixed direct TEST_ONLY application owner required');end if;
 select kind into k from apxgen_app_ai_test_marker;if k<>'TEST_ONLY_APP_AI_APPLICATION_V1' then raise_application_error(-20260,'TEST_ONLY marker required');end if;
 select count(*) into n from apxgen_app_control_config where config_id=1 and worker_enabled=0;if n<>1 then raise_application_error(-20260,'Worker must stay disabled');end if;
 select count(*) into n from apxgen_app_runs where state='RUNNING';if n<>0 then raise_application_error(-20260,'No active application run during DDL');end if;
 select count(*) into n from apxgen_app_control_requests where state in('QUEUED','CLAIMED');if n<>0 then raise_application_error(-20260,'No active native request during DDL');end if;
 select count(*) into n from user_constraints where constraint_name='APP_AI_TEST_INV_LINK_FK';if n<>0 then raise_application_error(-20260,'No overwrite');end if;
end;
/
alter table apxgen_app_organisms add constraint app_ai_test_inv_link_fk foreign key(ai_invocation_id) references APXGEN_AI_BROKER_TEST.apxgen_invocations(invocation_id);
commit;
