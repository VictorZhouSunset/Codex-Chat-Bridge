$bridgeRoot = $PSScriptRoot
node (Join-Path $bridgeRoot 'src\cli.mjs') stop-service
