# Removes the two Genesis tasks after a graceful supervisor shutdown. Only the
# tasks named below are touched. Runs, checkpoints, publications and logs are
# kept; nothing in Oracle or in .local is deleted.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall-tasks.ps1
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$taskPath = '\'
# The watchdog goes first so it cannot restart the supervisor being stopped.
foreach ($t in @('B2DEV-Genesis-Watchdog')) {
  if (Get-ScheduledTask -TaskName $t -TaskPath $taskPath -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $t -TaskPath $taskPath -Confirm:$false; Write-Output "Removed $t"
  }
}
& node (Join-Path $projectPath 'runtime/genesisctl.mjs') shutdown --wait
$t = 'B2DEV-Genesis-Supervisor'
if (Get-ScheduledTask -TaskName $t -TaskPath $taskPath -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $t -TaskPath $taskPath -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $t -TaskPath $taskPath -Confirm:$false; Write-Output "Removed $t"
}
