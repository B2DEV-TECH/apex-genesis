# Applies pending numbered migrations (006+) and recompiles all packages for
# the owner selected by APXGEN_CONFIG (default .local/oracle.json).
# The connection text is passed to SQL*Plus through stdin, never as an argument.
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$configPath = if ($env:APXGEN_CONFIG) { $env:APXGEN_CONFIG } else { Join-Path $projectPath '.local/oracle.json' }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$migrations = @(@{ File = '006_autonomy.sql'; Table = 'APXGEN_AUTONOMY_CONFIG' })
foreach ($m in $migrations) {
  $probe = @('set heading off feedback off pagesize 0', ('connect ' + $config.user + '/"' + $config.password + '"@' + $config.connectString),
    "select count(*) from user_tables where table_name='$($m.Table)';", 'exit') | sqlplus -L -S /nolog
  if ($LASTEXITCODE -ne 0) { throw 'Migration probe failed' }
  if (($probe | Where-Object { $_ -match '^\s*\d+\s*$' } | Select-Object -Last 1).Trim() -eq '0') {
    Write-Output "Applying $($m.File)"
    @('whenever sqlerror exit failure rollback', ('connect ' + $config.user + '/"' + $config.password + '"@' + $config.connectString), 'set define off',
      ('@"' + (Join-Path $projectPath "database/migrations/$($m.File)") + '"'), 'exit') | sqlplus -L -S /nolog
    if ($LASTEXITCODE -ne 0) { throw "Migration $($m.File) failed" }
  } else { Write-Output "Already applied $($m.File)" }
}
& (Join-Path $PSScriptRoot 'recompile-local.ps1')
