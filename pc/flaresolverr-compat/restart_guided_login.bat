@echo off
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*edge_profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*pc_guided_login.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
schtasks /Delete /TN EdgeGuidedLogin /F >nul 2>&1
timeout /t 3 /nobreak >nul
set PY=C:\Users\you\AppData\Local\Programs\Python\Python311\pythonw.exe
set SC=C:\Users\you\pc_guided_login.py
schtasks /Create /TN EdgeGuidedLogin /TR "%PY% %SC%" /SC ONCE /ST 23:59 /F /IT /RU %USERNAME% /RL LIMITED >nul
schtasks /Run /TN EdgeGuidedLogin
rem 上面按命令行精确匹配，只结束本任务拉起的 pythonw（早先用的 taskkill /IM pythonw.exe
rem 会把整机所有 pythonw 一起杀掉，包括抓取兼容层与 SearXNG——那种写法已废弃）。
echo RESTARTED
