# Unico - helper di sistema (Windows PowerShell 5.1).
# Legge una richiesta JSON per riga da stdin e risponde con una riga JSON: {"id":..,"ok":true,"data":..}
# Ogni comando e' isolato in try/catch: un errore non ferma l'helper.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$script:descCache = @{}
. (Join-Path $PSScriptRoot 'audio.ps1')
$script:media = $null
$script:thumbCache = @{}

function Send-Reply($id, $ok, $data) {
  $o = @{ id = $id; ok = $ok; data = $data }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Depth 6 -Compress))
  [Console]::Out.Flush()
}

# ---------------------------------------------------------------- campionamento
function Get-Sample {
  $disk = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
  $nets = @(Get-CimInstance -ClassName Win32_PerfFormattedData_Tcpip_NetworkInterface)
  $rx = 0; $tx = 0
  foreach ($n in $nets) { $rx += [double]$n.BytesReceivedPersec; $tx += [double]$n.BytesSentPersec }
  $temp = $null
  try {
    $z = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature)
    if ($z.Count -gt 0) { $temp = [math]::Round(($z[0].CurrentTemperature / 10) - 273.15, 1) }
  } catch { $temp = $null }
  $bat = $null
  try {
    $b = Get-CimInstance -ClassName Win32_Battery | Select-Object -First 1
    if ($b) { $bat = @{ percent = [int]$b.EstimatedChargeRemaining; status = [int]$b.BatteryStatus } }
  } catch { $bat = $null }
  return @{
    diskRead = [double]$disk.DiskReadBytesPersec
    diskWrite = [double]$disk.DiskWriteBytesPersec
    diskBusy = [double]$disk.PercentDiskTime
    netRx = $rx
    netTx = $tx
    cpuTemp = $temp
    battery = $bat
  }
}

# ---------------------------------------------------------------- processi
function Get-Procs {
  $cores = [Environment]::ProcessorCount
  $perf = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfProc_Process
  $paths = @{}
  foreach ($p in (Get-Process)) {
    try { if ($p.Path) { $paths[[int]$p.Id] = $p.Path } } catch {}
  }
  $list = New-Object System.Collections.ArrayList
  foreach ($p in $perf) {
    if ($p.Name -eq '_Total' -or $p.Name -eq 'Idle') { continue }
    $id = [int]$p.IDProcess
    $base = ($p.Name -replace '#\d+$', '')
    $path = $paths[$id]
    $desc = $null
    if ($path) {
      if ($script:descCache.ContainsKey($path)) { $desc = $script:descCache[$path] }
      else {
        try { $desc = (Get-Item -LiteralPath $path).VersionInfo.FileDescription } catch { $desc = $null }
        $script:descCache[$path] = $desc
      }
    }
    [void]$list.Add(@{
      pid = $id
      name = $base
      desc = $desc
      path = $path
      cpu = [math]::Round([double]$p.PercentProcessorTime / $cores, 1)
      mem = [double]$p.WorkingSetPrivate
      io = [double]$p.IODataBytesPersec
    })
  }
  return $list
}

function Stop-Pids($pids) {
  $failed = New-Object System.Collections.ArrayList
  foreach ($id in $pids) {
    try { Stop-Process -Id ([int]$id) -Force -ErrorAction Stop } catch { [void]$failed.Add([int]$id) }
  }
  return @{ failed = $failed }
}

function Close-Names($names) {
  $closed = 0
  foreach ($n in $names) {
    foreach ($p in @(Get-Process -Name $n -ErrorAction SilentlyContinue)) {
      try {
        if ($p.MainWindowHandle -ne [IntPtr]::Zero) { [void]$p.CloseMainWindow(); Start-Sleep -Milliseconds 800 }
        if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
        $closed++
      } catch {}
    }
  }
  return @{ closed = $closed }
}

function Get-ProcNames {
  return @(Get-Process | ForEach-Object { $_.ProcessName } | Sort-Object -Unique)
}

# ---------------------------------------------------------------- pulizia
function Get-FolderSize($path) {
  if (-not (Test-Path -LiteralPath $path)) { return 0 }
  $s = (Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  if ($s) { return [double]$s } else { return 0 }
}

function Get-RecycleSize {
  $shell = New-Object -ComObject Shell.Application
  $bin = $shell.Namespace(10)
  $total = 0; $count = 0
  foreach ($item in $bin.Items()) {
    $count++
    try { $total += [double]$item.Size } catch {}
  }
  return @{ count = $count; bytes = $total }
}

function Get-CleanupScan($downloads) {
  $big = @(Get-ChildItem -LiteralPath $downloads -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -gt 100MB } | Sort-Object Length -Descending | Select-Object -First 40 |
    ForEach-Object { @{ path = $_.FullName; name = $_.Name; bytes = [double]$_.Length; modified = $_.LastWriteTime.ToString('s') } })
  return @{
    temp = Get-FolderSize $env:TEMP
    crash = Get-FolderSize (Join-Path $env:LOCALAPPDATA 'CrashDumps')
    downloads = Get-FolderSize $downloads
    recycle = Get-RecycleSize
    big = $big
  }
}

