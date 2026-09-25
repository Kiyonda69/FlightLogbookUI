<#
  clasp_deploy.ps1 — publish src/ to the logbook's Apps Script project.

    powershell -ExecutionPolicy Bypass -File tools\clasp_deploy.ps1 [-Description "..."] [-PushOnly]

  1. clasp push --force   (--force: clasp 3 otherwise asks about appsscript.json and, without a
                           terminal to answer, prints "Skipping push." and sends nothing)
  2. clasp deploy -i <id> (the Pages deployment, taken from pages.config.json's apiUrl) so the
                           GitHub Pages UI's /exec URL serves the new code — the URL itself stays the same.

  After `push` alone the spreadsheet (menu, onEdit) and the HtmlService UI already run the new code;
  the Pages UI keeps the old version until step 2. Roll back with:
    clasp deploy -i <id> -V <older version number>     (versions: clasp versions)
  Run tools\setup_clasp.ps1 once per machine first.
#>
param([string]$Description = '', [switch]$PushOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$clasp = Join-Path $env:APPDATA 'npm\clasp.cmd'
if (-not (Test-Path $clasp) -or -not (Test-Path '.clasp.json')) { throw '先に tools\setup_clasp.ps1 を実行してください' }

& $clasp push --force
if ($LASTEXITCODE -ne 0) { throw 'clasp push に失敗しました' }
if ($PushOnly) { return }

$api = (Get-Content 'pages.config.json' -Raw | ConvertFrom-Json).apiUrl
if ($api -notmatch '/macros/s/([^/]+)/exec') { throw "pages.config.json の apiUrl からデプロイ ID を取れません: $api" }
$id = $Matches[1]
if (-not $Description) { $Description = 'git ' + (git rev-parse --short HEAD) }
& $clasp deploy -i $id -d $Description
if ($LASTEXITCODE -ne 0) { throw 'clasp deploy に失敗しました' }
& $clasp deployments
