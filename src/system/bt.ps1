# Batterie Bluetooth, in un processo a parte: Get-PnpDevice a volte si blocca per decine di secondi
# e non deve fermare il resto di Unico. Solo letture: al dispositivo non viene mandato niente.
$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
function Get-BtBattery {
  $out = New-Object System.Collections.ArrayList
  $devs = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'BTH*' }
  foreach ($d in $devs) {
    try {
      $b = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction Stop).Data
      if ($null -eq $b) { continue }
      $c = $null
      try { $c = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{83DA6326-97A6-4088-9453-A1923F573B29} 15' -ErrorAction Stop).Data } catch {}
      [void]$out.Add(@{ name = $d.FriendlyName; battery = [int]$b; cls = $d.Class; connected = $c })
    } catch {}
  }
  return ,$out.ToArray()
}


$r = Get-BtBattery
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @($r) -Depth 4 -Compress))
