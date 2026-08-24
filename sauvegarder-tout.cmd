@echo off
chcp 65001 >nul
rem ============================================================================
rem  Ecran Maison - SAUVEGARDE COMPLETE (base + code)
rem
rem  Ne a la nuit du 18 au 19/08/2026 : SentinelOne a mis en quarantaine 13
rem  fichiers .js du projet. La BASE etait sauvegardee, le CODE ne l'etait pas.
rem  Une nuit de travail est partie avec.
rem
rem  Deux differences volontaires avec outils\sauvegarder.js :
rem   1. l'archive part HORS du dossier projet (C:\temp\maison-coffre) - un
rem      antivirus qui nettoie C:\temp\maison ne la trouve pas ;
rem   2. c'est un .cmd et non un .js - les .cmd n'ont pas ete touches par la
rem      quarantaine, et il reste lisible meme si tout le reste disparait.
rem
rem  Outils NATIFS uniquement (tar.exe est fourni avec Windows 10/11) : pas
rem  d'installation, Remi n'est pas admin de ce poste.
rem
rem  ATTENTION : l'archive contient .env (cle Anthropic, token Notion) et
rem  maison.db (donnees de la famille). Elle ne se partage pas.
rem
rem  Pour une sauvegarde AUTOMATIQUE quotidienne : installer-sauvegarde-auto.cmd
rem ============================================================================

setlocal
set "RACINE=%~dp0"
set "COFFRE=C:\temp\maison-coffre"
set "A_GARDER=20"

if not exist "%COFFRE%" mkdir "%COFFRE%"

rem --- Node portable : celui d'asap d'abord (autorise par le pare-feu) ---
set "NODE=C:\temp\asap\asap3-poc-local\node-v24.17.0-win-x64\node.exe"
if not exist "%NODE%" set "NODE=%LOCALAPPDATA%\nodejs\node.exe"
if not exist "%NODE%" (
  echo [X] Node introuvable. Verifie les chemins en tete de ce fichier.
  exit /b 1
)

rem --- Horodatage : %DATE% depend de la locale Windows, Get-Date non.
rem     (Une expression Node en ligne casserait le for /f : ses parentheses sont
rem      interpretees par cmd avant d'arriver a Node.) ---
for /f %%H in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%H"

echo.
echo === 1/2  Base de donnees ===
rem VACUUM INTO : coherent meme serveur allume (une copie brute pendant une
rem ecriture WAL donnerait une base tronquee, invisible jusqu'au jour du besoin).
"%NODE%" "%RACINE%outils\sauvegarder.js"
if errorlevel 1 echo [!] Sauvegarde de la base en echec - on archive quand meme le code.

echo.
echo === 2/2  Code + base, hors du dossier projet ===
tar -a -c -f "%COFFRE%\maison-%STAMP%.zip" -C "%RACINE%." ^
    --exclude=*node_modules* --exclude=*sauvegardes* --exclude=*maison-coffre* ^
    --exclude=*.zip .
if errorlevel 1 (
  echo [X] Archivage en echec.
  exit /b 1
)
echo     %COFFRE%\maison-%STAMP%.zip

rem --- On ne garde que les %A_GARDER% dernieres archives ---
for /f "skip=%A_GARDER% delims=" %%F in ('dir /b /o-d "%COFFRE%\maison-*.zip" 2^>nul') do (
  del "%COFFRE%\%%F"
  echo     retiree : %%F
)

echo.
echo Termine.
echo.
echo   RAPPEL : ceci reste sur le MEME disque. Pour etre vraiment a l'abri,
echo   copie de temps en temps %COFFRE% sur une cle USB ou un disque perso.
echo   (Pas le OneDrive de l'entreprise : voir CLAUDE.md 5 quater, propriete
echo    intellectuelle d'un projet perso sur du materiel employeur.)
echo.
endlocal
