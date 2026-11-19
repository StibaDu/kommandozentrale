@echo off
setlocal
cd /d "%~dp0"
set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "%BUN%" set "BUN=bun"
set "OPENCODE_DB=%USERPROFILE%\.local\share\opencode\opencode.db"
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  start "Kommandozentrale" /min "%BUN%" run start
  timeout /t 8 /nobreak >nul
)
start "" "http://localhost:4173"
endlocal
