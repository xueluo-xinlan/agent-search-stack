@echo off
chcp 936 >nul
cd /d "%~dp0"
title FlareSolverr 人工验证入口

echo ============================================================
echo   人工过验证 / 登录（cookie 将写入持久化 profile）
echo   默认打开 京东 + 淘宝 + 拼多多 + 闲鱼，请在各标签页完成登录
echo   不需要的标签页直接关掉即可
echo ============================================================
echo.

echo [1/5] 先暂停自愈任务，避免它中途抢走浏览器 profile ...
schtasks /change /tn "FlareSolverrCompat" /disable >nul 2>&1

echo [2/5] 停止常驻抓取服务，释放浏览器 profile ...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8191 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } catch { } }" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*browser_profile*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch { } }" >nul 2>&1
ping -n 3 127.0.0.1 >nul

echo [3/5] 打开浏览器 —— 请完成验证码/登录，然后【关闭整个浏览器窗口】...
echo.
"C:\Users\you\AppData\Local\Programs\Python\Python311\python.exe" "%~dp0verify_cookies.py" %*
echo.

echo [4/5] 恢复常驻抓取服务（后台拉起，不阻塞）...
schtasks /change /tn "FlareSolverrCompat" /enable >nul 2>&1
schtasks /run /tn "FlareSolverrCompat" >nul 2>&1

echo [5/5] 验证登录态是否生效 ...
echo.
"C:\Users\you\AppData\Local\Programs\Python\Python311\python.exe" "%~dp0verify_check.py"
echo.

echo 全部完成，可以关闭本窗口。
pause >nul
