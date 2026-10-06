$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$base    = 'C:\Users\you\flaresolverr_compat'
$root    = 'C:\Users\you'
$desktop = [Environment]::GetFolderPath('Desktop')
$gbk     = [System.Text.Encoding]::GetEncoding(936)

# ---- 1) 家目录转发 bat（内容按 GBK 写，cmd 才读得对）----
$fwdPath = Join-Path $root '人工验证-登录.bat'
$fwd = "@echo off`r`nchcp 936 >nul`r`ncall `"$base\verify_cookies.bat`" %*`r`n"
[System.IO.File]::WriteAllText($fwdPath, $fwd, $gbk)
"forward_bat_exists=" + (Test-Path $fwdPath) + " size=" + (Get-Item $fwdPath).Length

# ---- 2) 桌面快捷方式 ----
$lnkPath = Join-Path $desktop '人工验证-登录.lnk'
$ws  = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath       = Join-Path $base 'verify_cookies.bat'
$lnk.WorkingDirectory = $base
$lnk.Description      = '打开浏览器人工登录京东/淘宝，登录态写入抓取通道'
$lnk.Save()
"lnk_created=" + (Test-Path $lnkPath)

# ---- 3) 读回验证（证明指向正确，而不是只看文件存在）----
$v = $ws.CreateShortcut($lnkPath)
"readback_target=" + $v.TargetPath
"readback_workdir=" + $v.WorkingDirectory
"readback_target_exists=" + (Test-Path $v.TargetPath)

# ---- 4) 列出桌面所有 lnk，确认没有重名覆盖 ----
Get-ChildItem $desktop -Filter *.lnk | Select-Object -ExpandProperty Name

# ---- 5) 硬验证：转发 bat 的字节级内容 ----
$b = [System.IO.File]::ReadAllBytes($fwdPath)
$txt = [System.Text.Encoding]::GetEncoding(936).GetString($b)
"fwd_bytes=" + $b.Length
"fwd_has_crlf=" + $txt.Contains("`r`n")
"fwd_calls_correct=" + $txt.Contains($base + '\verify_cookies.bat')
