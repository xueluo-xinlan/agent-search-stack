$dir = 'C:\Users\you\flaresolverr_compat'

# 1) end-to-end through the compat layer on 8191 (Cloudflare interactive challenge test site)
$body = @{ cmd = 'request.get'; url = 'https://nowsecure.nl/'; maxTimeout = 60000 } | ConvertTo-Json
$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8191/v1' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 120
  $sw.Stop()
  $html = [string]$r.solution.response
  $chal = [bool]($html -match 'cf-challenge|Just a moment|challenge-platform')
  "e2e status     : " + $r.status + "  http=" + $r.solution.status + "  bytes=" + $html.Length + "  wall=" + [math]::Round($sw.Elapsed.TotalSeconds,2) + "s  solveTime=" + $r.solution.solveTime
  "challenge left : " + $chal
} catch { "e2e FAIL       : " + $_.Exception.Message }

# 2) survival across two scheduled-task ticks (~7 min)
$p1 = (Get-NetTCPConnection -LocalPort 8191 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
"pid before     : " + $p1
Start-Sleep -Seconds 430
$conns = @(Get-NetTCPConnection -LocalPort 8191 -State Listen -ErrorAction SilentlyContinue)
"listeners after: " + $conns.Count
$p2 = ($conns | Select-Object -First 1).OwningProcess
"pid after      : " + $p2
"pid stable     : " + ($p1 -eq $p2)
try { "health after   : " + (Invoke-WebRequest -Uri 'http://127.0.0.1:8191/health' -TimeoutSec 8 -UseBasicParsing).Content }
catch { "health after   : FAIL " + $_.Exception.Message }
"--- log tail ---"
Get-Content (Join-Path $dir 'flaresolverr_compat.log') -Tail 6 -ErrorAction SilentlyContinue
