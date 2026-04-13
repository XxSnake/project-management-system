Set shell = CreateObject("WScript.Shell")

If WScript.Arguments.Count < 1 Then
  WScript.Quit 1
End If

appDir = WScript.Arguments(0)

' Install dependencies if needed, generate Prisma client, then start dev server.
command = "cmd.exe /c cd /d """ & appDir & """ && (if not exist node_modules\. npm install) && npx prisma generate && npm run dev > .dev-server.log 2> .dev-server.err.log"

' Run hidden and do not wait for completion.
shell.Run command, 0, False
