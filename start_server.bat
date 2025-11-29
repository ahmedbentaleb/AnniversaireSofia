@echo off
REM Lance l'application Anniversaire Sofia (Windows)
cd /d "%~dp0"
setlocal enabledelayedexpansion

REM Installer les dependances si absentes
IF NOT EXIST node_modules (
  echo Installation des dependances...
  call npm install
)

REM Charger le port depuis .env (defaut 3001)
set PORT=3001
IF EXIST ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /I "%%A"=="PORT" set PORT=%%B
  )
)
echo Port utilise : !PORT!

REM Ouvrir le navigateur
start "" http://localhost:!PORT!/admin/login

REM Demarrer le serveur
echo Demarrage du serveur (Ctrl+C pour arreter)...
call npm run dev

echo.
echo Appuyez sur une touche pour fermer...
pause >nul
