# =========================
# Build Frontend
# =========================
Write-Host "Building frontend..." -ForegroundColor Cyan
Set-Location frontend
npm run build

# =========================
# Copy build to backend
# =========================
Set-Location ..

$frontendDist = "frontend\dist"
$backendDist = "backend\frontend_dist"

Write-Host "Updating backend frontend_dist..." -ForegroundColor Cyan

# Ordner löschen, falls vorhanden
if (Test-Path $backendDist) {
    Remove-Item $backendDist -Recurse -Force
}

# Neu anlegen
New-Item -ItemType Directory -Path $backendDist | Out-Null

# Dateien kopieren
Copy-Item "$frontendDist\*" $backendDist -Recurse -Force

# =========================
# Start backend
# =========================
Write-Host "Starting backend..." -ForegroundColor Green
Set-Location backend
.\.venv\Scripts\Activate.ps1
python main.py
