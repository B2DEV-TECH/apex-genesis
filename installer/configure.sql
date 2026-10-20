-- Read-only report. Bind a username in your client to assign authority explicitly:
-- insert into apxgen_principals(username,principal_role)
-- values (upper(:genesis_apex_username),'OWNER');
-- commit;
-- Optional AI configuration: docs/installation/haiku.md. No paid opt-in here.
select username,principal_role from apxgen_principals order by username;
select enabled,model_id,daily_limit_usd from apxgen_provider_config;
select object_name,object_type,status from user_objects
 where object_name like 'APXGEN\_%' escape '\' and status<>'VALID';
