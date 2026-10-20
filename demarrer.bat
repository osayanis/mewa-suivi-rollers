@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Suivi des rollers Mewa
cd /d "%~dp0"

rem ============================================================
rem  Suivi des rollers Mewa : lancement en un double-clic.
rem  - Docker installe  : lance le conteneur, il tourne en arriere-plan.
rem  - Sinon, Node.js   : lance le serveur dans une fenetre reduite.
rem  Puis ouvre l'application dans le navigateur.
rem ============================================================

set "URL=http://localhost:8080"
set "HEALTH=%URL%/api/health"
set "MODE="

echo.
echo   ==============================================
echo      Suivi des rollers Mewa - démarrage
echo   ==============================================
echo.

where curl.exe >nul 2>&1
if errorlevel 1 (set "HAVE_CURL=0") else (set "HAVE_CURL=1")

rem --- Déjà lancé ? On ouvre simplement le navigateur. ---
if "%HAVE_CURL%"=="1" (
  curl.exe -s -f -o nul --max-time 2 "%HEALTH%" >nul 2>&1
  if not errorlevel 1 (
    set "MODE=deja"
    goto :open
  )
)

where docker >nul 2>&1
if errorlevel 1 goto :node

rem ================== Mode Docker ==================
set "MODE=docker"
docker info >nul 2>&1
if not errorlevel 1 goto :docker_up

echo   Démarrage de Docker Desktop, patientez...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
set /a n=0
:wait_docker
timeout /t 3 /nobreak >nul
docker info >nul 2>&1
if not errorlevel 1 goto :docker_up
set /a n+=1
if %n% lss 60 goto :wait_docker
echo.
echo   [ERREUR] Docker Desktop ne répond pas.
echo   Ouvrez Docker Desktop manuellement, attendez qu'il soit prêt, puis relancez ce fichier.
goto :fail

:docker_up
echo   Lancement du conteneur. La première fois, comptez quelques minutes...
echo.
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo   [ERREUR] Le lancement avec Docker a échoué. Voir les messages ci-dessus.
  goto :fail
)
goto :wait_app

rem ================== Mode Node.js ==================
:node
where node >nul 2>&1
if errorlevel 1 goto :nothing
set "MODE=node"

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo   [ERREUR] Node.js 22.13 ou plus récent est nécessaire. Version installée :
  node -v
  echo   Mettez Node.js à jour depuis https://nodejs.org puis relancez ce fichier.
  goto :fail
)

echo   Docker n'est pas installé : lancement avec Node.js.
echo.
echo   [1/3] Préparation de l'interface...
pushd "%~dp0frontend"
call npm install --no-fund --no-audit --loglevel=error
if errorlevel 1 goto :npm_fail
call npm run build --silent
if errorlevel 1 goto :npm_fail
popd

echo   [2/3] Préparation du serveur...
pushd "%~dp0backend"
call npm install --no-fund --no-audit --loglevel=error
if errorlevel 1 goto :npm_fail
popd

echo   [3/3] Lancement du serveur...
set "PUBLIC_DIR=%~dp0frontend\dist"
start "Suivi des rollers - serveur, ne pas fermer" /min /d "%~dp0backend" cmd /k node --env-file-if-exists=..\.env --disable-warning=ExperimentalWarning src\server.js
goto :wait_app

:npm_fail
popd
echo.
echo   [ERREUR] L'installation a échoué. Vérifiez la connexion Internet puis relancez ce fichier.
goto :fail

rem ================== Attente puis ouverture ==================
:wait_app
echo.
echo   Attente du démarrage de l'application...
if "%HAVE_CURL%"=="0" (
  timeout /t 10 /nobreak >nul
  goto :open
)
set /a n=0
:wait_loop
curl.exe -s -f -o nul --max-time 2 "%HEALTH%" >nul 2>&1
if not errorlevel 1 goto :open
set /a n+=1
if %n% geq 90 goto :slow
timeout /t 2 /nobreak >nul
goto :wait_loop

:slow
echo.
echo   [ATTENTION] L'application met du temps à répondre. Le navigateur va quand même s'ouvrir :
echo   si la page ne s'affiche pas, patientez un peu puis actualisez-la.

:open
start "" "%URL%"
echo.
echo   ----------------------------------------------
echo     Application ouverte : %URL%
echo   ----------------------------------------------
if "%MODE%"=="docker" (
  echo   Elle tourne en arrière-plan : vous pouvez fermer cette fenêtre.
  echo   Elle redémarre toute seule avec Docker Desktop. Pour l'arrêter : arreter.bat
)
if "%MODE%"=="node" (
  echo   Laissez la fenêtre « serveur » ouverte : elle est réduite dans la barre des tâches.
  echo   Pour arrêter l'application : arreter.bat, ou fermez cette fenêtre « serveur ».
)
if "%MODE%"=="deja" (
  echo   L'application était déjà lancée.
)

rem --- Premier démarrage : identifiants du compte administrateur (mot de passe provisoire). ---
set "CREDS=%TEMP%\mewa-rollers-admin.txt"
if exist "%CREDS%" del "%CREDS%" >nul 2>&1
if exist "%~dp0backend\data\identifiants-admin-initial.txt" copy /y "%~dp0backend\data\identifiants-admin-initial.txt" "%CREDS%" >nul
where docker >nul 2>&1
if not errorlevel 1 docker compose exec -T rollers cat /data/identifiants-admin-initial.txt > "%CREDS%" 2>nul
for %%F in ("%CREDS%") do if %%~zF GTR 0 (
  echo.
  echo   ==============================================
  type "%CREDS%"
  echo   ==============================================
  echo   Notez ces identifiants : ils servent à la première connexion.
  del "%CREDS%" >nul 2>&1
  echo.
  pause
  exit /b 0
)
if exist "%CREDS%" del "%CREDS%" >nul 2>&1
echo.
timeout /t 8 >nul
exit /b 0

:nothing
echo   Ni Docker ni Node.js ne sont installés sur ce PC. Installez l'un des deux :
echo.
echo     - Docker Desktop, recommandé : https://www.docker.com/products/docker-desktop
echo     - ou Node.js, version LTS    : https://nodejs.org
echo.
echo   Puis relancez ce fichier.
goto :fail

:fail
echo.
pause
exit /b 1
