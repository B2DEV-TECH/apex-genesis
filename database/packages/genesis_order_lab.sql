create or replace package genesis_order_lab authid definer as
  c_fixture_version constant varchar2(40):='order-lab/1.0';
  -- Trusted direct-schema worker only; no APEX callback may reset fixtures.
  procedure reset_fixture(p_application_id number,p_lease_token varchar2);
  function fixture_hash(p_application_id number,p_lease_token varchar2) return varchar2;
  -- The application and principal come only from the authenticated APEX session.
  procedure update_status(p_order_id number,p_status varchar2);
end genesis_order_lab;
/
create or replace package body genesis_order_lab as
  procedure require_worker is
  begin
    if sys_context('USERENV','SESSION_USER')<>sys_context('USERENV','CURRENT_USER')
      or sys_context('USERENV','CURRENT_SCHEMA')<>sys_context('USERENV','CURRENT_USER')
      or nvl(apex_application.g_flow_id,0)<>0 or nvl(apex_application.g_instance,0)<>0
      or v('APP_ID') is not null or v('APP_USER') is not null then
      raise_application_error(-20130,'Fixture access requires a trusted direct-schema worker');
    end if;
  end;

  procedure validate_application_id(p_application_id number) is
  begin
    if p_application_id is null or p_application_id<>trunc(p_application_id)
      or p_application_id<=0 or p_application_id in(120,121) then
      raise_application_error(-20130,'Protected or invalid fixture application');
    end if;
  end;

  function lock_slot(p_application_id number) return genesis_order_lab_slots%rowtype is
    s genesis_order_lab_slots%rowtype;n number;
  begin
    validate_application_id(p_application_id);
    select * into s from genesis_order_lab_slots where application_id=p_application_id for update nowait;
    if s.slot_state<>'ACTIVE' or s.lease_until<=systimestamp or s.fixture_version<>c_fixture_version then
      raise_application_error(-20130,'Fixture slot lease is inactive or expired');
    end if;
    select count(*) into n from apex_workspace_schemas
    where schema=sys_context('USERENV','CURRENT_USER') and workspace_id=s.workspace_id;
    if n<>1 then raise_application_error(-20130,'Fixture slot workspace does not map to this owner');end if;
    return s;
  exception when no_data_found then
    raise_application_error(-20130,'Fixture slot has no registered owner');
  end;

  function worker_slot(p_application_id number,p_lease_token varchar2) return genesis_order_lab_slots%rowtype is
    s genesis_order_lab_slots%rowtype;
  begin
    require_worker;
    if p_lease_token is null or not regexp_like(p_lease_token,'^[a-f0-9]{32}$','c') then
      raise_application_error(-20130,'An exact fixture lease token is required');
    end if;
    s:=lock_slot(p_application_id);
    if s.lease_token<>p_lease_token then raise_application_error(-20130,'Fixture slot lease token rejected');end if;
    return s;
  end;

  procedure reset_fixture(p_application_id number,p_lease_token varchar2) is
    s genesis_order_lab_slots%rowtype;
  begin
    s:=worker_slot(p_application_id,p_lease_token);
    delete from genesis_orders where application_id=p_application_id;
    for i in 1..40 loop
      insert into genesis_orders(application_id,order_id,customer_name,status,order_total,row_version,updated_by)
      values(p_application_id,1000+i,'Synthetic Customer '||to_char(i,'FM00'),
        case mod(i,5) when 0 then 'NEW' when 1 then 'PROCESSING' when 2 then 'DELAYED'
          when 3 then 'SHIPPED' else 'COMPLETED' end,
        100+i*17.25,0,'FIXTURE_RESET');
    end loop;
    -- The caller owns the transaction; no commit or automatic lease renewal.
  end;

  function fixture_hash(p_application_id number,p_lease_token varchar2) return varchar2 is
    s genesis_order_lab_slots%rowtype;items json_array_t:=json_array_t();item json_object_t;
    payload json_object_t:=json_object_t();c clob;
  begin
    s:=worker_slot(p_application_id,p_lease_token);
    for r in(select order_id,customer_name,status,order_total,row_version from genesis_orders
      where application_id=p_application_id order by order_id) loop
      item:=json_object_t();item.put('orderId',r.order_id);item.put('customerName',r.customer_name);
      item.put('status',r.status);item.put('orderTotal',r.order_total);item.put('rowVersion',r.row_version);
      items.append(item);
    end loop;
    payload.put('fixtureVersion',c_fixture_version);payload.put('orders',items);c:=payload.to_clob;
    if dbms_lob.getlength(c)>32767 then raise_application_error(-20130,'Fixture exceeds its fixed hash bounds');end if;
    return lower(rawtohex(dbms_crypto.hash(
      utl_i18n.string_to_raw(dbms_lob.substr(c,32767,1),'AL32UTF8'),dbms_crypto.hash_sh256)));
  end;

  procedure update_status(p_order_id number,p_status varchar2) is
    app_id number;username varchar2(255);s genesis_order_lab_slots%rowtype;
    n number;previous_version number;
  begin
    app_id:=to_number(v('APP_ID'));username:=upper(v('APP_USER'));
    if app_id is null or username is null or nvl(apex_application.g_flow_id,0)<>app_id
      or nvl(apex_application.g_instance,0)<=0 or nvl(upper(apex_application.g_user),'NOBODY')<>username
      or username in('NOBODY','APEX_PUBLIC_USER','ORDS_PUBLIC_USER','PUBLIC','ANONYMOUS') then
      raise_application_error(-20131,'An authenticated Order Lab application session is required');
    end if;
    if apex_authentication.is_authenticated then null;
    else raise_application_error(-20131,'An authenticated Order Lab principal is required');end if;
    if p_order_id is null or p_order_id<>trunc(p_order_id) or p_order_id not between 1001 and 1040
      or p_status is null or p_status not in('NEW','PROCESSING','DELAYED','SHIPPED','COMPLETED') then
      raise_application_error(-20131,'Order status update is outside the fixed task grammar');
    end if;
    s:=lock_slot(app_id);
    if s.approved_username<>username or s.workspace_id<>nvl(apex_custom_auth.get_security_group_id,-1) then
      raise_application_error(-20131,'Current principal or workspace does not own this Order Lab slot');
    end if;
    select count(*) into n from apex_applications a join apex_workspace_schemas w
      on w.workspace_name=a.workspace and w.schema=a.owner
    where a.application_id=app_id and a.owner=sys_context('USERENV','CURRENT_USER') and w.workspace_id=s.workspace_id;
    if n<>1 then raise_application_error(-20131,'Installed application differs from the registered sandbox slot');end if;
    -- Slot-first locking serializes all API resets/updates in this partition.
    select row_version into previous_version from genesis_orders
      where application_id=app_id and order_id=p_order_id for update nowait;
    update genesis_orders set status=p_status,row_version=previous_version+1,
      updated_at=systimestamp,updated_by=username
    where application_id=app_id and order_id=p_order_id;
    if sql%rowcount<>1 then raise_application_error(-20131,'Expected one owned synthetic order');end if;
  exception when no_data_found then
    raise_application_error(-20131,'Synthetic order was not found in the current application');
  end;
end genesis_order_lab;
/
