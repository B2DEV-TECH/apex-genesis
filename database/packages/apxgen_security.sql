create or replace package apxgen_security authid definer as
  function allowed(p_role varchar2 default 'READER') return number;
  procedure require_role(p_role varchar2);
end apxgen_security;
/
create or replace package body apxgen_security as
  function rank_role(p_role varchar2) return number is begin return case p_role when 'READER' then 1 when 'OPERATOR' then 2 when 'OWNER' then 3 else 99 end;end;
  function allowed(p_role varchar2 default 'READER') return number is role_name varchar2(12);
  begin
    if nvl(apex_application.g_flow_id,0)=0 and sys_context('USERENV','SESSION_USER')=sys_context('USERENV','CURRENT_USER')then return 1;end if;
    if apex_application.g_user is null or lower(apex_application.g_user)in('nobody','apex_public_user')then return 0;end if;
    select principal_role into role_name from apxgen_principals where username=upper(apex_application.g_user);
    return case when rank_role(role_name)>=rank_role(p_role)then 1 else 0 end;
  exception when no_data_found then return 0;end;
  procedure require_role(p_role varchar2) is begin if allowed(p_role)<>1 then raise_application_error(-20060,'Genesis authorization required');end if;end;
end apxgen_security;
/
