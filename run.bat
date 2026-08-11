@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM =============================================================================
REM m3u8-downloader — Windows launcher (cmd.exe)
REM
REM - Checks Docker CLI + daemon (with auto-start self-healing)
REM - Detects container existence / running / healthy
REM - Fingerprints app sources to detect OLD vs NEW code
REM - Auto rebuilds + recreates container when code changed
REM - Progressive retry & self-healing stack recovery logic
REM - Opens the app URL in the browser
REM - Keeps terminal open with interactive exit prompt
REM =============================================================================

cd /d "%~dp0" || (
  echo [error] Failed to cd to script directory.
  echo.
  echo Press Enter to close terminal...
  pause >nul
  exit /b 1
)

set "APP_NAME=m3u8-downloader"
set "CONTAINER_NAME=m3u8-downloader"
if not defined APP_PORT set "APP_PORT=38478"
if not defined APP_URL set "APP_URL=http://127.0.0.1:%APP_PORT%"
if not defined HEALTH_URL set "HEALTH_URL=%APP_URL%/api/downloads"
if not defined COMPOSE_FILE set "COMPOSE_FILE=docker-compose.yml"
if not defined FP_FILE set "FP_FILE=.docker-build-fingerprint"
if not defined FORCE_BUILD set "FORCE_BUILD=0"

set "DOCKER_READY_RETRIES=35"
set "DOCKER_READY_SLEEP=2"
set "START_RETRIES=4"
set "HEALTH_RETRIES=60"
set "HEALTH_SLEEP=2"
set "USE_COMPOSE_V2=0"

set "NEED_BUILD=0"
set "NEED_RECREATE=0"
set "CODE_CHANGED=0"
set "CURRENT_FP="
set "STORED_FP="
set "FAST_PATH=0"

call :main
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo [%APP_NAME%] Process finished successfully.
) else (
  echo [%APP_NAME%] Launcher encountered an error ^(Exit Code: !EXIT_CODE!^).
  echo             Review diagnostic messages above for details.
)
echo.
echo =============================================================================
echo Press Enter to close this terminal window...
echo =============================================================================
pause >nul
exit /b %EXIT_CODE%

REM =============================================================================
:main
echo [%APP_NAME%] Project root: %CD%

call :check_docker_cli || exit /b 1
call :wait_for_docker || exit /b 1
call :resolve_compose || exit /b 1
call :ensure_compose_file || exit /b 1
call :decide_actions || exit /b 1

if "!FAST_PATH!"=="1" (
  call :open_browser
  call :print_summary
  exit /b 0
)

call :start_stack || exit /b 1
call :ensure_container_running || exit /b 1
call :wait_for_health || exit /b 1
call :open_browser
call :print_summary
exit /b 0

REM ---------------------------------------------------------------------------
:check_docker_cli
echo [%APP_NAME%] Checking Docker CLI...
where docker >nul 2>&1
if errorlevel 1 (
  echo [error] Docker CLI is not installed or not on PATH.
  echo         Install Docker Desktop for Windows, then re-open this terminal.
  exit /b 1
)
echo [ok] Docker CLI found.
exit /b 0

REM ---------------------------------------------------------------------------
:wait_for_docker
echo [%APP_NAME%] Waiting for Docker daemon...
set /a _i=1
set "_docker_started=0"

:docker_loop
docker info >nul 2>&1
if not errorlevel 1 (
  echo [ok] Docker daemon is running.
  exit /b 0
)

if "!_docker_started!"=="0" (
  if !_i! GEQ 3 (
    set "_docker_started=1"
    call :try_start_docker_desktop
  )
)

echo [warn] Docker not ready yet ^(attempt !_i!/%DOCKER_READY_RETRIES%^) — waiting for Docker Desktop...
timeout /t %DOCKER_READY_SLEEP% /nobreak >nul
set /a _i+=1
if !_i! LEQ %DOCKER_READY_RETRIES% goto docker_loop

echo [error] Docker daemon did not become ready after %DOCKER_READY_RETRIES% attempts.
echo         Please start Docker Desktop and try running this script again.
exit /b 1

:try_start_docker_desktop
echo [self-heal] Attempting to auto-start Docker Desktop for Windows...
set "_exe="
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" set "_exe=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not defined _exe if exist "%ProgramW6432%\Docker\Docker\Docker Desktop.exe" set "_exe=%ProgramW6432%\Docker\Docker\Docker Desktop.exe"
if not defined _exe if exist "%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe" set "_exe=%LocalAppData%\Programs\Docker\Docker Desktop.exe"

if defined _exe (
  start "" "%_exe%"
  echo [ok] Launched Docker Desktop ^("%_exe%"^). Waiting for engine startup...
) else (
  echo [warn] Could not locate Docker Desktop executable automatically.
)
exit /b 0

