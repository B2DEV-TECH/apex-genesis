param([Parameter(Mandatory=$true)][string]$Command)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $projectPath '.local/oracle.json') -Raw | ConvertFrom-Json
$sql = @"
connect $($config.user)/"$($config.password)"@$($config.connectString)
$Command
exit
"@
$sql | & 'C:\sqlcl\bin\sql.exe' -thin -nohistory -noupdates -S /nolog
if ($LASTEXITCODE -ne 0) { throw 'SQLcl command failed' }
