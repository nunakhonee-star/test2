@echo off
where node >nul 2>nul
if errorlevel 1 (
 echo Please install Node.js 24 LTS, then open this file again.
 pause
 exit /b 1
)
node "%~dp0scripts\local-preview.mjs"
if errorlevel 1 pause
