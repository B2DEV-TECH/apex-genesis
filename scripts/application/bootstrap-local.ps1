param([Parameter(Mandatory=$true)][string]$ConfigurationDirectory)
$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($ConfigurationDirectory)
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $target.StartsWith($workspaceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Configuration must remain inside this feature workspace.' }
if (Test-Path -LiteralPath $target) { throw 'Refusing to replace existing sandbox configuration.' }
$schemaPassword = 'Gx' + [guid]::NewGuid().ToString('N') + '9!'
$testPassword = 'Gx' + [guid]::NewGuid().ToString('N') + '9!'
New-Item -ItemType Directory -Path $target | Out-Null
@{user='APXGEN_ORDER_LAB';password=$schemaPassword;connectString='localhost:1521/FREEPDB1';workspace='APXGEN_ORDER_LAB';apexUser='GENESIS_TEST';apexPassword=$testPassword} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'oracle.json') -Encoding utf8
# Trusted bootstrap only. No genome or model response reaches this script.
$sql = @"
prompt
set echo off verify off heading off feedback off pagesize 0
whenever sqlerror exit failure rollback
alter session set container=FREEPDB1;
declare n number;
begin
select count(*) into n from dba_users where username='APXGEN_ORDER_LAB';
if n<>0 then raise_application_error(-20180,'Order Lab schema already exists');end if;
select count(*) into n from apex_workspaces where workspace='APXGEN_ORDER_LAB';
if n<>0 then raise_application_error(-20180,'Order Lab workspace already exists');end if;
select count(*) into n from apex_applications where application_id in(130,131,132,133);
if n<>0 then raise_application_error(-20180,'An application slot is occupied');end if;
end;
/
create user APXGEN_ORDER_LAB identified by "$schemaPassword" default tablespace USERS quota 100M on USERS;
grant create session,create table,create view,create sequence,create procedure,create trigger to APXGEN_ORDER_LAB;
grant execute on sys.dbms_crypto to APXGEN_ORDER_LAB;
begin
apex_instance_admin.add_workspace(p_workspace=>'APXGEN_ORDER_LAB',p_primary_schema=>'APXGEN_ORDER_LAB',p_additional_schemas=>null);
apex_util.set_security_group_id(apex_util.find_security_group_id('APXGEN_ORDER_LAB'));
apex_util.create_user(p_user_name=>'GENESIS_TEST',p_email_address=>'order-lab@example.invalid',p_web_password=>'$testPassword',p_developer_privs=>null,p_account_locked=>'N',p_change_password_on_first_use=>'N');
end;
/
commit;
select 'WORKSPACE_ID='||workspace_id from apex_workspaces where workspace='APXGEN_ORDER_LAB';
exit
"@
$result = $sql | sqlplus -L -S '/ as sysdba' 2>&1
$exitCode = $LASTEXITCODE
$safeOutput = ($result -join "`n").Replace($schemaPassword,'[REDACTED]').Replace($testPassword,'[REDACTED]')
if ($exitCode -ne 0) { throw ('Sandbox creation failed; preserve private configuration for diagnosis. ' + $safeOutput) }
$match = [regex]::Match($safeOutput,'WORKSPACE_ID=([0-9]+)')
if (-not $match.Success) { throw 'Sandbox was created but workspace identity could not be verified.' }
$workspaceId = [long]$match.Groups[1].Value
@{schemaVersion='1.0';enabled=$true;environment='development';schema='APXGEN_ORDER_LAB';workspace='APXGEN_ORDER_LAB';workspaceId=$workspaceId;applicationIds=@(130,131,132,133);protectedApplicationIds=@(120,121);fixtureWritesAuthorized=$true;maxConcurrentImports=1;maxMaterializationsPerRun=22} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'application-sandbox.json') -Encoding utf8
@{oracleConfigPath='oracle.json';sandboxPolicyPath='application-sandbox.json';sqlclPath='C:/sqlcl/bin/sql.exe'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'worker.json') -Encoding utf8
Write-Output ('Dedicated Order Lab sandbox created. Workspace ID: ' + $workspaceId + '. Allowlisted application IDs: 130,131,132,133. Secrets remain in ignored local configuration.')
