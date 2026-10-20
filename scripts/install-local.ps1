$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $projectPath '.local/oracle.json') -Raw | ConvertFrom-Json
$sql = @"
whenever sqlerror exit failure rollback
connect $($config.user)/"$($config.password)"@$($config.connectString)
@"$projectPath\installer\install.sql"
select name,type,line,text from user_errors order by name,sequence;
exit
"@
Push-Location (Join-Path $projectPath 'installer')
try {
  $sql | sqlplus -L -S /nolog
  if ($LASTEXITCODE -ne 0) { throw 'Installation failed' }
} finally { Pop-Location }
