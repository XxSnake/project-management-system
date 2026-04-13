Set shell = CreateObject("WScript.Shell")
rootDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
command = "cmd.exe /c """ & rootDir & "\start-dev.cmd"""

' Launch the existing startup script without showing any cmd window.
shell.Run command, 0, False
