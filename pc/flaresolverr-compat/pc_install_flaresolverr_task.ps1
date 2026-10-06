$ErrorActionPreference = 'Stop'
$dir = 'C:\Users\you\flaresolverr_compat'
$bat = Join-Path $dir 'start_flaresolverr_compat.bat'
$pyw = 'C:\Users\you\AppData\Local\Programs\Python\Python311\pythonw.exe'

"pythonw exists : " + (Test-Path $pyw)
"bat exists     : " + (Test-Path $bat)

# Remove the old task (the onlogon variant died with its console).
Unregister-ScheduledTask -TaskName 'FlareSolverrCompat' -Confirm:$false -ErrorAction SilentlyContinue

# Re-register: at logon + every 5 minutes (idempotent self-heal), no exec time limit.
$action = New-ScheduledTaskAction -Execute $bat -WorkingDirectory $dir
"action.execute : " + $action.Execute
"action.workdir : " + $action.WorkingDirectory

$tLogon = New-ScheduledTaskTrigger -AtLogOn
$tRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
"triggers       : " + @($tLogon, $tRepeat).Count

$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'FlareSolverrCompat' -Action $action -Trigger @($tLogon, $tRepeat) -Settings $set -Force | Out-Null

$t = Get-ScheduledTask -TaskName 'FlareSolverrCompat'
"registered     : state=" + $t.State
"exec limit     : " + $t.Settings.ExecutionTimeLimit
"multi instance : " + $t.Settings.MultipleInstances
"trigger count  : " + @($t.Triggers).Count

# Kill only stale instances of THIS service (never other pythonw processes).
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*pc_flaresolverr_compat*' } |
  ForEach-Object { "killing stale pid=" + $_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# Fire once now and wait for browser warmup.
Start-ScheduledTask -TaskName 'FlareSolverrCompat'
Start-Sleep -Seconds 30
$info = Get-ScheduledTaskInfo -TaskName 'FlareSolverrCompat'
"lastRun        : " + $info.LastRunTime + "  result=" + $info.LastTaskResult
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8191/health' -TimeoutSec 8 -UseBasicParsing
  "health         : " + $r.Content
} catch { "health FAIL    : " + $_.Exception.Message }

"--- listeners on 8191 ---"
Get-NetTCPConnection -LocalPort 8191 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String
"--- tail of compat log ---"
Get-Content (Join-Path $dir 'flaresolverr_compat.log') -Tail 8 -ErrorAction SilentlyContinue