REM ---------------------------------------------------------------------------
:resolve_compose
docker compose version >nul 2>&1
if not errorlevel 1 (
  set "USE_COMPOSE_V2=1"
  echo [ok] Using: docker compose
  exit /b 0
)
where docker-compose >nul 2>&1
if not errorlevel 1 (
  set "USE_COMPOSE_V2=0"
  echo [ok] Using: docker-compose
  exit /b 0
)
echo [error] Neither "docker compose" nor "docker-compose" is available.
exit /b 1

REM ---------------------------------------------------------------------------
:ensure_compose_file
if not exist "%COMPOSE_FILE%" (
  echo [error] Missing %COMPOSE_FILE% in %CD%
  exit /b 1
)
exit /b 0

REM ---------------------------------------------------------------------------
:compute_fingerprint
for /f "usebackq delims=" %%H in (`powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$paths = @('Dockerfile','docker-compose.yml','package.json','package-lock.json','next.config.ts','tsconfig.json','prisma.config.ts','docker-entrypoint.sh');" ^
  "$files = New-Object System.Collections.Generic.List[string];" ^
  "foreach ($p in $paths) { if (Test-Path -LiteralPath $p) { [void]$files.Add((Resolve-Path -LiteralPath $p).Path) } }" ^
  "foreach ($dir in @('src','python','prisma')) {" ^
  "  if (Test-Path -LiteralPath $dir) {" ^
  "    Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue |" ^
  "      Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.next\\|\\generated\\|\\.db$|\\.db-journal$' } |" ^
  "      ForEach-Object { [void]$files.Add($_.FullName) }" ^
  "  }" ^
  "}" ^
  "$sb = New-Object System.Text.StringBuilder;" ^
  "$files | Sort-Object -Unique | ForEach-Object {" ^
  "  $rel = $_.Substring((Get-Location).Path.Length).TrimStart('\\','/').Replace('\\','/');" ^
  "  $hash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash;" ^
  "  [void]$sb.AppendLine(($rel + ' ' + $hash))" ^
  "};" ^
  "$bytes = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString());" ^
  "$sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes);" ^
  "(-join ($sha | ForEach-Object { $_.ToString('x2') }))"`) do set "CURRENT_FP=%%H"

if not defined CURRENT_FP set "CURRENT_FP=unknown"
exit /b 0

REM ---------------------------------------------------------------------------
:load_stored_fingerprint
set "STORED_FP="
if exist "%FP_FILE%" (
  set /p STORED_FP=<"%FP_FILE%"
)
exit /b 0

:save_fingerprint
> "%FP_FILE%" echo %CURRENT_FP%
echo [ok] Saved build fingerprint -^> %FP_FILE%
exit /b 0

REM ---------------------------------------------------------------------------
:container_running
docker inspect -f "{{.State.Running}}" "%CONTAINER_NAME%" 2>nul | findstr /i "true" >nul
exit /b %ERRORLEVEL%

:container_exists
docker inspect "%CONTAINER_NAME%" >nul 2>&1
exit /b %ERRORLEVEL%

:image_exists
docker image ls --format "{{.Repository}}" 2>nul | findstr /i "m3u8-downloader" >nul
exit /b %ERRORLEVEL%

:container_label_fp
set "LABEL_FP="
for /f "usebackq delims=" %%L in (`docker inspect -f "{{ index .Config.Labels \"com.m3u8.fingerprint\" }}" "%CONTAINER_NAME%" 2^>nul`) do set "LABEL_FP=%%L"
exit /b 0

REM ---------------------------------------------------------------------------
:http_ok
where curl >nul 2>&1
if not errorlevel 1 (
  for /f "usebackq delims=" %%C in (`curl -sS --max-time 5 -o nul -w "%%{http_code}" "%HEALTH_URL%" 2^>nul`) do set "HTTP_CODE=%%C"
  echo !HTTP_CODE!| findstr /r "^2[0-9][0-9]$" >nul
  exit /b %ERRORLEVEL%
)
powershell -NoProfile -Command ^
  "try { $r = Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { exit 0 } else { exit 1 } } catch { exit 1 }"
exit /b %ERRORLEVEL%

REM ---------------------------------------------------------------------------
:decide_actions
set "FAST_PATH=0"
set "NEED_BUILD=0"
set "NEED_RECREATE=0"
set "CODE_CHANGED=0"

call :compute_fingerprint
call :load_stored_fingerprint

echo [%APP_NAME%] Code fingerprint: !CURRENT_FP:~0,12!...
if defined STORED_FP (
  echo [%APP_NAME%] Last built:       !STORED_FP:~0,12!...
) else (
  echo [%APP_NAME%] Last built:       ^(none — first run or fingerprint missing^)
)

