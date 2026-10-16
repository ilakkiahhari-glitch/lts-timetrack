# Registers a Windows Scheduled Task that runs the nightly open-session job every day.
# Run once, from the project folder, in PowerShell:   .\scripts\schedule_nightly_job.ps1
# Optional:  -At "00:05"   -TaskName "LTS TimeTrack nightly job"
# Remove it with:   Unregister-ScheduledTask -TaskName "LTS TimeTrack nightly job" -Confirm:$false
param(
    [string]$At = "00:05",   # just after midnight, so a 23:59 auto_close_time has passed
    [string]$TaskName = "LTS TimeTrack nightly job"
)

$project = Split-Path -Parent $PSScriptRoot
$python = Join-Path $project ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "Virtual environment not found at $python. Create it first (see README)." }

$action = New-ScheduledTaskAction -Execute $python -Argument "-m scripts.flag_open_sessions" -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Flags attendance sessions left open past their auto-close time (never closes them)." -Force | Out-Null
Write-Host "Scheduled '$TaskName' daily at $At (runs as the current user, only while logged on)."
Write-Host "Test it now with:  Start-ScheduledTask -TaskName '$TaskName'"
