# Installs the two Windows Task Scheduler tasks that keep the Genesis lab
# running unattended:
#
#   B2DEV-Genesis-Supervisor  long-running supervisor (runtime/supervisor.mjs)
#   B2DEV-Genesis-Watchdog    short check every 5 minutes (runtime/watchdog.mjs)
#
# Both run as the current user, never SYSTEM, with the limited (non-elevated)
# run level. No password is stored: the preferred logon type is S4U ("run
# whether the user is logged on or not", no network credentials, no window).
# When S4U is not permitted for a standard user, the tasks fall back to
# Interactive ("run only when the user is logged on") and are started through
# a headless console host so no window appears.
#
# The tasks carry no secrets: the database credentials stay in
# .local/oracle.json and are read by the supervisor at run time.
#
# Power policy is not changed. The tasks do not wake the computer, and
# "start only on AC power" is disabled for these two tasks only, so a laptop on
# battery keeps evolving at BelowNormal priority. Sleep, hibernation and the
# system power plan are untouched.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-tasks.ps1 [-LogonType S4U|Interactive] [-NoStart]
param(
  [ValidateSet('Auto','S4U','Interactive')][string]$LogonType = 'Auto',
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$supervisorTask = 'B2DEV-Genesis-Supervisor'
$watchdogTask = 'B2DEV-Genesis-Watchdog'
$taskPath = '\'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = [version]((& $node --version).TrimStart('v'))
if ($nodeVersion.Major -lt 22) { throw "Node 22 or newer is required (found $nodeVersion)" }
if (-not (Test-Path -LiteralPath (Join-Path $projectPath '.local/oracle.json'))) { throw 'Missing .local/oracle.json (run the local installer first)' }
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function New-GenesisAction([string]$script, [bool]$headless) {
  if ($headless) {
    # conhost --headless gives the console process no visible window.
    return New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\conhost.exe') `
      -Argument ('--headless "' + $node + '" "' + $script + '"') -WorkingDirectory $projectPath
  }
  return New-ScheduledTaskAction -Execute $node -Argument ('"' + $script + '"') -WorkingDirectory $projectPath
}

function Register-GenesisTasks([string]$logon) {
  $headless = $logon -eq 'Interactive'
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType $logon -RunLevel Limited

  # Supervisor: start at logon, keep one instance, restart on failure, no time
  # limit, BelowNormal priority (7). The watchdog covers restarts beyond this.
  $supervisorSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -Priority 7 -DontStopOnIdleEnd
  $supervisorTrigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  Register-ScheduledTask -TaskName $supervisorTask -TaskPath $taskPath -Force -Principal $principal -Settings $supervisorSettings `
    -Trigger $supervisorTrigger -Action (New-GenesisAction (Join-Path $projectPath 'runtime/supervisor.mjs') $headless) `
    -Description 'APEX Genesis autonomous lab supervisor (single instance under an Oracle lease). Stop with: node runtime/genesisctl.mjs shutdown' | Out-Null

  # Watchdog: every 5 minutes, at most 2 minutes per check.
  $watchdogSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 7
  $watchdogTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 5)
  Register-ScheduledTask -TaskName $watchdogTask -TaskPath $taskPath -Force -Principal $principal -Settings $watchdogSettings `
    -Trigger $watchdogTrigger -Action (New-GenesisAction (Join-Path $projectPath 'runtime/watchdog.mjs') $headless) `
    -Description 'APEX Genesis watchdog: restarts the supervisor task after a crash or hang, never after a deliberate stop.' | Out-Null
}

$attempts = if ($LogonType -eq 'Auto') { @('S4U','Interactive') } else { @($LogonType) }
$installed = $null
foreach ($logon in $attempts) {
  try { Register-GenesisTasks $logon; $installed = $logon; break }
  catch {
    Write-Output "Logon type $logon not available: $($_.Exception.Message.Trim())"
    foreach ($t in @($supervisorTask,$watchdogTask)) { Unregister-ScheduledTask -TaskName $t -TaskPath $taskPath -Confirm:$false -ErrorAction SilentlyContinue }
  }
}
if (-not $installed) { throw 'Could not register the Genesis tasks' }
Write-Output "Installed $supervisorTask and $watchdogTask for $user (logon type $installed, run level Limited)"
if (-not $NoStart) { Start-ScheduledTask -TaskName $supervisorTask -TaskPath $taskPath; Write-Output "Started $supervisorTask" }
