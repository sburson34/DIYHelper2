# This script routes the phone's port 5206 to your computer's port 5206 via USB.
# This bypasses the Windows Firewall and local IP issues.

Write-Host "Setting up USB port forwarding for backend (port 5206)..." -ForegroundColor Cyan

# Check if adb is in path
if (Get-Command "adb" -ErrorAction SilentlyContinue) {
    adb reverse tcp:5206 tcp:5206
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Success! Your phone can now access the backend at http://localhost:5206" -ForegroundColor Green
        Write-Host "Make sure your phone is connected via USB and USB Debugging is ON." -ForegroundColor Yellow
    } else {
        Write-Host "Error: Could not run adb reverse. Is your phone connected via USB with Debugging enabled?" -ForegroundColor Red
    }
} else {
    Write-Host "Error: 'adb' command not found. Please ensure Android SDK Platform-Tools are installed and in your PATH." -ForegroundColor Red
}
