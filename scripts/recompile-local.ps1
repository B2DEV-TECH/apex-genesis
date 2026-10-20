$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $projectPath '.local/oracle.json') -Raw | ConvertFrom-Json
$commands = @('whenever sqlerror exit failure rollback', ('connect ' + $config.user + '/"' + $config.password + '"@' + $config.connectString), 'set define off')
foreach ($name in @('security','genome','genetics','fitness','budget','ai','evolution','export','web')) {
  $commands += '@"' + (Join-Path $projectPath "database/packages/apxgen_$name.sql") + '"'
}
$commands += 'select name,type,line,text from user_errors order by name,sequence;'
$commands += 'exit'
$commands | sqlplus -L -S /nolog
if ($LASTEXITCODE -ne 0) { throw 'Compilation command failed' }
