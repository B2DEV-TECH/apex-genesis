# Destructive only to the explicitly created APXGEN_VERIFY disposable verification owner.
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectPath '.local/verify-oracle.json'
$verifyConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($verifyConfig.user -ne 'APXGEN_VERIFY' -or $verifyConfig.workspace -ne 'APXGEN_VERIFY') { throw 'Expected dedicated disposable verification owner' }
$connectLine = 'connect '+$verifyConfig.user+'/"'+$verifyConfig.password+'"@'+$verifyConfig.connectString
Push-Location (Join-Path $projectPath 'installer')
try {
 @('whenever sqlerror exit failure rollback',$connectLine,
 "declare n number;begin if user<>'APXGEN_VERIFY' then raise_application_error(-20099,'Wrong owner');end if;select count(*)into n from user_tables where table_name not like 'APXGEN\_%' escape '\';if n<>0 then raise_application_error(-20099,'Unrelated tables exist; refusing reset');end if;end;",'/',
 '@uninstall.sql','REMOVE_GENESIS_OBJECTS',
 "declare n number;begin select count(*)into n from user_tables;if n<>0 then raise_application_error(-20099,'Removal incomplete');end if;end;",'/',
 '@install.sql',"insert into apxgen_principals(username,principal_role)values('GENESIS_VERIFY','OWNER');",'commit;',
 'select count(*) invalid_objects from user_objects where status=''INVALID'';','exit') | sqlplus -L -S /nolog
 if ($LASTEXITCODE -ne 0) { throw 'Dedicated verification reinstall failed' }
} finally { Pop-Location }
@('whenever sqlerror exit failure rollback',$connectLine,
 "begin apex_application_install.set_workspace_id(apex_util.find_security_group_id('APXGEN_VERIFY'));apex_application_install.set_schema('APXGEN_VERIFY');apex_application_install.set_application_id(121);apex_application_install.generate_offset;end;",'/',
 '@apex/export/f120.sql','exit') | & 'C:/sqlcl/bin/sql.exe' -thin -nohistory -noupdates -S /nolog
if ($LASTEXITCODE -ne 0) { throw 'Current portable SQL import failed' }
$previousConfig = $env:APXGEN_CONFIG
try {
 $env:APXGEN_CONFIG = $configPath
 node tests/integration/database.mjs
 if ($LASTEXITCODE -ne 0) { throw 'Clean database tests failed' }
 node scripts/run-experiment.mjs --mode=GA_ONLY --seed=42 --size=4 --generations=5
 if ($LASTEXITCODE -ne 0) { throw 'Clean Darwin run failed' }
 node scripts/run-experiment.mjs --mode=RANDOM_SEARCH --seed=42 --size=4 --generations=5
 if ($LASTEXITCODE -ne 0) { throw 'Clean control run failed' }
 node tests/browser/apex.mjs
 if ($LASTEXITCODE -ne 0) { throw 'Clean native app verification failed' }
} finally { $env:APXGEN_CONFIG = $previousConfig }
Write-Output 'Current clean install, scoped uninstall/reinstall and portable app 121 verified.'
