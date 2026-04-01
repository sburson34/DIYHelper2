@echo off
echo Setting up USB port forwarding for backend (port 5206)...
where adb >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: 'adb' command not found. Please ensure Android SDK Platform-Tools are installed and in your PATH.
    exit /b 1
)
adb reverse tcp:5206 tcp:5206
if %errorlevel% == 0 (
    echo Success! Your phone can now access the backend at http://localhost:5206
    echo Make sure your phone is connected via USB and USB Debugging is ON.
) else (
    echo Error: Could not run adb reverse. Is your phone connected via USB with Debugging enabled?
)
