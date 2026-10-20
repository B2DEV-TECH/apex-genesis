$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$verifyPath = Join-Path $projectPath '.local/verify-oracle.json'
if (Test-Path -LiteralPath $verifyPath) { throw 'Verification configuration exists; refusing to replace it.' }
$verifyPassword = 'Gx' + [guid]::NewGuid().ToString('N') + '9!'
@{user='APXGEN_VERIFY';password=$verifyPassword;connectString='localhost:1521/FREEPDB1'} | ConvertTo-Json | Set-Content -LiteralPath $verifyPath -Encoding utf8
@('whenever sqlerror exit failure rollback','alter session set container=FREEPDB1;',
 'declare n number;begin select count(*)into n from dba_users where username=''APXGEN_VERIFY'';if n>0 then raise_application_error(-20099,''Verification schema exists; refusing changes'');end if;end;','/',
 ('create user APXGEN_VERIFY identified by "'+$verifyPassword+'" default tablespace USERS quota 200M on USERS;'),
 'grant create session,create table,create view,create sequence,create procedure,create trigger,create job to APXGEN_VERIFY;',
 'grant execute on sys.dbms_crypto to APXGEN_VERIFY;','exit') | sqlplus -L -S '/ as sysdba'
if ($LASTEXITCODE -ne 0) { throw 'Verification owner creation failed' }
Push-Location (Join-Path $projectPath 'installer')
try {
 @('whenever sqlerror exit failure rollback',('connect APXGEN_VERIFY/"'+$verifyPassword+'"@localhost:1521/FREEPDB1'),'@install.sql','select count(*) invalid_objects from user_objects where status=''INVALID'';','exit') | sqlplus -L -S /nolog
 if ($LASTEXITCODE -ne 0) { throw 'Clean installation failed' }
} finally { Pop-Location }
$previousConfig = $env:APXGEN_CONFIG
try {
 $env:APXGEN_CONFIG = $verifyPath
 node (Join-Path $projectPath 'tests/integration/database.mjs')
 if ($LASTEXITCODE -ne 0) { throw 'Clean schema tests failed' }
} finally { $env:APXGEN_CONFIG = $previousConfig }
Write-Output 'Clean installation verified in separate APXGEN_VERIFY owner. No existing schema was modified.'
