# Unico - controllo audio di Windows (Core Audio), caricato da helper.ps1.
# Definizioni COM dalle interfacce pubbliche di mmdeviceapi.h / endpointvolume.h / audiopolicy.h;
# IPolicyConfig (cambio dispositivo predefinito) e' l'interfaccia usata dal Pannello di controllo audio.
# C# 5: niente interpolazione di stringhe ne' "out var", per il compilatore di Windows PowerShell 5.1.
$audioSrc = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace UnicoAudio {
  public enum EDataFlow { Render = 0, Capture = 1, All = 2 }
  public enum ERole { Console = 0, Multimedia = 1, Communications = 2 }

  [StructLayout(LayoutKind.Sequential)]
  public struct PROPERTYKEY { public Guid fmtid; public int pid; public PROPERTYKEY(Guid g, int p) { fmtid = g; pid = p; } }

  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }

  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    int GetCount(out int c);
    int GetAt(int i, out PROPERTYKEY k);
    int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
    int Commit();
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    int OpenPropertyStore(int access, out IPropertyStore store);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetState(out int state);
  }

  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceCollection {
    int GetCount(out int c);
    int Item(int i, out IMMDevice d);
  }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(EDataFlow flow, int mask, out IMMDeviceCollection devs);
    int GetDefaultAudioEndpoint(EDataFlow flow, ERole role, out IMMDevice dev);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice dev);
    int RegisterEndpointNotificationCallback(IntPtr c);
    int UnregisterEndpointNotificationCallback(IntPtr c);
  }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  public class MMDeviceEnumeratorCom { }

  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr n);
    int UnregisterControlChangeNotify(IntPtr n);
    int GetChannelCount(out int c);
    int SetMasterVolumeLevel(float db, ref Guid ctx);
    int SetMasterVolumeLevelScalar(float v, ref Guid ctx);
    int GetMasterVolumeLevel(out float db);
    int GetMasterVolumeLevelScalar(out float v);
    int SetChannelVolumeLevel(int ch, float db, ref Guid ctx);
    int SetChannelVolumeLevelScalar(int ch, float v, ref Guid ctx);
    int GetChannelVolumeLevel(int ch, out float db);
    int GetChannelVolumeLevelScalar(int ch, out float v);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    int GetVolumeStepInfo(out int step, out int count);
    int VolumeStepUp(ref Guid ctx);
    int VolumeStepDown(ref Guid ctx);
    int QueryHardwareSupport(out int mask);
    int GetVolumeRange(out float min, out float max, out float inc);
  }

  [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioMeterInformation {
    int GetPeakValue(out float peak);
    int GetMeteringChannelCount(out int c);
    int GetChannelsPeakValues(int c, IntPtr values);
    int QueryHardwareSupport(out int mask);
  }

  [ComImport, Guid("87CE5498-68D6-44E5-9215-6F0B6D85A55B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface ISimpleAudioVolume {
    int SetMasterVolume(float v, ref Guid ctx);
    int GetMasterVolume(out float v);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
    int GetGroupingParam(out Guid g);
    int SetGroupingParam(ref Guid g, ref Guid ctx);
    int RegisterAudioSessionNotification(IntPtr n);
    int UnregisterAudioSessionNotification(IntPtr n);
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetProcessId(out int pid);
    [PreserveSig] int IsSystemSoundsSession();
    int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionEnumerator {
    int GetCount(out int c);
    int GetSession(int i, out IAudioSessionControl2 s);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr g, int flags, out IntPtr c);
    int GetSimpleAudioVolume(IntPtr g, int flags, out IntPtr v);
    int GetSessionEnumerator(out IAudioSessionEnumerator e);
    int RegisterSessionNotification(IntPtr n);
    int UnregisterSessionNotification(IntPtr n);
    int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr n);
    int UnregisterDuckNotification(IntPtr n);
  }

  [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPolicyConfig {
    int GetMixFormat(string id, IntPtr f);
    int GetDeviceFormat(string id, int def, IntPtr f);
    int ResetDeviceFormat(string id);
    int SetDeviceFormat(string id, IntPtr f1, IntPtr f2);
    int GetProcessingPeriod(string id, int def, IntPtr a, IntPtr b);
    int SetProcessingPeriod(string id, IntPtr p);
    int GetShareMode(string id, IntPtr m);
    int SetShareMode(string id, IntPtr m);
    int GetPropertyValue(string id, IntPtr k, IntPtr v);
    int SetPropertyValue(string id, IntPtr k, IntPtr v);
    int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, ERole role);
    int SetEndpointVisibility(string id, int visible);
  }

  [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
  public class PolicyConfigClient { }

  public class Device { public string Id; public string Name; public bool IsDefault; public bool IsDefaultComm; public float Volume; public bool Muted; public float Peak; }
  public class Session { public int Pid; public string Name; public float Volume; public bool Muted; public float Peak; public bool System; }

  public static class Api {
    const int CLSCTX_ALL = 23;
    const int DEVICE_STATE_ACTIVE = 1;
    static Guid IID_EndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    static Guid IID_Meter = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
    static Guid IID_SessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    static PROPERTYKEY PKEY_FriendlyName = new PROPERTYKEY(new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), 14);

    static IMMDeviceEnumerator Enumerator() { return (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom()); }

    static string DefaultId(IMMDeviceEnumerator en, EDataFlow flow, ERole role) {
      IMMDevice d;
      if (en.GetDefaultAudioEndpoint(flow, role, out d) != 0 || d == null) return null;
      string id; d.GetId(out id); return id;
    }

    static string Name(IMMDevice d) {
      IPropertyStore st;
      if (d.OpenPropertyStore(0, out st) != 0) return null;
      PROPERTYKEY k = PKEY_FriendlyName;
      PROPVARIANT v;
      if (st.GetValue(ref k, out v) != 0) return null;
      return v.vt == 31 ? Marshal.PtrToStringUni(v.p) : null;
    }

    static T Activate<T>(IMMDevice d, Guid iid) where T : class {
      object o;
      if (d.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o) != 0) return null;
      return o as T;
    }

    public static Device[] List(int flow) {
      var en = Enumerator();
      string def = DefaultId(en, (EDataFlow)flow, ERole.Multimedia);
      string defComm = DefaultId(en, (EDataFlow)flow, ERole.Communications);
      IMMDeviceCollection col;
      en.EnumAudioEndpoints((EDataFlow)flow, DEVICE_STATE_ACTIVE, out col);
      int n; col.GetCount(out n);
      var res = new List<Device>();
      for (int i = 0; i < n; i++) {
        IMMDevice d; col.Item(i, out d);
        var x = new Device();
        d.GetId(out x.Id);
        x.Name = Name(d) ?? x.Id;
        x.IsDefault = x.Id == def;
        x.IsDefaultComm = x.Id == defComm;
        var vol = Activate<IAudioEndpointVolume>(d, IID_EndpointVolume);
        if (vol != null) { vol.GetMasterVolumeLevelScalar(out x.Volume); vol.GetMute(out x.Muted); }
        var meter = Activate<IAudioMeterInformation>(d, IID_Meter);
        if (meter != null) meter.GetPeakValue(out x.Peak);
        res.Add(x);
      }
      return res.ToArray();
    }

    public static void SetDefault(string id, bool alsoComm) {
      var pc = (IPolicyConfig)(new PolicyConfigClient());
      Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, ERole.Console));
      Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, ERole.Multimedia));
      if (alsoComm) Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, ERole.Communications));
    }

    static IMMDevice Get(string id) {
      var en = Enumerator();
      IMMDevice d;
      Marshal.ThrowExceptionForHR(en.GetDevice(id, out d));
      return d;
    }

    public static void SetDeviceVolume(string id, float v) {
      var vol = Activate<IAudioEndpointVolume>(Get(id), IID_EndpointVolume);
      Guid g = Guid.Empty; vol.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), ref g);
    }

    public static void SetDeviceMute(string id, bool m) {
      var vol = Activate<IAudioEndpointVolume>(Get(id), IID_EndpointVolume);
      Guid g = Guid.Empty; vol.SetMute(m, ref g);
    }

    public static Session[] Sessions() {
      var en = Enumerator();
      IMMDevice d;
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out d));
      var mgr = Activate<IAudioSessionManager2>(d, IID_SessionManager2);
      IAudioSessionEnumerator se; mgr.GetSessionEnumerator(out se);
      int n; se.GetCount(out n);
      var res = new List<Session>();
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 c; se.GetSession(i, out c);
        int state; c.GetState(out state);
        if (state == 2) continue; // scaduta
        var s = new Session();
        c.GetProcessId(out s.Pid);
        s.System = c.IsSystemSoundsSession() == 0;
        string dn; c.GetDisplayName(out dn); s.Name = dn;
        var sv = c as ISimpleAudioVolume;
        if (sv != null) { sv.GetMasterVolume(out s.Volume); sv.GetMute(out s.Muted); }
        var m = c as IAudioMeterInformation;
        if (m != null) m.GetPeakValue(out s.Peak);
        res.Add(s);
      }
      return res.ToArray();
    }

    public static bool SetSession(int pid, float volume, int mute) {
      var en = Enumerator();
      IMMDevice d;
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out d));
      var mgr = Activate<IAudioSessionManager2>(d, IID_SessionManager2);
      IAudioSessionEnumerator se; mgr.GetSessionEnumerator(out se);
      int n; se.GetCount(out n);
      bool found = false;
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 c; se.GetSession(i, out c);
        int p; c.GetProcessId(out p);
        if (p != pid) continue;
        var sv = c as ISimpleAudioVolume;
        if (sv == null) continue;
        Guid g = Guid.Empty;
        if (volume >= 0) sv.SetMasterVolume(Math.Max(0f, Math.Min(1f, volume)), ref g);
        if (mute >= 0) sv.SetMute(mute == 1, ref g);
        found = true;
      }
      return found;
    }
  }
}
'@
$script:audioReady = $false
function Initialize-Audio { if (-not $script:audioReady) { Add-Type -TypeDefinition $audioSrc -Language CSharp; $script:audioReady = $true } }

