$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$configPath = if ($env:APXGEN_CONFIG) { $env:APXGEN_CONFIG } else { Join-Path $projectPath '.local/oracle.json' }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$commands = @('whenever sqlerror exit failure rollback', ('connect ' + $config.user + '/"' + $config.password + '"@' + $config.connectString), 'set define off')
foreach ($name in @('security','genome','genetics','fitness','budget','ai','evolution','export','web')) {
  $commands += '@"' + (Join-Path $projectPath "database/packages/apxgen_$name.sql") + '"'
}
$commands += 'select name,type,line,text from user_errors order by name,sequence;'
$commands += 'exit'
$commands | sqlplus -L -S /nolog
if ($LASTEXITCODE -ne 0) { throw 'Compilation command failed' }
