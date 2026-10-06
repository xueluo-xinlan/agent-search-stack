@echo off
rem FlareSolverr compat layer - resident launcher with idempotent self-heal.
rem
rem Health probe = /health returns HTTP 200 AND browserReady == true.
rem A listening TCP port alone is NOT proof of life: when the playwright
rem instance gets poisoned (observed: a failed navigation such as
rem net::ERR_CONNECTION_CLOSED left every later request raising
rem "It looks like you are using Playwright Sync API inside the asyncio loop"),
rem the HTTP port keeps answering while the browser is permanently dead.
rem
rem The "FlareSolverrCompat" scheduled task fires this every 5 minutes:
rem   - healthy           -> exit at once (never a second instance)
rem   - port dead OR browser dead -> kill the stale instance, start a fresh one
rem     via pythonw.exe (no console), so a closing console / SSH session can
rem     never kill it with CTRL_C (old 0xC000013A).
rem The Python process writes its own log: flaresolverr_compat.log
rem NOTE: keep this file pure ASCII - cmd reads .bat as CP936/GBK.
rem
rem v1.1 launch flags (added 2026-10-04):
rem   --profile-dir  -> persistent browser profile (cookies survive restarts);
rem                     run verify_cookies.bat once to pass captcha/login by hand.
rem   --min-host-gap -> min seconds between two requests to the SAME host
rem   --min-global-gap / --jitter -> global floor + random jitter
rem   Set any gap to 0 to disable throttling. gateway timeout is 60s, so keep
rem   (nav_time + gap) * same_host_burst comfortably under 60s.
cd /d "%~dp0"

powershell -NoProfile -Command "$ok=0; try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8191/health' -TimeoutSec 20; if ($r.browserReady -eq $true) { $ok=1 } } catch { }; if ($ok -eq 1) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 exit /b 0

rem port may be up but browser dead -> reap the stale instance first
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8191 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch { } }" >nul 2>&1
ping -n 3 127.0.0.1 >nul

powershell -NoProfile -Command "Start-Process -FilePath 'C:\Users\you\AppData\Local\Programs\Python\Python311\pythonw.exe' -ArgumentList @('C:\Users\you\flaresolverr_compat\pc_flaresolverr_compat.py','--port','8191','--warmup','--min-host-gap','1.2','--min-global-gap','0.35','--jitter','0.8')"
exit /b 0