function Clear-Temp {
  $before = (Get-FolderSize $env:TEMP) + (Get-FolderSize (Join-Path $env:LOCALAPPDATA 'CrashDumps'))
  $limit = (Get-Date).AddDays(-2)
  foreach ($d in @($env:TEMP, (Join-Path $env:LOCALAPPDATA 'CrashDumps'))) {
    if (Test-Path -LiteralPath $d) {
      Get-ChildItem -LiteralPath $d -Force -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $limit } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  $after = (Get-FolderSize $env:TEMP) + (Get-FolderSize (Join-Path $env:LOCALAPPDATA 'CrashDumps'))
  return @{ freed = [math]::Max(0, $before - $after) }
}

# ---------------------------------------------------------------- rete
function Get-Gateway {
  $r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
  if ($r) { return [string]$r.NextHop } else { return $null }
}

function Get-WifiInfo {
  $out = (netsh wlan show interfaces) -join "`n"
  return @{ raw = $out }
}

# ---------------------------------------------------------------- musica (Windows Media Control)
function Initialize-Media {
  if ($script:media) { return }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $script:media = Wait-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
}

function Wait-WinRt($op, $type) {
  $t = $script:asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$t.Wait(3000)
  return $t.Result
}

function Get-Media {
  Initialize-Media
  $s = $script:media.GetCurrentSession()
  if (-not $s) { return $null }
  $p = Wait-WinRt ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $info = $s.GetPlaybackInfo()
  $key = "$($p.Artist)|$($p.Title)"
  $thumb = $null
  if ($script:thumbCache.ContainsKey($key)) { $thumb = $script:thumbCache[$key] }
  elseif ($p.Thumbnail) {
    try {
      $stream = Wait-WinRt ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
      $size = [uint32]$stream.Size
      if ($size -gt 0 -and $size -lt 4MB) {
        $reader = [Windows.Storage.Streams.DataReader]::new($stream.GetInputStreamAt(0))
        [void](Wait-WinRt ($reader.LoadAsync($size)) ([uint32]))
        $bytes = New-Object byte[] $size
        $reader.ReadBytes($bytes)
        $thumb = 'data:' + $stream.ContentType + ';base64,' + [Convert]::ToBase64String($bytes)
      }
    } catch { $thumb = $null }
    $script:thumbCache[$key] = $thumb
  }
  return @{
    title = $p.Title
    artist = $p.Artist
    album = $p.AlbumTitle
    app = $s.SourceAppUserModelId
    playing = ([string]$info.PlaybackStatus -eq 'Playing')
    thumb = $thumb
  }
}

$keySig = @'
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
'@
$script:keys = $null
function Send-MediaKey($name) {
  if (-not $script:keys) { $script:keys = Add-Type -MemberDefinition $keySig -Name 'UnicoKeys' -Namespace 'Unico' -PassThru }
  $vk = @{ playpause = 0xB3; next = 0xB0; prev = 0xB1; volup = 0xAF; voldown = 0xAE; mute = 0xAD }[$name]
  if (-not $vk) { throw "tasto sconosciuto $name" }
  $script:keys::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
  $script:keys::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)
  return $true
}

