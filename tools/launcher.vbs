' Luogu Client launcher.
' Kept ASCII-only on purpose: wscript reads .vbs as ANSI, so no non-ASCII text here.
Option Explicit

Dim shell, fso, base, exePath, appPath

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 清掉可能从父进程继承来的环境变量，否则 electron 会以 node 模式启动
On Error Resume Next
shell.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
shell.Environment("PROCESS").Remove "ELECTRON_NO_ATTACH_CONSOLE"
On Error GoTo 0

base = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = base & "\electron\electron.exe"
appPath = base & "\app"

If Not fso.FileExists(exePath) Then
  MsgBox "electron.exe not found:" & vbCrLf & exePath & vbCrLf & vbCrLf & "The package is incomplete. Please extract the zip again.", 16, "Luogu Client"
  WScript.Quit 1
End If

shell.CurrentDirectory = appPath
shell.Run """" & exePath & """ """ & appPath & """", 1, False
