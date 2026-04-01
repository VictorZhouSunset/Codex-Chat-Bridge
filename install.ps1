$repoRoot = $PSScriptRoot
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$bridgeSource = Join-Path $repoRoot 'bridge'
$bridgeTarget = Join-Path $codexHome 'telegram-bridge'
$skillSource = Join-Path $repoRoot 'skill\telegram-handoff'
$skillTarget = Join-Path $codexHome 'skills\telegram-handoff'

New-Item -ItemType Directory -Force $bridgeTarget | Out-Null
New-Item -ItemType Directory -Force $skillTarget | Out-Null

Remove-Item -Recurse -Force (Join-Path $bridgeTarget 'src') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $bridgeTarget 'tests') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $bridgeTarget 'tray-companion') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $skillTarget 'agents') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $skillTarget 'references') -ErrorAction SilentlyContinue

Copy-Item -Recurse -Force (Join-Path $bridgeSource 'src') (Join-Path $bridgeTarget 'src')
Copy-Item -Recurse -Force (Join-Path $bridgeSource 'tests') (Join-Path $bridgeTarget 'tests')
Copy-Item -Recurse -Force (Join-Path $bridgeSource 'tray-companion') (Join-Path $bridgeTarget 'tray-companion')
Copy-Item -Force (Join-Path $bridgeSource 'package.json') $bridgeTarget
Copy-Item -Force (Join-Path $bridgeSource 'config.example.json') $bridgeTarget
Copy-Item -Force (Join-Path $bridgeSource 'start-telegram-bridge.ps1') $bridgeTarget
Copy-Item -Force (Join-Path $bridgeSource 'start-telegram-bridge.sh') $bridgeTarget
Copy-Item -Force (Join-Path $bridgeSource 'stop-telegram-bridge.ps1') $bridgeTarget
Copy-Item -Force (Join-Path $bridgeSource 'stop-telegram-bridge.sh') $bridgeTarget
Copy-Item -Force (Join-Path $bridgeSource 'status-telegram-bridge.ps1') $bridgeTarget
Copy-Item -Force (Join-Path $bridgeSource 'status-telegram-bridge.sh') $bridgeTarget

if (-not (Test-Path (Join-Path $bridgeTarget 'config.json'))) {
  Copy-Item -Force (Join-Path $bridgeSource 'config.example.json') (Join-Path $bridgeTarget 'config.json')
}

Copy-Item -Recurse -Force (Join-Path $skillSource 'agents') (Join-Path $skillTarget 'agents')
Copy-Item -Recurse -Force (Join-Path $skillSource 'references') (Join-Path $skillTarget 'references')
Copy-Item -Force (Join-Path $skillSource 'SKILL.md') $skillTarget

Write-Host "Installed bridge to $bridgeTarget"
Write-Host "Installed skill to $skillTarget"
Write-Host "If this is your first install, edit $(Join-Path $bridgeTarget 'config.json') before attaching a thread."
