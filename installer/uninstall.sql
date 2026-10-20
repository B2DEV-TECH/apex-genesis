-- DESTRUCTIVE: removes Genesis objects/history from the connected dedicated owner.
-- Read docs/installation/maintenance.md. Back up and remove only the Genesis app first.
whenever sqlerror exit failure rollback
set verify off
accept genesis_remove char prompt 'Type REMOVE_GENESIS_OBJECTS to remove Genesis history: '
begin
  if '&genesis_remove'<>'REMOVE_GENESIS_OBJECTS' then
    raise_application_error(-20099,'Removal not confirmed');
  end if;
end;
/
undefine genesis_remove
begin
  for j in (select job_name from user_scheduler_jobs where job_name like 'APXGEN\_%' escape '\') loop
    dbms_scheduler.drop_job(j.job_name,force=>true);
  end loop;
  for o in (select object_name,object_type from user_objects
             where object_name like 'APXGEN\_%' escape '\'
               and object_type in ('PACKAGE','VIEW','TRIGGER')) loop
    execute immediate 'drop '||o.object_type||' '||dbms_assert.enquote_name(o.object_name,false);
  end loop;
  for t in (select table_name from user_tables where table_name like 'APXGEN\_%' escape '\') loop
    execute immediate 'drop table '||dbms_assert.enquote_name(t.table_name,false)||' cascade constraints purge';
  end loop;
end;
/
prompt Genesis objects removed. Workspace and applications were not altered.
