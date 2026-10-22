-- Manual, additive installation into an explicitly authorized empty sandbox.
-- This file is deliberately absent from the default installer/upgrade paths.
whenever sqlerror exit failure rollback
set define off

declare
  n number;
begin
  if user in('SYS','SYSTEM','APXGEN_LAB','APXGEN_VERIFY','APEX_PUBLIC_USER','ORDS_PUBLIC_USER') then
    raise_application_error(-20132,'Order Lab requires a separate authorized sandbox owner');
  end if;
  select count(*) into n from user_objects where object_name in(
    'GENESIS_ORDER_LAB_SLOTS','GENESIS_ORDERS','GENESIS_ORDERS_SAFE_V','GENESIS_ORDER_LAB',
    'GENESIS_ORDER_SLOTS_PK','GENESIS_ORDERS_PK');
  if n<>0 then raise_application_error(-20132,'Order Lab names already exist; nothing may be overwritten');end if;
  select count(*) into n from user_constraints where constraint_name in(
    'GENESIS_ORDER_SLOTS_PK','GENESIS_ORDER_SLOTS_APP_CK','GENESIS_ORDER_SLOTS_WS_CK',
    'GENESIS_ORDER_SLOTS_USER_CK','GENESIS_ORDER_SLOTS_TOKEN_CK','GENESIS_ORDER_SLOTS_OWNER_CK',
    'GENESIS_ORDER_SLOTS_STATE_CK','GENESIS_ORDER_SLOTS_VERSION_CK',
    'GENESIS_ORDERS_PK','GENESIS_ORDERS_SLOT_FK','GENESIS_ORDERS_ID_CK',
    'GENESIS_ORDERS_STATUS_CK','GENESIS_ORDERS_TOTAL_CK','GENESIS_ORDERS_VERSION_CK');
  if n<>0 then raise_application_error(-20132,'Order Lab constraint names already exist');end if;
end;
/

-- Slot ownership is explicit. No application ID, principal, lease or owner is
-- allocated by this migration. Only the trusted operator/allocator inserts rows.
create table genesis_order_lab_slots (
  application_id number(10) not null,
  workspace_id number not null,
  approved_username varchar2(255) not null,
  owner_run_id varchar2(32) not null,
  owner_organism_id varchar2(32) not null,
  lease_token varchar2(32) not null,
  lease_until timestamp with time zone not null,
  slot_state varchar2(12) not null,
  fixture_version varchar2(40) default 'order-lab/1.0' not null,
  registered_at timestamp with time zone default systimestamp not null,
  registered_by varchar2(128) default sys_context('USERENV','SESSION_USER') not null,
  constraint genesis_order_slots_pk primary key(application_id),
  constraint genesis_order_slots_app_ck check(application_id>0 and application_id not in(120,121)),
  constraint genesis_order_slots_ws_ck check(workspace_id>0 and workspace_id=trunc(workspace_id)),
  constraint genesis_order_slots_user_ck check(
    regexp_like(approved_username,'^[A-Z][A-Z0-9_@.-]{0,254}$','c')
    and approved_username not in('NOBODY','APEX_PUBLIC_USER','ORDS_PUBLIC_USER','PUBLIC','ANONYMOUS')),
  constraint genesis_order_slots_token_ck check(regexp_like(lease_token,'^[a-f0-9]{32}$','c')),
  constraint genesis_order_slots_owner_ck check(
    regexp_like(owner_run_id,'^[a-f0-9]{32}$','c') and regexp_like(owner_organism_id,'^[a-f0-9]{32}$','c')),
  constraint genesis_order_slots_state_ck check(slot_state in('ACTIVE','RELEASED')),
  constraint genesis_order_slots_version_ck check(fixture_version='order-lab/1.0')
);

-- Logical partitions use a composite primary key: the same order IDs may exist
-- in different owned applications, but every lookup/update includes app ID.
create table genesis_orders (
  application_id number(10) not null,
  order_id number(10) not null,
  customer_name varchar2(80) not null,
  status varchar2(12) not null,
  order_total number(12,2) not null,
  row_version number(10) default 0 not null,
  updated_at timestamp with time zone default systimestamp not null,
  updated_by varchar2(255) default 'FIXTURE_RESET' not null,
  constraint genesis_orders_pk primary key(application_id,order_id),
  constraint genesis_orders_slot_fk foreign key(application_id) references genesis_order_lab_slots(application_id),
  constraint genesis_orders_id_ck check(order_id between 1001 and 1040),
  constraint genesis_orders_status_ck check(status in('NEW','PROCESSING','DELAYED','SHIPPED','COMPLETED')),
  constraint genesis_orders_total_ck check(order_total>=0),
  constraint genesis_orders_version_ck check(row_version>=0)
);

create view genesis_orders_safe_v as
select o.order_id,o.customer_name,o.status,o.order_total
from genesis_orders o
where o.application_id=to_number(v('APP_ID'))
and exists (
  select 1 from genesis_order_lab_slots s
  where s.application_id=o.application_id and s.slot_state='ACTIVE'
  and s.fixture_version='order-lab/1.0' and s.lease_until>systimestamp
  and s.approved_username=upper(v('APP_USER'))
  and s.workspace_id=apex_custom_auth.get_security_group_id
);

comment on table genesis_order_lab_slots is 'Explicit trusted-operator ownership and bounded leases for disposable Order Lab apps; no inferred ownership.';
comment on table genesis_orders is 'Synthetic order-lab/1.0 fixture logically isolated by application_id.';
comment on table genesis_orders_safe_v is 'Four fixed report columns for the authorized current APEX application, workspace, principal and active lease.';
