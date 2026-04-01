@echo off
set PORT=5206
netstat -ano | findstr :%PORT% | findstr LISTENING > nul
if %errorlevel% equ 0 (
    echo Backend is already running on port %PORT%. Skipping startup.
    exit /b 0
)

echo Starting Backend...
cd /d "%~dp0backend\DIYHelper2.Api"
dotnet run --launch-profile external
