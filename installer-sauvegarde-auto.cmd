@echo off
chcp 65001 >nul
rem ============================================================================
rem  Ecran Maison - installer la SAUVEGARDE AUTOMATIQUE quotidienne
rem
rem  A LANCER PAR REMI, pas par un script : creer une tache planifiee est un
rem  changement PERSISTANT du poste. C'est aussi, litteralement, un comportement
rem  de "persistance" que les EDR surveillent - or SentinelOne vient de se
rem  declencher sur ce dossier. Autant que ce soit un geste humain, assume,
rem  fait en journee, plutot qu'une tache apparue seule pendant la nuit.
rem
rem  Pas besoin d'etre administrateur : la tache est creee pour TON compte
rem  utilisateur et ne tourne que quand tu es connecte.
rem
rem  Pour la retirer :  schtasks /delete /tn "Ecran Maison - sauvegarde" /f
rem  Pour la verifier :  schtasks /query /tn "Ecran Maison - sauvegarde"
rem ============================================================================

setlocal
set "TACHE=Ecran Maison - sauvegarde"
set "SCRIPT=%~dp0sauvegarder-tout.cmd"
set "HEURE=12:30"

if not exist "%SCRIPT%" (
  echo [X] Introuvable : %SCRIPT%
  exit /b 1
)

echo.
echo   Tache      : %TACHE%
echo   Lance      : %SCRIPT%
echo   Frequence  : tous les jours a %HEURE%
echo.
echo   12h30 est choisi expres : le PC est allume et tu es connecte.
echo   Une sauvegarde programmee la nuit ne partirait jamais.
echo.
choice /c ON /n /m "  Installer ? [O]ui / [N]on : "
if errorlevel 2 (
  echo   Annule.
  exit /b 0
)

schtasks /create /tn "%TACHE%" /tr "\"%SCRIPT%\"" /sc daily /st %HEURE% /f
if errorlevel 1 (
  echo.
  echo [X] Creation impossible. La politique du poste bloque peut-etre les
  echo     taches planifiees. Repli : lancer sauvegarder-tout.cmd a la main
  echo     avant chaque session de travail.
  exit /b 1
)

echo.
echo   Installee. Premiere execution demain a %HEURE%.
echo   Pour la tester tout de suite : schtasks /run /tn "%TACHE%"
echo.
endlocal