function Get-AudioDevices($flow) {
  Initialize-Audio
  $list = New-Object System.Collections.ArrayList
  foreach ($d in [UnicoAudio.Api]::List([int]$flow)) {
    [void]$list.Add(@{ id = $d.Id; name = $d.Name; isDefault = $d.IsDefault; isDefaultComm = $d.IsDefaultComm; volume = [math]::Round($d.Volume * 100); muted = $d.Muted; peak = [math]::Round($d.Peak * 100) })
  }
  return , $list
}

function Get-AudioSessions {
  Initialize-Audio
  $list = New-Object System.Collections.ArrayList
  foreach ($s in [UnicoAudio.Api]::Sessions()) {
    $name = $s.Name; $path = $null; $desc = $null
    if ($s.Pid -gt 0) {
      try {
        $p = Get-Process -Id $s.Pid -ErrorAction Stop
        $path = $p.Path
        if (-not $name -or $name.StartsWith('@')) { $name = $p.ProcessName }
        try { $desc = $p.MainModule.FileVersionInfo.FileDescription } catch {}
      } catch {}
    }
    if ($s.System) { $name = 'Suoni di sistema' }
    [void]$list.Add(@{ pid = $s.Pid; name = $name; desc = $desc; path = $path; volume = [math]::Round($s.Volume * 100); muted = $s.Muted; peak = [math]::Round($s.Peak * 100); system = $s.System })
  }
  return , $list
}
