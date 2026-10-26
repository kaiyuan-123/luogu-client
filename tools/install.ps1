<#
  洛谷桌面客户端 · 安装脚本
  ---------------------------------------------------------------
  用法（在仓库根目录）：
      powershell -ExecutionPolicy Bypass -File .\tools\install.ps1
      powershell -ExecutionPolicy Bypass -File .\tools\install.ps1 -Target "E:\Apps\LuoguClient"

  它会做四件事：
      1. 把 app\ 复制到目标目录
      2. 下载 Electron 运行时（约 150MB，走 npmmirror 镜像，失败再试 GitHub）
      3. 生成启动器 启动洛谷.vbs
      4. 在桌面创建快捷方式
#>

param(
  [string]$Target = "",
  [string]$ElectronVersion = "45.0.0"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$appSrc = Join-Path $repoRoot "app"
if (-not (Test-Path $appSrc)) { throw "找不到 app 目录：$appSrc" }

if (-not $Target) {
  if (Test-Path "D:\") { $Target = "D:\LuoguClient" }
  else { $Target = Join-Path $env:LOCALAPPDATA "LuoguClient" }
}

Write-Host "安装到: $Target" -ForegroundColor Cyan
$appDst = Join-Path $Target "app"
New-Item -ItemType Directory -Force -Path $appDst | Out-Null
Copy-Item (Join-Path $appSrc "*") $appDst -Recurse -Force

# ---------- Electron 运行时 ----------

$electronDir = Join-Path $Target "electron"
$electronExe = Join-Path $electronDir "electron.exe"

if (-not (Test-Path $electronExe)) {
  $zip = Join-Path $env:TEMP "electron-v$ElectronVersion-win32-x64.zip"
  $urls = @(
    "https://cdn.npmmirror.com/binaries/electron/$ElectronVersion/electron-v$ElectronVersion-win32-x64.zip",
    "https://registry.npmmirror.com/-/binary/electron/$ElectronVersion/electron-v$ElectronVersion-win32-x64.zip",
    "https://github.com/electron/electron/releases/download/v$ElectronVersion/electron-v$ElectronVersion-win32-x64.zip"
  )

  $downloaded = $false
  foreach ($url in $urls) {
    try {
      Write-Host "下载 Electron: $url" -ForegroundColor DarkGray
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 900
      $downloaded = $true
      break
    } catch {
      Write-Warning "下载失败：$($_.Exception.Message)"
    }
  }
  if (-not $downloaded) {
    throw "Electron 下载失败。可以手动下载 electron-v$ElectronVersion-win32-x64.zip 并解压到：$electronDir"
  }

  Write-Host "解压 Electron ..." -ForegroundColor DarkGray
  New-Item -ItemType Directory -Force -Path $electronDir | Out-Null
  Expand-Archive -Path $zip -DestinationPath $electronDir -Force
  Remove-Item $zip -Force
}

# ---------- 启动器 ----------

$vbsPath = Join-Path $Target "启动洛谷.vbs"
$vbs = @"
' 洛谷桌面客户端启动器
Option Explicit

Dim shell, fso, base, exePath, appPath

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

On Error Resume Next
shell.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
shell.Environment("PROCESS").Remove "ELECTRON_NO_ATTACH_CONSOLE"
On Error GoTo 0

base = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = base & "\electron\electron.exe"
appPath = base & "\app"

If Not fso.FileExists(exePath) Then
  MsgBox "找不到 " & exePath & vbCrLf & "客户端文件不完整。", 16, "洛谷"
  WScript.Quit 1
End If

shell.CurrentDirectory = appPath
shell.Run """" & exePath & """ """ & appPath & """", 1, False
"@
[IO.File]::WriteAllText($vbsPath, $vbs, [Text.Encoding]::Unicode)

# ---------- 桌面快捷方式 ----------

$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "洛谷.lnk"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$sc.Arguments = '"' + $vbsPath + '"'
$sc.WorkingDirectory = $Target
$sc.IconLocation = (Join-Path $appDst "icon.ico") + ",0"
$sc.Description = "洛谷桌面客户端"
$sc.Save()

Write-Host ""
Write-Host "完成。" -ForegroundColor Green
Write-Host "  程序目录：$Target"
Write-Host "  数据目录：$Target\数据（登录状态、缓存都在这里）"
Write-Host "  桌面快捷方式：洛谷"
