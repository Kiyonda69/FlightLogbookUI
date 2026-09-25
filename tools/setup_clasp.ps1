<#
  setup_clasp.ps1 — prepare clasp on a new machine (Windows PowerShell 5.1+).

    powershell -ExecutionPolicy Bypass -File tools\setup_clasp.ps1

  1. checks Node.js / npm, installs @google/clasp (v3) globally when missing
  2. creates .clasp.json from .clasp.json.example (scriptId of the logbook's bound Apps Script project)
  3. runs `clasp login` when ~/.clasprc.json is missing (browser: allow with the spreadsheet owner's account)
  4. prints `clasp status` — all 15 files under src/ must be listed as "Tracked"

  One-time account setting (cannot be scripted): https://script.google.com/home/usersettings
  → turn "Google Apps Script API" ON, otherwise push / deploy are rejected.

  Claude desktop (MSIX) note: `npm install -g` run by Claude inside the app is redirected to
  %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\npm and is invisible to your own terminal.
  Run this script in your own terminal (or accept that only Claude's shell sees that copy).
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
# pick up tools installed after this terminal was opened
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'Node.js (npm) がありません。先に入れてください: winget install OpenJS.NodeJS.LTS'
}

$clasp = Join-Path $env:APPDATA 'npm\clasp.cmd'
if (-not (Test-Path $clasp)) {
  Write-Host 'clasp をインストールします (npm install -g @google/clasp@3)...'
  npm install -g '@google/clasp@3'
  if (-not (Test-Path $clasp)) { throw "clasp のインストール先が見つかりません: $clasp" }
}
Write-Host ('clasp ' + (& $clasp --version))

if (-not (Test-Path '.clasp.json')) {
  Copy-Item '.clasp.json.example' '.clasp.json'
  Write-Host '.clasp.json を作成しました (.clasp.json.example から)'
}

if (-not (Test-Path (Join-Path $env:USERPROFILE '.clasprc.json'))) {
  Write-Host 'Google にログインします。ブラウザでスプレッドシートの持ち主のアカウント (kiyonda69@gmail.com) で許可してください。'
  & $clasp login
}

Write-Host "`n--- clasp status (src/ の 15 ファイルが Tracked に並ぶこと) ---"
& $clasp status
Write-Host "`n準備完了。反映は tools\clasp_deploy.ps1 (push + Pages 用デプロイ更新)。"
