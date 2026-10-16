@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Suivi des rollers Mewa - arrêt
cd /d "%~dp0"

echo.
echo   Arrêt du suivi des rollers...

rem Mode Docker : arrête le conteneur. Les données sont conservées.
where docker >nul 2>&1
if not errorlevel 1 (
  docker info >nul 2>&1
  if not errorlevel 1 docker compose stop
)

rem Mode Node.js : ferme la fenêtre « serveur » ouverte par demarrer.bat.
taskkill /fi "WINDOWTITLE eq Suivi des rollers - serveur*" /t /f >nul 2>&1

echo   Application arrêtée. Pour la relancer : demarrer.bat
echo.
timeout /t 5 >nul
