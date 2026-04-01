# Check if port 5206 is already in use
$port = 5206
$portUsed = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

if ($portUsed) {
    Write-Host "Backend is already running on port $port. Skipping startup."
    exit 0
}

Write-Host "Starting Backend..."
# Move to the backend directory relative to the script location
Set-Location -Path "$PSScriptRoot\backend\DIYHelper2.Api"
dotnet run --launch-profile external
