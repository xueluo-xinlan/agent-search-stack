# Remove the hardcoded --headless from the launcher.
# ASCII ONLY, on purpose: PowerShell 5.1 reads BOM-less files as ANSI/GBK, so
# non-ASCII comments here corrupt the parse and bind $p to null.
$p = 'C:\Users\you\flaresolverr_compat\start_flaresolverr_compat.bat'
if (-not (Test-Path $p)) { Write-Output 'ERROR: bat not found'; exit 1 }
Copy-Item $p ($p + '.bak-20261004') -Force
$c = Get-Content $p -Raw
if ($null -eq $c) { Write-Output 'ERROR: read failed'; exit 1 }
$n = $c -replace "'--headless',", ''
if ($n -eq $c) {
    Write-Output 'NO_CHANGE (pattern not found)'
} else {
    Set-Content -Path $p -Value $n -Encoding Default
    Write-Output 'REPLACED'
}
$check = Select-String -Path $p -Pattern 'headless' -SimpleMatch
if ($check) { Write-Output ('STILL_HAS: ' + $check.Line.Trim()) } else { Write-Output 'CLEAN' }
$launch = Get-Content $p | Select-String 'pc_flaresolverr_compat.py' | Select-Object -Last 1
if ($launch) { Write-Output ('NOW: ' + $launch.Line.Trim()) }
Write-Output ('SIZE: ' + (Get-Item $p).Length)
