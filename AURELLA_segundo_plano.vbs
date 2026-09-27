' Inicia el servidor de AURELLA en segundo plano (sin ventana) al encender Windows.
' El registro queda en data\servidor.log
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = carpeta
nodeExe = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then nodeExe = """C:\Program Files\nodejs\node.exe"""
sh.Run "cmd /c set PORT=3999&& " & nodeExe & " backend\server.ts >> data\servidor.log 2>&1", 0, False
