# Batterie Bluetooth, in un processo a parte: Get-PnpDevice a volte si blocca per decine di secondi
# e non deve fermare il resto di Unico. Solo letture: al dispositivo non viene mandato niente.
$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
function Get-BtBattery {
  $out = New-Object System.Collections.ArrayList
  # solo i nodi dei dispositivi (non i loro servizi): BTHENUM\DEV_... e BTHLE\DEV_...
  $devs = @(Get-PnpDevice -PresentOnly -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^BTH(ENUM|LE)\\DEV_' })
  if (-not $devs.Count) { return ,$out.ToArray() }
  $keys = @('{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2', '{83DA6326-97A6-4088-9453-A1923F573B29} 15')
  $props = @(Get-PnpDeviceProperty -InstanceId ($devs | ForEach-Object { $_.InstanceId }) -KeyName $keys -ErrorAction SilentlyContinue)
  foreach ($d in $devs) {
    $mine = $props | Where-Object { $_.InstanceId -eq $d.InstanceId }
    $b = ($mine | Where-Object { $_.KeyName -eq $keys[0] }).Data
    if ($null -eq $b) { continue }
    $c = ($mine | Where-Object { $_.KeyName -eq $keys[1] }).Data
    [void]$out.Add(@{ name = $d.FriendlyName; battery = [int]$b; cls = $d.Class; connected = $c })
  }
  return ,$out.ToArray()
}

$r = Get-BtBattery
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @($r) -Depth 4 -Compress))
