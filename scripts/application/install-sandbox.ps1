param([switch]$CompileInstalledFixture,[switch]$InstallApplicationEvolution,[switch]$InstallImportAttempts)
# Deliberately scoped to the separately authorized local Order Lab sandbox.
# No historical installer, LAB configuration or APEX application is modified.
$ErrorActionPreference = 'Stop'
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$localPath = Join-Path $projectPath '.local/order-lab'
$oraclePath = Join-Path $localPath 'oracle.json'
$policyPath = Join-Path $localPath 'application-sandbox.json'
$config = Get-Content -LiteralPath $oraclePath -Raw -Encoding UTF8 | ConvertFrom-Json
$policy = Get-Content -LiteralPath $policyPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (([int]$CompileInstalledFixture.IsPresent + [int]$InstallApplicationEvolution.IsPresent + [int]$InstallImportAttempts.IsPresent) -gt 1) { throw 'Select one explicit installation mode.' }
$additiveMode = $InstallApplicationEvolution -or $InstallImportAttempts
if ($config.user -ne 'APXGEN_ORDER_LAB' -or $config.workspace -ne 'APXGEN_ORDER_LAB' -or $config.connectString -ne 'localhost:1521/FREEPDB1') { throw 'Connection differs from the expressly selected local sandbox.' }
if ($policy.schema -ne 'APXGEN_ORDER_LAB' -or $policy.workspace -ne 'APXGEN_ORDER_LAB' -or [decimal]$policy.workspaceId -ne [long]$policy.workspaceId -or [long]$policy.workspaceId -le 0 -or [long]$policy.workspaceId -gt 9007199254740991) { throw 'Sandbox policy requires the explicitly configured workspace and an exact safe integer ID.' }
$authorizedWorkspaceId = [long]$policy.workspaceId
if ($policy.enabled -ne $true -or $policy.environment -ne 'development' -or $policy.fixtureWritesAuthorized -ne $true) { throw 'Explicit sandbox and fixture authorization required.' }
if (($policy.applicationIds -join ',') -ne '130,131,132,133' -or ($policy.protectedApplicationIds -join ',') -ne '120,121') { throw 'Application allowlist differs from the authorized isolated pool.' }
if ([string]::IsNullOrEmpty($config.password) -or $config.password -match '[\r\n"]') { throw 'Connection password cannot be safely piped to SQLcl.' }

