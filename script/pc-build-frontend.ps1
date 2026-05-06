#requires -version 5.1
<#
.SYNOPSIS
  Builda il frontend per la PROD e prepara un tarball pronto da scp-are.

.DESCRIPTION
  Va eseguito SUL TUO PC, dal root del progetto. Fa:
    1) imposta VITE_API_URL al dominio di prod
    2) npm run build dentro frontend/
    3) verifica che dist/assets/*.js NON contenga "localhost:8000"
       (errore silenzioso piu' comune: si dimentica VITE_API_URL e il
        sito buildato chiama localhost in browser, sembra ok ma esplode)
    4) crea frontend-dist.tgz nel root del progetto
    5) stampa il comando scp pronto da incollare

.PARAMETER ApiUrl
  URL del backend in prod. Default: https://hub.parametricomparison.unimore.it

.PARAMETER VmUser
  Utente SSH della VM (per il suggerimento scp). Default: gb.

.PARAMETER VmHost
  Host della VM. Default: hub.parametricomparison.unimore.it.

.PARAMETER RemoteDir
  Cartella del progetto sulla VM. Default: /opt/pcm-hub.

.EXAMPLE
  .\script\pc-build-frontend.ps1
#>
param(
  [string]$ApiUrl    = 'https://hub.parametricomparison.unimore.it',
  [string]$VmUser    = 'gb',
  [string]$VmHost    = 'hub.parametricomparison.unimore.it',
  [string]$RemoteDir = '/opt/pcm-hub'
)

$ErrorActionPreference = 'Stop'

# Si suppone di lanciare lo script dalla cartella radice del progetto
# (quella con docker-compose.prod.yml). Verifichiamolo.
$projectRoot = Get-Location
if (-not (Test-Path (Join-Path $projectRoot 'docker-compose.prod.yml'))) {
    Write-Error "Esegui lo script dalla radice del progetto pcm-hub (dove sta docker-compose.prod.yml)."
    exit 1
}

$frontendDir = Join-Path $projectRoot 'frontend'
if (-not (Test-Path $frontendDir)) {
    Write-Error "Cartella frontend/ non trovata."
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm non e' nel PATH. Installa Node.js."
    exit 1
}

Write-Host "[build] VITE_API_URL = $ApiUrl"
$env:VITE_API_URL = $ApiUrl

Push-Location $frontendDir
try {
    if (-not (Test-Path 'node_modules')) {
        Write-Host "[build] node_modules mancante, eseguo npm install..."
        & npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install fallito (exit $LASTEXITCODE)" }
    }

    Write-Host "[build] npm run build..."
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build fallito (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
    Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
}

$distDir = Join-Path $frontendDir 'dist'
if (-not (Test-Path $distDir)) {
    Write-Error "frontend/dist non e' stato creato. Build fallita silenziosamente?"
    exit 1
}

# Controllo critico: niente "localhost:8000" nel bundle JS.
Write-Host "[build] verifico che 'localhost:8000' non sia nel bundle..."
$assetsDir = Join-Path $distDir 'assets'
if (Test-Path $assetsDir) {
    $hits = Select-String -Path (Join-Path $assetsDir '*.js') -Pattern 'localhost:8000' -SimpleMatch -ErrorAction SilentlyContinue
    if ($hits) {
        Write-Host ""
        Write-Host "[build] ERRORE: 'localhost:8000' trovato nel bundle." -ForegroundColor Red
        Write-Host "        VITE_API_URL non e' stata applicata correttamente." -ForegroundColor Red
        Write-Host "        File:" -ForegroundColor Red
        $hits | Select-Object -First 5 -ExpandProperty Path -Unique | ForEach-Object { Write-Host "          $_" -ForegroundColor Red }
        exit 2
    }
}
Write-Host "[build] check OK: niente localhost:8000 nei JS." -ForegroundColor Green

# Tarball: tar e' incluso in Windows 10+ ($env:windir\System32\tar.exe).
# Su versioni vecchie usa Compress-Archive (zip), funziona ugualmente con
# scp + unzip sulla VM, ma il comando di estrazione cambia.
$tarball = Join-Path $projectRoot 'frontend-dist.tgz'
Write-Host "[build] creo $tarball..."
if (Test-Path $tarball) { Remove-Item $tarball }
Push-Location $frontendDir
try {
    & tar czf $tarball dist
    if ($LASTEXITCODE -ne 0) { throw "tar fallito (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

$size = (Get-Item $tarball).Length
$sizeKb = [math]::Round($size / 1KB, 1)
Write-Host ""
Write-Host "[build] Pronto. $tarball ($sizeKb KB)" -ForegroundColor Green
Write-Host ""
Write-Host "Per il deploy sulla VM:" -ForegroundColor Cyan
Write-Host "  scp frontend-dist.tgz ${VmUser}@${VmHost}:${RemoteDir}/" -ForegroundColor Cyan
Write-Host "  ssh ${VmUser}@${VmHost} 'cd ${RemoteDir} && rm -rf frontend/dist && tar xzf frontend-dist.tgz -C frontend && docker compose -f docker-compose.prod.yml restart caddy'" -ForegroundColor Cyan
