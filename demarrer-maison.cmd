@echo off
REM === Ecran Maison — lanceur Windows portable (aucune installation, aucun admin) ===
REM Sur Mac : ce fichier est ignore, on lance simplement "npm start".
setlocal

REM Node portable #1 : deja autorise par le pare-feu -> indispensable pour l'acces TABLETTE
set "NODEDIR=C:\temp\asap\asap3-poc-local\node-v24.17.0-win-x64"
REM Node portable #2 : repli (localhost uniquement, entrant bloque par le pare-feu)
if not exist "%NODEDIR%\node.exe" set "NODEDIR=%LOCALAPPDATA%\nodejs"

if not exist "%NODEDIR%\node.exe" (
  echo [ERREUR] Aucun Node portable trouve.
  echo Telecharge https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip
  echo puis decompresse-le dans %%LOCALAPPDATA%%\nodejs
  pause
  exit /b 1
)

cd /d "%~dp0"
if not exist "node_modules" (
  echo Installation des dependances...
  call "%NODEDIR%\npm.cmd" install --no-audit --no-fund
)

echo Node utilise : %NODEDIR%\node.exe
"%NODEDIR%\node.exe" server.js
pause