# ---------------------------------------------------------------- luminosita' (portatile via WMI, monitor esterni via DDC/CI)
$ddcSrc = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace Unico {
  public static class Ddc {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PHYSICAL_MONITOR { public IntPtr hPhysicalMonitor; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szPhysicalMonitorDescription; }
    public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, IntPtr lprcMonitor, IntPtr dwData);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);
    [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, out uint count);
    [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, uint size, [Out] PHYSICAL_MONITOR[] arr);
    [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint size, PHYSICAL_MONITOR[] arr);
    [DllImport("dxva2.dll")] static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr h, byte code, IntPtr type, out uint cur, out uint max);
    [DllImport("dxva2.dll")] static extern bool SetVCPFeature(IntPtr h, byte code, uint value);
    static List<PHYSICAL_MONITOR[]> Collect() {
      var all = new List<PHYSICAL_MONITOR[]>();
      EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr hm, IntPtr dc, IntPtr r, IntPtr d) => {
        uint n;
        if (GetNumberOfPhysicalMonitorsFromHMONITOR(hm, out n) && n > 0) {
          var arr = new PHYSICAL_MONITOR[n];
          if (GetPhysicalMonitorsFromHMONITOR(hm, n, arr)) all.Add(arr);
        }
        return true;
      }, IntPtr.Zero);
      return all;
    }
    public static string[] Read() {
      var res = new List<string>();
      int i = 0;
      foreach (var arr in Collect()) {
        foreach (var m in arr) {
          uint cur, max;
          if (GetVCPFeatureAndVCPFeatureReply(m.hPhysicalMonitor, 0x10, IntPtr.Zero, out cur, out max)) res.Add(i + "|" + m.szPhysicalMonitorDescription + "|" + cur + "|" + max);
          i++;
        }
        DestroyPhysicalMonitors((uint)arr.Length, arr);
      }
      return res.ToArray();
    }
    public static bool Write(int index, uint value) {
      bool ok = false; int i = 0;
      foreach (var arr in Collect()) {
        foreach (var m in arr) { if (i == index) ok = SetVCPFeature(m.hPhysicalMonitor, 0x10, value); i++; }
        DestroyPhysicalMonitors((uint)arr.Length, arr);
      }
      return ok;
    }
  }
}
'@
$script:ddcReady = $false
function Initialize-Ddc { if (-not $script:ddcReady) { Add-Type -TypeDefinition $ddcSrc -Language CSharp; $script:ddcReady = $true } }

function Get-Brightness {
  $list = New-Object System.Collections.ArrayList
  try {
    $b = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
    if ($b) { [void]$list.Add(@{ id = 'internal'; name = 'Schermo del portatile'; value = [int]$b.CurrentBrightness; max = 100 }) }
  } catch {}
  try {
    Initialize-Ddc
    foreach ($row in [Unico.Ddc]::Read()) {
      $f = $row.Split('|')
      [void]$list.Add(@{ id = "ddc:$($f[0])"; name = $(if ($f[1]) { $f[1] } else { 'Monitor esterno' }); value = [int]$f[2]; max = [int]$f[3] })
    }
  } catch {}
  return $list
}

function Set-Brightness($id, $value) {
  if ($id -eq 'internal') {
    $m = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1
    Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$value } | Out-Null
    return $true
  }
  Initialize-Ddc
  return [Unico.Ddc]::Write([int]($id -replace '^ddc:', ''), [uint32]$value)
}

# ---------------------------------------------------------------- energia
function Invoke-Suspend {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)
  return $true
}

# ---------------------------------------------------------------- ciclo principale
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $a = $req.args
    $data = switch ($req.cmd) {
      'ping' { 'pong' }
      'sample' { Get-Sample }
      'procs' { Get-Procs }
      'procNames' { Get-ProcNames }
      'kill' { Stop-Pids $a.pids }
      'closeNames' { Close-Names $a.names }
      'cleanupScan' { Get-CleanupScan $a.downloads }
      'clearTemp' { Clear-Temp }
      'emptyRecycle' { Clear-RecycleBin -Force -ErrorAction SilentlyContinue; $true }
      'gateway' { Get-Gateway }
      'wifi' { Get-WifiInfo }
      'media' { Get-Media }
      'mediaKey' { Send-MediaKey $a.key }
      'brightness' { Get-Brightness }
      'setBrightness' { Set-Brightness $a.id $a.value }
      'suspend' { Invoke-Suspend }
      'audioDevices' { Get-AudioDevices $a.flow }
      'audioSessions' { Get-AudioSessions }
      'audioSetDefault' { Initialize-Audio; [UnicoAudio.Api]::SetDefault([string]$a.id, [bool]$a.comm); $true }
      'audioSetDeviceVolume' { Initialize-Audio; [UnicoAudio.Api]::SetDeviceVolume([string]$a.id, [float]($a.volume / 100)); $true }
      'audioSetDeviceMute' { Initialize-Audio; [UnicoAudio.Api]::SetDeviceMute([string]$a.id, [bool]$a.mute); $true }
      'audioSetSession' { Initialize-Audio; [UnicoAudio.Api]::SetSession([int]$a.pid, [float]$a.volume, [int]$a.mute) }
      default { throw "comando sconosciuto: $($req.cmd)" }
    }
    Send-Reply $id $true $data
  } catch {
    Send-Reply $id $false ($_.Exception.Message)
  }
}
