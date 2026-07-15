<#
.SYNOPSIS
  Silent installer for the Forge Windows agent.

  Downloads (or uses bundled) agent scripts, enrolls with the Forge server,
  and registers a scheduled task that runs at startup under SYSTEM.

.EXAMPLE
  # One-liner from Forge download link:
  irm http://forge:8787/download/windows-agent.ps1?key=frg_xxx | iex

.EXAMPLE
  .\install.ps1 -Server http://forge:8787 -Key frg_xxx -Silent
#>
[CmdletBinding()]
param(
  [string]$Server = $env:FORGE_SERVER,
  [string]$Key = $env:FORGE_KEY,
  [string]$InstallDir = $(Join-Path $env:ProgramFiles 'ForgeAgent'),
  [switch]$Silent,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'ForgeAgent'

function Write-Forge([string]$Message) {
  if (-not $Silent) { Write-Host $Message }
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($Uninstall) {
  if (-not (Test-Admin)) { throw 'Uninstall requires Administrator privileges.' }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  $cfgDir = Join-Path $env:ProgramData 'ForgeAgent'
  if (Test-Path -LiteralPath $cfgDir) {
    Remove-Item -LiteralPath $cfgDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Forge 'Forge agent uninstalled.'
  return
}

# Embedded/query defaults when served from Forge download endpoint
if (-not $Server -and $PSScriptRoot) {
  # no-op placeholder
}
if (-not $Server) { $Server = '__FORGE_SERVER__' }
if (-not $Key) { $Key = '__FORGE_KEY__' }

if ($Server -eq '__FORGE_SERVER__' -or [string]::IsNullOrWhiteSpace($Server)) {
  throw 'Missing -Server (or FORGE_SERVER). Use the download link from the Forge console.'
}
if ($Key -eq '__FORGE_KEY__' -or [string]::IsNullOrWhiteSpace($Key)) {
  throw 'Missing -Key (or FORGE_KEY). Use the enrollment key from the Forge console.'
}

if (-not (Test-Admin)) {
  throw 'Installer must run as Administrator for silent service registration.'
}

Write-Forge "Installing Forge agent into $InstallDir"
if (-not (Test-Path -LiteralPath $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$agentSource = Join-Path $PSScriptRoot 'forge_agent.ps1'
$agentDest = Join-Path $InstallDir 'forge_agent.ps1'

if (Test-Path -LiteralPath $agentSource) {
  Copy-Item -LiteralPath $agentSource -Destination $agentDest -Force
} else {
  # When invoked via irm|iex, $PSScriptRoot is empty — pull agent from same host
  $agentUrl = ($Server.TrimEnd('/') + '/download/forge_agent.ps1')
  Write-Forge "Downloading agent from $agentUrl"
  Invoke-WebRequest -Uri $agentUrl -OutFile $agentDest -UseBasicParsing
}

if (-not (Test-Path -LiteralPath $agentDest)) {
  throw 'forge_agent.ps1 was not installed.'
}

# Wrapper used by Task Scheduler
$runner = Join-Path $InstallDir 'run-agent.ps1'
@"
`$ErrorActionPreference = 'Stop'
& '$agentDest' run -ConfigPath (Join-Path `$env:ProgramData 'ForgeAgent\config.json')
"@ | Set-Content -LiteralPath $runner -Encoding UTF8

Write-Forge 'Enrolling with Forge server...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $agentDest enroll `
  -Server $Server -Key $Key `
  -ConfigPath (Join-Path $env:ProgramData 'ForgeAgent\config.json')

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument `
  "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

Write-Forge 'Forge Windows agent installed and started (scheduled task: ForgeAgent).'
Write-Forge "Config: $(Join-Path $env:ProgramData 'ForgeAgent\config.json')"
