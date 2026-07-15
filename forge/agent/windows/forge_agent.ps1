<#
.SYNOPSIS
  Forge RMM Windows agent — enroll, heartbeat, inventory, remote jobs.

.EXAMPLE
  .\forge_agent.ps1 enroll -Server http://forge:8787 -Key frg_xxx
  .\forge_agent.ps1 run
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('enroll', 'run', 'heartbeat', 'inventory', 'info')]
  [string]$Command = 'run',

  [string]$Server,
  [string]$Key,
  [string]$ConfigPath = $(Join-Path $env:ProgramData 'ForgeAgent\config.json')
)

$ErrorActionPreference = 'Stop'
$AgentVersion = '0.1.0'

function Get-ForgeConfig {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { return $null }
  return Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
}

function Save-ForgeConfig([object]$Cfg) {
  $dir = Split-Path -Parent $ConfigPath
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  ($Cfg | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
}

function Invoke-ForgeApi {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )
  $hdrs = @{
    'Content-Type' = 'application/json'
    'User-Agent'   = "forge-agent-windows/$AgentVersion"
  }
  foreach ($k in $Headers.Keys) { $hdrs[$k] = $Headers[$k] }
  $params = @{
    Method      = $Method
    Uri         = $Url
    Headers     = $hdrs
    TimeoutSec  = 60
  }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
  }
  try {
    return Invoke-RestMethod @params
  } catch {
    $msg = $_.Exception.Message
    if ($_.ErrorDetails.Message) { $msg = $_.ErrorDetails.Message }
    throw "Forge API error calling $Url : $msg"
  }
}

function Get-PrimaryIPv4 {
  try {
    $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
      Select-Object -First 1 -ExpandProperty IPAddress
    if ($addr) { return $addr }
  } catch {}
  try {
    return [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
      Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.ToString() -notlike '127.*' } |
      Select-Object -First 1 -ExpandProperty IPAddressToString
  } catch { return '' }
}

function Get-SystemInventory {
  $os = Get-CimInstance Win32_OperatingSystem
  $cs = Get-CimInstance Win32_ComputerSystem
  $bios = Get-CimInstance Win32_BIOS
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction SilentlyContinue

  $ramGb = [math]::Round(($cs.TotalPhysicalMemory / 1GB), 2)
  $memUsed = $null
  if ($os.TotalVisibleMemorySize -gt 0) {
    $memUsed = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 1)
  }

  $diskTotal = 0
  $diskFree = 0
  if ($disk) {
    $diskTotal = [math]::Round(($disk.Size / 1GB), 2)
    $diskFree = [math]::Round(($disk.FreeSpace / 1GB), 2)
  }

  $uptime = 0
  if ($os.LastBootUpTime) {
    $uptime = [int]((Get-Date) - [DateTime]$os.LastBootUpTime).TotalSeconds
  }

  return [ordered]@{
    hostname         = $env:COMPUTERNAME
    platform         = 'windows'
    os_name          = $os.Caption
    os_version       = $os.Version
    agent_version    = $AgentVersion
    logged_in_user   = $env:USERNAME
    cpu_cores        = [int]$cpu.NumberOfLogicalProcessors
    cpu_model        = [string]$cpu.Name
    manufacturer     = [string]$cs.Manufacturer
    model            = [string]$cs.Model
    serial_number    = [string]$bios.SerialNumber
    ip_address       = Get-PrimaryIPv4
    mac_address      = ''
    ram_gb           = $ramGb
    disk_total_gb    = $diskTotal
    disk_free_gb     = $diskFree
    uptime_seconds   = $uptime
    mem_used_pct     = $memUsed
    cpu_pct          = $null
    metadata         = @{
      domain     = [string]$cs.Domain
      powershell = $PSVersionTable.PSVersion.ToString()
    }
  }
}

function Get-SoftwareInventory {
  $paths = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $apps = @()
  foreach ($path in $paths) {
    Get-ItemProperty $path -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName } |
      ForEach-Object {
        $apps += [ordered]@{
          name         = [string]$_.DisplayName
          version      = [string]$_.DisplayVersion
          publisher    = [string]$_.Publisher
          install_date = [string]$_.InstallDate
        }
      }
  }
  return $apps | Sort-Object name -Unique | Select-Object -First 2000
}

