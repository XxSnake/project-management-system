@echo off
chcp 65001 >nul

echo ================================
echo  工程检测项目管理系统 - 停止
echo ================================

:: 查找并终止 node 在 3000 端口的进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo 正在终止进程 PID: %%a
    taskkill /PID %%a /F >nul 2>&1
)

echo 服务已停止。
timeout /t 2 >nul
