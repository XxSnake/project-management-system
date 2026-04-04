@echo off
pause
chcp 65001
title Project Management System
echo ================================
echo  Starting...
echo ================================
cd /d "%~dp0src"
echo Current dir: %cd%
where npm
if errorlevel 1 (
    echo npm not found!
    pause
    exit /b 1
)
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
)
echo Generating Prisma Client...
call npx prisma generate
echo Starting dev server on http://localhost:3000
call npm run dev
pause