function Invoke-ForgeJob([object]$Job) {
  $payload = [string]$Job.payload
  $shell = ([string]$Job.shell).ToLowerInvariant()
  if (-not $shell -or $shell -eq 'auto') { $shell = 'powershell' }
  $timeout = 300
  if ($Job.timeout_seconds) { $timeout = [int]$Job.timeout_seconds }

  $tmp = Join-Path $env:TEMP ("forge-job-" + $Job.id + ".ps1")
  try {
    if ($shell -eq 'cmd') {
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = 'cmd.exe'
      $psi.Arguments = "/c $payload"
      $psi.RedirectStandardOutput = $true
      $psi.RedirectStandardError = $true
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true
      $p = [System.Diagnostics.Process]::Start($psi)
      if (-not $p.WaitForExit($timeout * 1000)) {
        try { $p.Kill() } catch {}
        return @{ exit_code = 124; stdout = ''; stderr = "Job timed out after ${timeout}s"; status = 'failed' }
      }
      return @{
        exit_code = $p.ExitCode
        stdout    = $p.StandardOutput.ReadToEnd()
        stderr    = $p.StandardError.ReadToEnd()
        status    = $(if ($p.ExitCode -eq 0) { 'succeeded' } else { 'failed' })
      }
    }

    Set-Content -LiteralPath $tmp -Value $payload -Encoding UTF8
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp 2>&1
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
    $text = ($out | Out-String)
    return @{
      exit_code = [int]$code
      stdout    = $text
      stderr    = ''
      status    = $(if ($code -eq 0) { 'succeeded' } else { 'failed' })
    }
  } catch {
    return @{
      exit_code = 1
      stdout    = ''
      stderr    = $_.Exception.Message
      status    = 'failed'
    }
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
}

function Get-AgentHeaders([object]$Cfg) {
  return @{
    'X-Device-Id'    = $Cfg.device_id
    'X-Device-Token' = $Cfg.device_token
  }
}

function Invoke-Enroll {
  if (-not $Server -or -not $Key) {
    throw 'enroll requires -Server and -Key'
  }
  $sys = Get-SystemInventory
  $result = Invoke-ForgeApi -Method POST -Url ($Server.TrimEnd('/') + '/api/v1/agent/enroll') -Body @{
    enrollment_key = $Key
    hostname       = $sys.hostname
    platform       = 'windows'
    os_name        = $sys.os_name
    os_version     = $sys.os_version
    agent_version  = $AgentVersion
  }
  $cfg = [ordered]@{
    server_url             = $Server.TrimEnd('/')
    device_id              = $result.device_id
    device_token           = $result.device_token
    site_id                = $result.site_id
    poll_interval_seconds  = $(if ($result.poll_interval_seconds) { $result.poll_interval_seconds } else { 30 })
  }
  Save-ForgeConfig $cfg
  Write-Host "Enrolled as $($cfg.device_id) ($($sys.hostname))"
  return $cfg
}

function Invoke-Heartbeat([object]$Cfg) {
  $sys = Get-SystemInventory
  return Invoke-ForgeApi -Method POST `
    -Url ($Cfg.server_url + '/api/v1/agent/heartbeat') `
    -Headers (Get-AgentHeaders $Cfg) `
    -Body $sys
}

function Invoke-InventoryPush([object]$Cfg) {
  $software = @(Get-SoftwareInventory)
  Invoke-ForgeApi -Method POST `
    -Url ($Cfg.server_url + '/api/v1/agent/inventory') `
    -Headers (Get-AgentHeaders $Cfg) `
    -Body @{ software = $software } | Out-Null
  Write-Host "Inventory reported ($($software.Count) packages)"
}

function Start-AgentLoop([object]$Cfg) {
  Write-Host "Forge Windows agent running — device $($Cfg.device_id)"
  Write-Host "Server: $($Cfg.server_url)"
  $ticks = 0
  while ($true) {
    try {
      $resp = Invoke-Heartbeat $Cfg
      foreach ($job in @($resp.jobs)) {
        Write-Host "Running job $($job.id): $($job.title)"
        $result = Invoke-ForgeJob $job
        Invoke-ForgeApi -Method POST `
          -Url ($Cfg.server_url + '/api/v1/agent/jobs/' + $job.id + '/result') `
          -Headers (Get-AgentHeaders $Cfg) `
          -Body $result | Out-Null
        Write-Host "  -> $($result.status) (exit $($result.exit_code))"
      }
      if (($ticks % 10) -eq 0) { Invoke-InventoryPush $Cfg }
      $interval = 30
      if ($resp.poll_interval_seconds) { $interval = [int]$resp.poll_interval_seconds }
    } catch {
      Write-Warning $_.Exception.Message
      $interval = 30
    }
    $ticks++
    Start-Sleep -Seconds $interval
  }
}

switch ($Command) {
  'info' {
    Get-SystemInventory | ConvertTo-Json -Depth 6
  }
  'enroll' {
    Invoke-Enroll | Out-Null
  }
  'heartbeat' {
    $cfg = Get-ForgeConfig
    if (-not $cfg) { throw 'Not enrolled. Run enroll first.' }
    Invoke-Heartbeat $cfg | ConvertTo-Json -Depth 6
  }
  'inventory' {
    $cfg = Get-ForgeConfig
    if (-not $cfg) { throw 'Not enrolled. Run enroll first.' }
    Invoke-InventoryPush $cfg
  }
  'run' {
    $cfg = Get-ForgeConfig
    if (-not $cfg) { throw 'Not enrolled. Run enroll first.' }
    Start-AgentLoop $cfg
  }
}
