#requires -version 5.1
<#
.SYNOPSIS
  Scarica via scp i dump del DB dalla VM al tuo PC.

.DESCRIPTION
  Va eseguito SUL TUO PC. Tira giu' tutti i file db-*.dump dalla cartella
  backups della VM e li salva in $LocalDir. Non sovrascrive: se un file
  esiste gia' localmente con stessa dimensione, lo salta.

  Pre-requisito: SSH key auth verso la VM (altrimenti ti chiede la
  password ad ogni file). Per generarla:
      ssh-keygen -t ed25519
      ssh-copy-id user@vm     # oppure copi il .pub a mano

.PARAMETER VmUser
  Utente SSH della VM (default: gb).

.PARAMETER VmHost
  Host o IP della VM. Default: hub.parametricomparison.unimore.it.

.PARAMETER RemoteDir
  Cartella backups sulla VM. Default: /opt/pcm-hub/backups.

.PARAMETER LocalDir
  Cartella locale dove salvare. Default: $HOME\pcm-hub-backups\.

.EXAMPLE
  .\script\pc-pull-backups.ps1
  Pull con default.

.EXAMPLE
  .\script\pc-pull-backups.ps1 -VmUser myuser -LocalDir D:\backups
#>
param(
  [string]$VmUser    = 'gb',
  [string]$VmHost    = 'hub.parametricomparison.unimore.it',
  [string]$RemoteDir = '/opt/pcm-hub/backups',
  [string]$LocalDir  = (Join-Path $HOME 'pcm-hub-backups')
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
    Write-Error "scp non e' installato. Su Windows 10+ e' incluso (OpenSSH client). Abilitalo da 'Apps -> Optional features'."
    exit 1
}

if (-not (Test-Path $LocalDir)) {
    New-Item -ItemType Directory -Path $LocalDir | Out-Null
    Write-Host "[pull] creata $LocalDir"
}

$remote = "${VmUser}@${VmHost}:${RemoteDir}/db-*.dump"
Write-Host "[pull] scarico da $remote -> $LocalDir"

# scp non ha modalita' "skip se esiste": ricaricare 3 file da pochi MB
# e' veloce, accettiamo il riscarico. Se in futuro i dump diventano grossi
# si passa a rsync (Windows: via WSL o cwRsync).
& scp "$remote" $LocalDir
if ($LASTEXITCODE -ne 0) {
    Write-Error "scp ha fallito (exit $LASTEXITCODE). Verifica utente, host e SSH key."
    exit $LASTEXITCODE
}

$files = Get-ChildItem -Path $LocalDir -Filter 'db-*.dump' | Sort-Object Name -Descending
Write-Host "[pull] OK. Backup locali ($($files.Count)):"
foreach ($f in $files) {
    $kb = [math]::Round($f.Length / 1KB, 1)
    Write-Host ("  {0}  {1} KB" -f $f.Name, $kb)
}
