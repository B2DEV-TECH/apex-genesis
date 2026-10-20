create table apxgen_principals (
  username varchar2(255) primary key,
  principal_role varchar2(12) not null check(principal_role in('READER','OPERATOR','OWNER'))
);
