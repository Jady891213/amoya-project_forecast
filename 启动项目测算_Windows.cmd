@echo off
chcp 65001 >nul
cd /d "%~dp0src"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo 未找到 pnpm，请先安装 Node.js 和 pnpm。
  pause
  exit /b 1
)

call pnpm start:local
if errorlevel 1 (
  echo.
  echo 项目测算服务启动失败，请查看上方错误信息。
  pause
)
