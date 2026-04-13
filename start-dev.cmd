@echo off
setlocal

REM ============================================================
REM Start the Next.js dev server for this project.
REM
REM Notes:
REM 1. Run this file from the repo root.
REM 2. It starts the server as a hidden background process and writes logs to:
REM    .\src\.dev-server.log
REM 3. After startup, open:
REM    http://127.0.0.1:3000
REM 4. If port 3000 is already in use, this script will not start
REM    another copy.
REM 5. Closing this launcher window will NOT stop the dev server.
REM 6. Use .\stop-dev.cmd if you want to stop the server cleanly.
REM 7. If you want a fully silent launch with no visible cmd window,
REM    double-click .\start-dev.vbs instead.
REM ============================================================

set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%src"
set "LOG_FILE=%APP_DIR%\.dev-server.log"
set "PID_FILE=%APP_DIR%\.dev-server.pid"
set "HIDDEN_RUNNER=%ROOT_DIR%start-dev-hidden.vbs"
set "DEV_URL=http://127.0.0.1:3000"

if not exist "%APP_DIR%\package.json" (
    echo [ERROR] App directory not found:
    echo         %APP_DIR%
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found in PATH.
    pause
    exit /b 1
)

if not exist "%HIDDEN_RUNNER%" (
    echo [ERROR] Hidden launcher not found:
    echo         %HIDDEN_RUNNER%
    pause
    exit /b 1
)

set "PORT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
    set "PORT_PID=%%P"
    goto already_running
)

echo [INFO] Starting dev server...
echo [INFO] App dir: %APP_DIR%
echo [INFO] Log file: %LOG_FILE%

if exist "%LOG_FILE%" del /f /q "%LOG_FILE%" >nul 2>nul
if exist "%PID_FILE%" del /f /q "%PID_FILE%" >nul 2>nul

wscript.exe "%HIDDEN_RUNNER%" "%APP_DIR%"

for /L %%I in (1,1,60) do (
    set "PORT_PID="
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
        set "PORT_PID=%%P"
        goto started
    )
    timeout /t 1 >nul
)

echo [ERROR] Dev server did not become ready within 60 seconds.
echo [INFO] Check the log file:
echo        %LOG_FILE%
pause
exit /b 1

:already_running
>"%PID_FILE%" echo %PORT_PID%
echo [INFO] Port 3000 is already listening.
echo [INFO] PID: %PORT_PID%
echo [INFO] Open:
echo        %DEV_URL%
exit /b 0

:started
>"%PID_FILE%" echo %PORT_PID%
echo [INFO] Dev server is running.
echo [INFO] Open:
echo        %DEV_URL%
echo [INFO] Log file:
echo        %LOG_FILE%
echo [INFO] PID file:
echo        %PID_FILE%
echo [INFO] PID:
echo        %PORT_PID%
exit /b 0