if "%FORCE_BUILD%"=="1" (
  set "CODE_CHANGED=1"
  set "NEED_BUILD=1"
  set "NEED_RECREATE=1"
  echo [warn] FORCE_BUILD=1 — will rebuild and recreate container.
  goto decide_state
)

if not defined STORED_FP (
  set "CODE_CHANGED=1"
) else if /I not "!STORED_FP!"=="!CURRENT_FP!" (
  set "CODE_CHANGED=1"
)

if "!CODE_CHANGED!"=="1" (
  set "NEED_BUILD=1"
  set "NEED_RECREATE=1"
  echo [warn] Source code changed ^(old image != current sources^) — will rebuild container.
  goto decide_state
)

call :container_exists
if not errorlevel 1 (
  call :container_label_fp
  if defined LABEL_FP if /I not "!LABEL_FP!"=="!CURRENT_FP!" if /I not "!LABEL_FP!"=="unknown" (
    set "CODE_CHANGED=1"
    set "NEED_BUILD=1"
    set "NEED_RECREATE=1"
    echo [warn] Container label fingerprint is stale — will rebuild.
    goto decide_state
  )
)

echo [ok] Sources match last build — no code rebuild required.

:decide_state
set "EXISTS=0"
set "RUNNING=0"
set "HEALTHY=0"
call :container_exists
if not errorlevel 1 set "EXISTS=1"
call :container_running
if not errorlevel 1 set "RUNNING=1"
call :http_ok
if not errorlevel 1 set "HEALTHY=1"

echo [%APP_NAME%] Container exists=!EXISTS! running=!RUNNING! healthy=!HEALTHY!

if "!RUNNING!"=="1" if "!HEALTHY!"=="1" if "!CODE_CHANGED!"=="0" if not "%FORCE_BUILD%"=="1" (
  echo [ok] Container running with current code — no update needed.
  set "FAST_PATH=1"
  exit /b 0
)

if "!CODE_CHANGED!"=="1" (
  set "NEED_BUILD=1"
  set "NEED_RECREATE=1"
)

if "!EXISTS!"=="0" (
  set "NEED_BUILD=1"
  echo [%APP_NAME%] Will create new container.
) else if "!RUNNING!"=="0" (
  echo [%APP_NAME%] Container present but stopped — will start ^(rebuild if code changed^).
) else if "!RUNNING!"=="1" if "!HEALTHY!"=="0" (
  echo [warn] Container running but unhealthy — will recreate.
  set "NEED_RECREATE=1"
  if "!CODE_CHANGED!"=="1" set "NEED_BUILD=1"
)

call :image_exists
if errorlevel 1 (
  echo [%APP_NAME%] No local image found — building.
  set "NEED_BUILD=1"
)

exit /b 0

REM ---------------------------------------------------------------------------
:compose_up_cmd
if "%USE_COMPOSE_V2%"=="1" (
  docker compose -f "%COMPOSE_FILE%" %COMPOSE_ARGS%
) else (
  docker-compose -f "%COMPOSE_FILE%" %COMPOSE_ARGS%
)
exit /b %ERRORLEVEL%

:compose_logs
if "%USE_COMPOSE_V2%"=="1" (
  docker compose -f "%COMPOSE_FILE%" logs --tail 60
) else (
  docker-compose -f "%COMPOSE_FILE%" logs --tail 60
)
exit /b 0

REM ---------------------------------------------------------------------------
:start_stack
set "M3U8_BUILD_FINGERPRINT=%CURRENT_FP%"
set "COMPOSE_ARGS=up -d"
if "!NEED_BUILD!"=="1" set "COMPOSE_ARGS=!COMPOSE_ARGS! --build"
if "!NEED_RECREATE!"=="1" set "COMPOSE_ARGS=!COMPOSE_ARGS! --force-recreate"

set /a _attempt=1
:start_loop
if "!NEED_BUILD!"=="1" (
  echo [%APP_NAME%] Updating stack with rebuild ^(attempt !_attempt!/%START_RETRIES%^)...
) else (
  echo [%APP_NAME%] Starting stack ^(attempt !_attempt!/%START_RETRIES%^)...
)

call :compose_up_cmd
if not errorlevel 1 (
  echo [ok] Compose up finished.
  call :save_fingerprint
  exit /b 0
)

echo [warn] compose up failed ^(attempt !_attempt!/%START_RETRIES%^).

