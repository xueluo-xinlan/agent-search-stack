@echo off
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*edge_profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
taskkill /F /IM pythonw.exe >nul 2>&1
schtasks /Delete /TN EdgeGuidedLogin /F >nul 2>&1
timeout /t 3 /nobreak >nul
set PY=C:\Users\you\AppData\Local\Programs\Python\Python311\pythonw.exe
set SC=C:\Users\you\pc_guided_login.py
schtasks /Create /TN EdgeGuidedLogin /TR "%PY% %SC%" /SC ONCE /ST 23:59 /F /IT /RU %USERNAME% /RL LIMITED >nul
schtasks /Run /TN EdgeGuidedLogin
rem 注意：上面 taskkill /F /IM pythonw.exe 会结束本机【所有】pythonw 进程，
rem       若你还有别的 pythonw 后台任务在跑，请把这一行改成按 PID 精确结束。
echo RESTARTED
