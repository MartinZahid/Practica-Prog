@echo off
title CodeRuta - servidor local
cd /d "%~dp0"
echo.
echo   Iniciando CodeRuta...
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo   No se encontro Node.js.
  echo   Puedes abrir igual el archivo index.html haciendo doble clic.
  echo.
  pause
  exit /b
)
start "" http://localhost:8080
node server.js
pause