if !_attempt! EQU 2 (
  echo [self-heal] Retrying compose up with forced build and recreate...
  set "NEED_BUILD=1"
  set "NEED_RECREATE=1"
  set "COMPOSE_ARGS=up -d --build --force-recreate"
) else if !_attempt! EQU 3 (
  echo [self-heal] Cleaning stale container/builder state and fingerprint cache...
  if "%USE_COMPOSE_V2%"=="1" (
    docker compose -f "%COMPOSE_FILE%" down --remove-orphans >nul 2>&1
  ) else (
    docker-compose -f "%COMPOSE_FILE%" down --remove-orphans >nul 2>&1
  )
  docker rm -f "%CONTAINER_NAME%" >nul 2>&1
  docker builder prune -f >nul 2>&1
  if exist "%FP_FILE%" del "%FP_FILE%" >nul 2>&1
  set "NEED_BUILD=1"
  set "NEED_RECREATE=1"
  set "COMPOSE_ARGS=up -d --build --force-recreate"
)

set /a _attempt+=1
if !_attempt! LEQ %START_RETRIES% (
  timeout /t 3 /nobreak >nul
  goto start_loop
)

echo [error] Failed to start/update containers after %START_RETRIES% attempts.
call :compose_logs
exit /b 1

REM ---------------------------------------------------------------------------
:ensure_container_running
echo [%APP_NAME%] Verifying container '%CONTAINER_NAME%' exists and is running...
set /a _i=1
set "_max=20"
:ctr_loop
call :container_running
if not errorlevel 1 (
  echo [ok] Container '%CONTAINER_NAME%' is running.
  exit /b 0
)
call :container_exists
if not errorlevel 1 (
  echo [warn] Container exists but is stopped — starting ^(attempt !_i!/%_max%^)...
  docker start "%CONTAINER_NAME%" >nul 2>&1
  if errorlevel 1 (
    echo [self-heal] docker start failed — executing compose up recovery...
    set "COMPOSE_ARGS=up -d"
    call :compose_up_cmd >nul 2>&1
  )
) else (
  echo [warn] Container missing — creating ^(attempt !_i!/%_max%^)...
  if "!NEED_BUILD!"=="1" (
    set "COMPOSE_ARGS=up -d --build"
  ) else (
    set "COMPOSE_ARGS=up -d"
  )
  call :compose_up_cmd >nul 2>&1
)
timeout /t 2 /nobreak >nul
set /a _i+=1
if !_i! LEQ %_max% goto ctr_loop
echo [error] Container '%CONTAINER_NAME%' is not running.
docker ps -a --filter "name=^/%CONTAINER_NAME%$"
call :compose_logs
exit /b 1

REM ---------------------------------------------------------------------------
:wait_for_health
echo [%APP_NAME%] Waiting for app health at %HEALTH_URL%...
set /a _i=1
:health_loop
call :http_ok
if not errorlevel 1 (
  echo [ok] App is healthy.
  exit /b 0
)
set /a _mod=_i %% 8
if !_mod! EQU 0 (
  call :container_running
  if errorlevel 1 (
    echo [self-heal] Container stopped unexpectedly during health wait — restarting container...
    docker start "%CONTAINER_NAME%" >nul 2>&1
    if errorlevel 1 (
      set "COMPOSE_ARGS=up -d"
      call :compose_up_cmd >nul 2>&1
    )
  )
)
if !_i! EQU 25 (
  echo [self-heal] Health check pending — attempting soft restart of container '%CONTAINER_NAME%'...
  docker restart "%CONTAINER_NAME%" >nul 2>&1
)
echo   ... not ready yet (!_i!/%HEALTH_RETRIES%^)
timeout /t %HEALTH_SLEEP% /nobreak >nul
set /a _i+=1
if !_i! LEQ %HEALTH_RETRIES% goto health_loop
echo [error] Health check timed out. Recent logs:
call :compose_logs
exit /b 1

REM ---------------------------------------------------------------------------
:open_browser
echo [%APP_NAME%] Opening %APP_URL% in your browser...
start "" "%APP_URL%"
if errorlevel 1 (
  echo [warn] Could not auto-open browser. Please visit: %APP_URL%
)
exit /b 0

REM ---------------------------------------------------------------------------
:print_summary
set "STATE=unknown"
call :container_running
if not errorlevel 1 (
  set "STATE=running"
) else (
  call :container_exists
  if not errorlevel 1 (set "STATE=stopped") else (set "STATE=missing")
)

echo.
echo ========================================
echo  m3u8 Downloader is ready
echo   URL:         %APP_URL%
echo   Batch:       %APP_URL%/batch
echo   Extract:     %APP_URL%/extract
echo   Container:   %CONTAINER_NAME% ^(%STATE%^)
echo   Fingerprint: !CURRENT_FP:~0,16!
if "!CODE_CHANGED!"=="1" (
  echo   Update:      rebuilt ^(code changed^)
) else (
  echo   Update:      up-to-date
)
echo   Logs:        docker compose logs -f
echo   Stop:        docker compose down
echo ========================================
echo.
exit /b 0
