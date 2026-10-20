param([Parameter(Mandatory=$true)][string]$Command)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$configPath = if ($env:APXGEN_CONFIG) { $env:APXGEN_CONFIG } else { Join-Path $projectPath '.local/oracle.json' }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$sql = @"
whenever sqlerror exit failure rollback
connect $($config.user)/"$($config.password)"@$($config.connectString)
$Command
exit
"@
$sql | & 'C:\sqlcl\bin\sql.exe' -thin -nohistory -noupdates -S /nolog
if ($LASTEXITCODE -ne 0) { throw 'SQLcl command failed' }
