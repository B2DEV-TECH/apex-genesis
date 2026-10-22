-- A durable one-attempt boundary, independent of locked run/organism/slot rows.
-- No foreign keys: the audit connection must commit while the guard holds them.
whenever sqlerror exit failure rollback
set define off
declare n number;
begin
  if user in('SYS','SYSTEM','APXGEN_LAB','APXGEN_VERIFY','APEX_PUBLIC_USER','ORDS_PUBLIC_USER') then
    raise_application_error(-20134,'A separately authorized application sandbox is required');
  end if;
  select count(*) into n from user_objects where object_name in(
    'APXGEN_APP_IMPORT_ATTEMPTS','APXGEN_APP_IMPORT_IMMUTABLE',
    'APXGEN_APP_IMPORT_PK','APXGEN_APP_IMPORT_ORGANISM_UQ');
  if n<>0 then raise_application_error(-20134,'Import audit objects already exist; no overwrite is permitted');end if;
  select count(*) into n from user_constraints where constraint_name in(
    'APXGEN_APP_IMPORT_PK','APXGEN_APP_IMPORT_ORGANISM_UQ','APXGEN_APP_IMPORT_IDS_CK',
    'APXGEN_APP_IMPORT_APP_CK','APXGEN_APP_IMPORT_HASH_CK','APXGEN_APP_IMPORT_STATE_CK','APXGEN_APP_IMPORT_ERROR_CK');
  if n<>0 then raise_application_error(-20134,'Import audit constraint names already exist');end if;
end;
/
create table apxgen_app_import_attempts (
  attempt_id varchar2(32) not null,
  organism_id varchar2(32) not null,
  run_id varchar2(32) not null,
  application_id number not null,
  definition_hash varchar2(64) not null,
  state varchar2(12) default 'STARTED' not null,
  created_at timestamp with time zone default systimestamp not null,
  completed_at timestamp with time zone,
  error_code varchar2(80),
  constraint apxgen_app_import_pk primary key(attempt_id),
  constraint apxgen_app_import_organism_uq unique(organism_id),
  constraint apxgen_app_import_ids_ck check(
    regexp_like(attempt_id,'^[a-f0-9]{32}$','c') and regexp_like(organism_id,'^[a-f0-9]{32}$','c')
    and regexp_like(run_id,'^[a-f0-9]{32}$','c')),
  constraint apxgen_app_import_app_ck check(application_id>0 and application_id=trunc(application_id) and application_id not in(120,121)),
  constraint apxgen_app_import_hash_ck check(regexp_like(definition_hash,'^[a-f0-9]{64}$','c')),
  constraint apxgen_app_import_state_ck check(
    (state='STARTED' and completed_at is null and error_code is null)
    or (state='VERIFIED' and completed_at is not null and completed_at>=created_at and error_code is null)
    or (state in('FAILED','UNCERTAIN') and completed_at is not null and completed_at>=created_at and error_code is not null)),
  constraint apxgen_app_import_error_ck check(error_code is null or regexp_like(error_code,'^[A-Z][A-Z0-9_-]{0,79}$','c'))
);

create or replace trigger apxgen_app_import_immutable
before insert or update or delete on apxgen_app_import_attempts for each row
begin
  if inserting then
    if :new.state<>'STARTED' or :new.completed_at is not null or :new.error_code is not null then
      raise_application_error(-20134,'An import audit row must begin STARTED');
    end if;
  elsif deleting then
    raise_application_error(-20134,'Import attempts are permanent audit evidence');
  else
    if updating('ATTEMPT_ID') or updating('ORGANISM_ID') or updating('RUN_ID')
      or updating('APPLICATION_ID') or updating('DEFINITION_HASH') or updating('CREATED_AT') then
      raise_application_error(-20134,'Import attempt identity is immutable');
    end if;
    if :old.state<>'STARTED' or :new.state not in('VERIFIED','FAILED','UNCERTAIN')
      or :new.completed_at is null or :new.completed_at<:old.created_at then
      raise_application_error(-20134,'An import attempt may be finalized exactly once');
    end if;
  end if;
end;
/
comment on table apxgen_app_import_attempts is 'One permanent import attempt per organism, committed before SQLcl spawn by an independent trusted connection; no auth secrets or foreign keys.';