$previousConfig = $env:APXGEN_APPLICATION_CONFIG
Push-Location $projectPath
try {
  $env:APXGEN_APPLICATION_CONFIG = Join-Path $localPath 'worker.json'
  $preflight = node (Join-Path $PSScriptRoot 'preflight.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Read-only application sandbox preflight failed.' }
  $observed = ($preflight -join "`n") | ConvertFrom-Json
  if ($observed.identityVerified -ne $true) { throw 'Sandbox identity must be verified before installation.' }
  if (-not $additiveMode -and $observed.allSlotsUnused -ne $true) { throw 'Every candidate slot must be unused before the initial fixture installation.' }

  # Absorb a PowerShell pipe BOM before processing SQL. Credentials travel only
  # through stdin; SQLcl history, echo and updates are explicitly disabled.
  $commands = @('prompt','set echo off verify off feedback off pagesize 100 linesize 200',
    'whenever sqlerror exit failure rollback',
    ('connect ' + $config.user + '/"' + $config.password + '"@' + $config.connectString),
    'set define off',
    "declare n number;begin",
    "if user<>'APXGEN_ORDER_LAB' or sys_context('USERENV','SESSION_USER')<>'APXGEN_ORDER_LAB' or sys_context('USERENV','CURRENT_SCHEMA')<>'APXGEN_ORDER_LAB' then raise_application_error(-20132,'Installer session identity rejected');end if;",
    "select count(*) into n from apex_workspace_schemas where schema='APXGEN_ORDER_LAB' and workspace_name='APXGEN_ORDER_LAB' and workspace_id=$authorizedWorkspaceId;",
    "if n<>1 then raise_application_error(-20132,'Installer workspace mapping rejected');end if;",
    "end;",'/')
  if ($InstallImportAttempts) {
    $commands += @(
      "declare n number;begin select count(*) into n from user_tables where table_name in('APXGEN_APP_RUNS','APXGEN_APP_ORGANISMS','GENESIS_ORDER_LAB_SLOTS');if n<>3 then raise_application_error(-20134,'Install the authorized application protocol before import audit');end if;end;",'/',
      ('@"' + (Join-Path $projectPath 'database/migrations/009_application_import_attempts.sql') + '"'))
  } elseif ($InstallApplicationEvolution) {
    $commands += @(
      "declare n number;begin select count(*) into n from user_objects where (object_name in('GENESIS_ORDER_LAB_SLOTS','GENESIS_ORDERS') and object_type='TABLE') or (object_name='GENESIS_ORDERS_SAFE_V' and object_type='VIEW');if n<>3 then raise_application_error(-20132,'Install the authorized fixture before application evolution');end if;end;",'/',
      ('@"' + (Join-Path $projectPath 'database/migrations/008_application_evolution.sql') + '"'),
      ('@"' + (Join-Path $projectPath 'database/packages/apxgen_app_evolution.sql') + '"'))
  } elseif ($CompileInstalledFixture) {
    # Explicit continuation after a recorded partial first installation. Never
    # replay DDL, reset a fixture or silently adopt a populated existing table.
    $commands += @(
      "declare n number;begin select count(*) into n from user_objects where (object_name in('GENESIS_ORDER_LAB_SLOTS','GENESIS_ORDERS') and object_type='TABLE') or (object_name='GENESIS_ORDERS_SAFE_V' and object_type='VIEW');if n<>3 then raise_application_error(-20132,'Expected initial fixture objects are absent');end if;select count(*) into n from genesis_order_lab_slots;if n<>0 then raise_application_error(-20132,'Initial compilation cannot adopt registered slots');end if;select count(*) into n from genesis_orders;if n<>0 then raise_application_error(-20132,'Initial compilation cannot adopt populated fixtures');end if;end;",'/',
      "comment on table genesis_orders_safe_v is 'Four fixed report columns for the authorized current APEX application, workspace, principal and active lease.';")
  } else {
    $commands += '@"' + (Join-Path $projectPath 'database/migrations/007_order_lab_fixture.sql') + '"'
  }
  if (-not $additiveMode) {
    foreach ($relative in @('database/packages/genesis_order_lab.sql','database/packages/apxgen_app_genome.sql','database/packages/apxgen_app_fitness.sql')) {
      $commands += '@"' + (Join-Path $projectPath $relative) + '"'
    }
  }
  $commands += @(
    "select name,type,line,position,text from user_errors where name in('GENESIS_ORDER_LAB','APXGEN_APP_GENOME','APXGEN_APP_FITNESS','APXGEN_APP_EVOLUTION','APXGEN_APP_IMPORT_IMMUTABLE') order by name,sequence;",
    "declare n number;begin select count(*) into n from user_errors where name in('GENESIS_ORDER_LAB','APXGEN_APP_GENOME','APXGEN_APP_FITNESS','APXGEN_APP_EVOLUTION','APXGEN_APP_IMPORT_IMMUTABLE');if n<>0 then raise_application_error(-20132,'Order Lab compilation failed; inspect private sanitized log');end if;end;",'/',
    "select 'ORDER_LAB_COMPILE_ERRORS='||count(*) from user_errors where name in('GENESIS_ORDER_LAB','APXGEN_APP_GENOME','APXGEN_APP_FITNESS','APXGEN_APP_EVOLUTION','APXGEN_APP_IMPORT_IMMUTABLE');",
    "select 'ORDER_LAB_REGISTERED_SLOTS='||count(*) from genesis_order_lab_slots;",
    "select 'ORDER_LAB_FIXTURE_ROWS='||count(*) from genesis_orders;",'exit')
  $raw = $commands | & 'C:/sqlcl/bin/sql.exe' -thin -nohistory -noupdates -S /nolog 2>&1
  $sqlExit = $LASTEXITCODE
  $safeOutput = ($raw -join "`n").Replace($config.password,'[REDACTED]')
  if (-not [string]::IsNullOrEmpty($config.apexPassword)) { $safeOutput = $safeOutput.Replace($config.apexPassword,'[REDACTED]') }
  $attemptName = 'install-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '.log'
  $safeOutput | Set-Content -LiteralPath (Join-Path $localPath $attemptName) -Encoding UTF8
  $safeOutput | Set-Content -LiteralPath (Join-Path $localPath 'install-sanitized.log') -Encoding UTF8
  Write-Output $safeOutput
  if ($sqlExit -ne 0) { throw 'Order Lab installation failed; preserve the sanitized local log and existing objects.' }
  if ($safeOutput -notmatch 'ORDER_LAB_COMPILE_ERRORS=0') { throw 'Installation evidence did not confirm valid packages.' }
  if (-not $additiveMode -and ($safeOutput -notmatch 'ORDER_LAB_REGISTERED_SLOTS=0' -or $safeOutput -notmatch 'ORDER_LAB_FIXTURE_ROWS=0')) { throw 'Initial installation requires empty fixture and slot tables.' }

  # This private file supports pure contract calls only; no slot is allocated.
  $contractPath = Join-Path $localPath 'application-contract-config.json'
  if (-not (Test-Path -LiteralPath $contractPath)) {
    @{user=$config.user;password=$config.password;connectString=$config.connectString;sandbox=$policy} |
      ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $contractPath -Encoding UTF8
  }
  Write-Output 'Isolated Order Lab installation verified; this command registered no slots, imported no applications and made no provider calls.'
} finally {
  $env:APXGEN_APPLICATION_CONFIG = $previousConfig
  Pop-Location
}
