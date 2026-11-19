@echo off
setlocal
cd /d "%~dp0"
set "BUN=%~dp0runtime\bun.exe"
if not exist "%BUN%" set "BUN=bun"
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  start "Kommandozentrale" /min "%BUN%" "src\server.ts"
  timeout /t 8 /nobreak >nul
)
start "" "http://localhost:4173"
endlocal
