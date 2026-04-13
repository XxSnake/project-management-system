@echo off
setlocal

REM ============================================================
REM Stop the Next.js dev server started by .\start-dev.cmd.
REM
REM Notes:
REM 1. This script checks port 3000 and stops the listening process.
REM 2. It also removes the PID record written to .\src\.dev-server.pid.
REM 3. If port 3000 is not in use, the script exits without error.
REM ============================================================

set "ROOT_DIR=%~dp0"
set "APP_DIR=%ROOT_DIR%src"
set "PID_FILE=%APP_DIR%\.dev-server.pid"

set "PORT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
    set "PORT_PID=%%P"
    goto stop_server
)

if exist "%PID_FILE%" del /f /q "%PID_FILE%" >nul 2>nul
echo [INFO] Port 3000 is not listening.
exit /b 0

:stop_server
echo [INFO] Stopping dev server PID: %PORT_PID%
taskkill /PID %PORT_PID% /F >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Failed to stop PID %PORT_PID%.
    pause
    exit /b 1
)

if exist "%PID_FILE%" del /f /q "%PID_FILE%" >nul 2>nul
echo [INFO] Dev server stopped.
exit /b 0
