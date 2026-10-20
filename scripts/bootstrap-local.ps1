$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$localPath = Join-Path $projectPath '.local'
New-Item -ItemType Directory -Path $localPath -Force | Out-Null
$configPath = Join-Path $localPath 'oracle.json'
if (Test-Path -LiteralPath $configPath) { throw 'Local configuration already exists. Refusing to replace credentials.' }
$schemaPassword = 'Gx' + [guid]::NewGuid().ToString('N') + '9!'
$apexPassword = 'Gx' + [guid]::NewGuid().ToString('N') + '9!'
@{user='APXGEN_LAB';password=$schemaPassword;connectString='localhost:1521/FREEPDB1';workspace='APXGEN_LAB';apexUser='GENESIS_ADMIN';apexPassword=$apexPassword} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
$sql = @"
whenever sqlerror exit failure rollback
set echo off feedback on
alter session set container=FREEPDB1;
create user APXGEN_LAB identified by "$schemaPassword" default tablespace USERS quota 500M on USERS;
grant create session, create table, create view, create sequence, create procedure, create trigger, create job to APXGEN_LAB;
grant execute on sys.dbms_crypto to APXGEN_LAB;
begin
apex_instance_admin.add_workspace(p_workspace=>'APXGEN_LAB',p_primary_schema=>'APXGEN_LAB',p_additional_schemas=>null);
apex_util.set_security_group_id(apex_util.find_security_group_id('APXGEN_LAB'));
apex_util.create_user(p_user_name=>'GENESIS_ADMIN',p_email_address=>'genesis@example.invalid',p_web_password=>'$apexPassword',p_developer_privs=>'ADMIN:CREATE:DATA_LOADER:EDIT:HELP:MONITOR:SQL',p_change_password_on_first_use=>'N');
end;
/
commit;
exit
"@
$sql | sqlplus -L -S '/ as sysdba'
if ($LASTEXITCODE -ne 0) { throw 'Sandbox creation failed. Preserve configuration for diagnosis.' }
Write-Output 'Dedicated APXGEN_LAB schema and workspace created; credentials retained only in ignored .local/oracle.json.'
