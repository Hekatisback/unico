# Rileva da solo periferiche, audio, Bluetooth e programmi dei produttori, per adattare Unico a questo PC.
# Solo letture: non cambia niente e non manda comandi ai dispositivi.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File tools\rileva-periferiche.ps1 > periferiche.json
$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

function Get-VidPid([string]$id) {
  if ($id -match 'VID_([0-9A-F]{4}).*PID_([0-9A-F]{4})') { return ($Matches[1] + ':' + $Matches[2]).ToLower() }
  if ($id -match 'VID&0002([0-9A-F]{4})_PID&([0-9A-F]{4})') { return ($Matches[1] + ':' + $Matches[2]).ToLower() }
  return $null
}

# periferiche USB/Bluetooth presenti, raggruppate per VID:PID
$classes = @('HIDClass', 'Mouse', 'Keyboard', 'Media', 'AudioEndpoint', 'USB', 'Bluetooth')
$devs = Get-PnpDevice -PresentOnly | Where-Object { $classes -contains $_.Class }
$groups = @{}
foreach ($d in $devs) {
  $vp = Get-VidPid $d.InstanceId
  if (-not $vp) { continue }
  if (-not $groups.ContainsKey($vp)) { $groups[$vp] = @{ id = $vp; names = New-Object System.Collections.ArrayList; classes = New-Object System.Collections.ArrayList; manufacturer = $d.Manufacturer; bus = $null } }
  $g = $groups[$vp]
  $name = $d.FriendlyName
  try { $bus = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_BusReportedDeviceDesc').Data; if ($bus) { $g.bus = $bus } } catch {}
  if ($name -and -not $g.names.Contains($name)) { [void]$g.names.Add($name) }
  if (-not $g.classes.Contains($d.Class)) { [void]$g.classes.Add($d.Class) }
}

# uscite e microfoni audio
$audio = Get-PnpDevice -PresentOnly -Class AudioEndpoint | ForEach-Object { @{ name = $_.FriendlyName; flow = if ($_.InstanceId -like 'SWD\MMDEVAPI\?0.0.1*') { 'microfono' } else { 'uscita' } } }

# dispositivi Bluetooth associati con batteria letta da Windows
$bt = @()
$btDevs = @(Get-PnpDevice -PresentOnly -Class Bluetooth | Where-Object { $_.InstanceId -match '^BTH(ENUM|LE)\\DEV_' })
foreach ($d in $btDevs) {
  $b = $null
  try { $b = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2').Data } catch {}
  $bt += @{ name = $d.FriendlyName; battery = $b }
}

# programmi dei produttori: installati e aperti (Unico deve farsi da parte quando sono aperti)
$known = [ordered]@{
  'Corsair iCUE' = @('iCUE'); 'Razer Synapse' = @('Razer Synapse', 'RazerAppEngine', 'Razer Synapse 3'); 'Logitech G HUB' = @('lghub', 'lghub_agent');
  'SteelSeries GG' = @('SteelSeriesGG', 'SteelSeriesEngine'); 'HyperX NGENUITY' = @('NGenuity2', 'NGENUITY'); 'ASUS Armoury Crate' = @('ArmouryCrate', 'ArmouryCrateControlInterface');
  'Wooting' = @('wootility'); 'Glorious Core' = @('Glorious Core'); 'Roccat/Turtle Beach Swarm' = @('Swarm', 'ROCCAT_Swarm'); 'SignalRGB' = @('SignalRgb'); 'OpenRGB' = @('OpenRGB')
}
$procs = Get-Process | Select-Object -ExpandProperty ProcessName
$uninstall = @(Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object { $_.DisplayName } | Select-Object -ExpandProperty DisplayName)
$software = @()
foreach ($k in $known.Keys) {
  $running = @($known[$k] | Where-Object { $procs -contains $_ }).Count -gt 0
  $word = ($k -split ' ')[-1]
  $installed = @($uninstall | Where-Object { $_ -like "*$word*" -or $_ -like "*$k*" })
  if ($running -or $installed.Count) { $software += @{ name = $k; running = $running; installed = $installed } }
}

$out = [ordered]@{
  pc = @{ windows = (Get-CimInstance Win32_OperatingSystem).Caption; build = [Environment]::OSVersion.Version.Build; model = (Get-CimInstance Win32_ComputerSystem).Model }
  devices = @($groups.Values | Sort-Object { $_.id })
  audio = @($audio)
  bluetooth = @($bt)
  vendorSoftware = @($software)
  equalizerApo = (Test-Path "$env:ProgramFiles\EqualizerAPO\config\config.txt")
}
$out | ConvertTo-Json -Depth 6
