$dir = 'C:\Users\you\flaresolverr_compat'
$pyw = 'C:\Users\you\AppData\Local\Programs\Python\Python311\pythonw.exe'
$script = Join-Path $dir 'pc_flaresolverr_compat.py'

"=== A. pythonw direct start on port 8192 ==="
Start-Process -FilePath $pyw -ArgumentList @($script, '--port', '8192', '--headless')
Start-Sleep -Seconds 10
"pythonw procs:"
Get-Process pythonw -ErrorAction SilentlyContinue | Select-Object Id, StartTime | Format-Table -AutoSize | Out-String
try { "health8192 : " + (Invoke-WebRequest -Uri 'http://127.0.0.1:8192/health' -TimeoutSec 5 -UseBasicParsing).Content }
catch { "health8192 : FAIL " + $_.Exception.Message }

"=== B. run the bat and capture its streams ==="
$p = Start-Process -FilePath (Join-Path $dir 'start_flaresolverr_compat.bat') -Wait -PassThru -NoNewWindow `
       -RedirectStandardOutput (Join-Path $dir '_bat_out.txt') -RedirectStandardError (Join-Path $dir '_bat_err.txt')
"bat exit   : " + $p.ExitCode
"bat stdout : " + ((Get-Content (Join-Path $dir '_bat_out.txt') -Raw -ErrorAction SilentlyContinue) -replace '\s+$','')
"bat stderr : " + ((Get-Content (Join-Path $dir '_bat_err.txt') -Raw -ErrorAction SilentlyContinue) -replace '\s+$','')

Start-Sleep -Seconds 12
"=== C. listeners on 8191 / 8192 ==="
Get-NetTCPConnection -LocalPort 8191,8192 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String
"=== D. compat log tail (newest 10) ==="
Get-Content (Join-Path $dir 'flaresolverr_compat.log') -Tail 10 -ErrorAction SilentlyContinue
