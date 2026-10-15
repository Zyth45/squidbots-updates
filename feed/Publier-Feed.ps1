<#
.SYNOPSIS
  Signe feed\feed.json (lien du repack complet, Discord, actualités, empreintes des repacks connus) avec la clé
  du projet et le publie sur la release GitHub « launcher ». Les launchers le relisent au démarrage puis toutes
  les 30 minutes.
.EXAMPLE
  .\Publier-Feed.ps1
#>
param(
  [string]$Cle = (Join-Path $PSScriptRoot '..\keys\squidbots-release.private.pem'),
  [string]$Depot = 'Zyth45/squidbots-updates'
)
$ErrorActionPreference = 'Stop'
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$sortie = Join-Path $env:TEMP 'squidbots-feed'
& $node (Join-Path $PSScriptRoot '..\tools\publish-feed.mjs') (Join-Path $PSScriptRoot 'feed.json') $sortie --key $Cle
if ($LASTEXITCODE -ne 0) { throw 'La signature a échoué : rien n''est publié.' }
# La signature d'abord, puis le feed : un launcher ne lit jamais un feed sans sa signature à jour.
gh release upload launcher --repo $Depot --clobber (Join-Path $sortie 'feed.json.sig')
gh release upload launcher --repo $Depot --clobber (Join-Path $sortie 'feed.json')
Write-Host 'Feed publié : https://github.com/Zyth45/squidbots-updates/releases/download/launcher/feed.json' -ForegroundColor Green
