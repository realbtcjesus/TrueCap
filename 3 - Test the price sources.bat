@echo off
chcp 65001 >nul
title TrueCap source check
cd /d "%~dp0"
where node >nul 2>nul || goto nonode
echo Testing each price and supply source. This takes a few seconds...
echo.
set MOCK=
node server.js --check
echo.
echo Lines with a check mark worked. Lines with an X did not.
echo You can copy this windows text and paste it to Claude.
pause
exit /b
:nonode
echo Node.js is not installed yet. Install it first: https://nodejs.org/en/download
start "" https://nodejs.org/en/download
pause
