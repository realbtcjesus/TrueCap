@echo off
chcp 65001 >nul
title TrueCap (demo)
cd /d "%~dp0"
where node >nul 2>nul || goto nonode
echo Starting TrueCap with DEMO data...
set MOCK=1
set OPEN=1
node server.js
pause
exit /b
:nonode
echo.
echo Node.js is not installed yet. Your browser will open the download page.
echo Click the big "LTS" download button, run the installer with all the default choices,
echo then double-click this file again.
echo.
start "" https://nodejs.org/en/download
pause
