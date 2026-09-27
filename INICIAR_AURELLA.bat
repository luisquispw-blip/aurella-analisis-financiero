@echo off
rem Inicia el servidor local de AURELLA y abre el navegador.
rem Si el servidor ya esta encendido, solo abre el navegador.
title AURELLA - Servidor local
cd /d "%~dp0"
set PORT=3999
set URL=http://localhost:%PORT%

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  start "" "%URL%"
  exit /b 0
)

set NODE=node
if exist "C:\Program Files\nodejs\node.exe" set NODE="C:\Program Files\nodejs\node.exe"

if not exist "frontend\dist\index.html" (
  echo Construyendo la interfaz por primera vez...
  call npm run build
)

rem Abre el navegador unos segundos despues, cuando el servidor ya responde
start "" cmd /c "timeout /t 4 >nul & start "" %URL%"

echo.
echo  AURELLA esta funcionando en %URL%
echo  No cierre esta ventana mientras use el aplicativo (puede minimizarla).
echo.
%NODE% backend\server.ts
echo.
echo  El servidor se detuvo. Revise el mensaje de arriba.
pause
