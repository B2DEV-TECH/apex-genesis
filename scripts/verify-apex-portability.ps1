# Original isolated lab verification helper; not the portable community installer.
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectPath '.local/verify-oracle.json'
$verifyConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($verifyConfig.user -ne 'APXGEN_VERIFY' -or $verifyConfig.workspace) { throw 'Expected fresh verification owner configuration' }
$verifyApexPassword = 'Gx' + [guid]::NewGuid().ToString('N') + '9!'
$verifyConfig | Add-Member workspace 'APXGEN_VERIFY'
$verifyConfig | Add-Member apexUser 'GENESIS_VERIFY'
$verifyConfig | Add-Member apexPassword $verifyApexPassword
$verifyConfig | Add-Member evidenceName 'apex-portability'
$verifyConfig | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
@('whenever sqlerror exit failure rollback','alter session set container=FREEPDB1;',
 "begin apex_instance_admin.add_workspace(p_workspace=>'APXGEN_VERIFY',p_primary_schema=>'APXGEN_VERIFY');",
 "apex_util.set_security_group_id(apex_util.find_security_group_id('APXGEN_VERIFY'));",
 "apex_util.create_user(p_user_name=>'GENESIS_VERIFY',p_email_address=>'genesis@example.invalid',p_web_password=>'$verifyApexPassword',p_developer_privs=>'ADMIN:CREATE:DATA_LOADER:EDIT:HELP:MONITOR:SQL',p_change_password_on_first_use=>'N');end;",'/', 'commit;','exit') | sqlplus -L -S '/ as sysdba'
if ($LASTEXITCODE -ne 0) { throw 'Verification workspace creation failed; preserve configuration' }
@('whenever sqlerror exit failure rollback',('connect '+$verifyConfig.user+'/"'+$verifyConfig.password+'"@'+$verifyConfig.connectString),
 "begin apex_application_install.set_workspace_id(apex_util.find_security_group_id('APXGEN_VERIFY'));apex_application_install.set_schema('APXGEN_VERIFY');apex_application_install.generate_application_id;apex_application_install.generate_offset;end;",'/',
 '@apex/export/f120.sql',
 "insert into apxgen_principals(username,principal_role)values('GENESIS_VERIFY','OWNER');",'commit;',
 "select application_id,application_name from apex_applications where workspace='APXGEN_VERIFY';",'exit') | & 'C:/sqlcl/bin/sql.exe' -thin -nohistory -noupdates -S /nolog
if ($LASTEXITCODE -ne 0) { throw 'Portable SQL import failed' }
$previousConfig = $env:APXGEN_CONFIG
try {
 $env:APXGEN_CONFIG = $configPath
 node scripts/run-experiment.mjs --mode=GA_ONLY --seed=42 --size=4 --generations=5
 if ($LASTEXITCODE -ne 0) { throw 'Verification Darwin run failed' }
 node scripts/run-experiment.mjs --mode=RANDOM_SEARCH --seed=42 --size=4 --generations=5
 if ($LASTEXITCODE -ne 0) { throw 'Verification control run failed' }
 node tests/browser/apex.mjs
 if ($LASTEXITCODE -ne 0) { throw 'Destination browser validation failed' }
} finally { $env:APXGEN_CONFIG = $previousConfig }
