using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace AudioMixer {
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [Guid("77AA99A0-1BD6-444F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionManager2 {
        int GetAudioSessionControl(IntPtr AudioSessionGuid, int StreamFlags, out IntPtr SessionControl);
        int GetSimpleAudioVolume(IntPtr AudioSessionGuid, int StreamFlags, out IntPtr AudioVolume);
        int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
    }

    [Guid("E2F5EE55-BEB5-403A-A127-E06441110342"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionEnumerator {
        int GetCount(out int SessionCount);
        int GetSession(int SessionIndex, out IAudioSessionControl Session);
    }

    [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl {
        int GetState(out int pRetVal);
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        int GetGroupingParam(out Guid pRetVal);
        int SetGroupingParam(ref Guid Override, ref Guid EventContext);
        int RegisterAudioSessionNotification(IntPtr NewNotifications);
        int UnregisterAudioSessionNotification(IntPtr NewNotifications);
    }

    [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioSessionControl2 : IAudioSessionControl {
        new int GetState(out int pRetVal);
        new int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        new int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        new int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        new int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
        new int GetGroupingParam(out Guid pRetVal);
        new int SetGroupingParam(ref Guid Override, ref Guid EventContext);
        new int RegisterAudioSessionNotification(IntPtr NewNotifications);
        new int UnregisterAudioSessionNotification(IntPtr NewNotifications);
        int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
        int GetProcessId(out int pRetVal);
        int IsSystemSoundsSession();
        int SetDuckingPreference(bool optOut);
    }

    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ISimpleAudioVolume {
        int SetMasterVolume(float fLevel, ref Guid EventContext);
        int GetMasterVolume(out float pfLevel);
        int SetMute(bool bMute, ref Guid EventContext);
        int GetMute(out bool pbMute);
    }

    public class AppVolumeController {
        public static float GetVolume(string processName) {
            try {
                var clsid = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
                var type = Type.GetTypeFromCLSID(clsid);
                var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(type);
                IMMDevice dev;
                enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
                var iid = typeof(IAudioSessionManager2).GUID;
                object o;
                dev.Activate(ref iid, 23, IntPtr.Zero, out o);
                var mgr = (IAudioSessionManager2)o;
                IAudioSessionEnumerator sessionEnum;
                mgr.GetSessionEnumerator(out sessionEnum);
                int count;
                sessionEnum.GetCount(out count);
                for (int i = 0; i < count; i++) {
                    IAudioSessionControl ctrl;
                    sessionEnum.GetSession(i, out ctrl);
                    var ctrl2 = ctrl as IAudioSessionControl2;
                    if (ctrl2 != null) {
                        int pid;
                        ctrl2.GetProcessId(out pid);
                        if (pid > 0) {
                            try {
                                var p = Process.GetProcessById(pid);
                                if (p.ProcessName.IndexOf(processName, StringComparison.OrdinalIgnoreCase) >= 0) {
                                    var vol = ctrl as ISimpleAudioVolume;
                                    if (vol != null) {
                                        float level;
                                        vol.GetMasterVolume(out level);
                                        return level;
                                    }
                                }
                            } catch {}
                        }
                    }
                }
            } catch {}
            return 1.0f;
        }

        public static bool SetVolume(string processName, float targetLevel) {
            try {
                var clsid = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
                var type = Type.GetTypeFromCLSID(clsid);
                var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(type);
                IMMDevice dev;
                enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
                var iid = typeof(IAudioSessionManager2).GUID;
                object o;
                dev.Activate(ref iid, 23, IntPtr.Zero, out o);
                var mgr = (IAudioSessionManager2)o;
                IAudioSessionEnumerator sessionEnum;
                mgr.GetSessionEnumerator(out sessionEnum);
                int count;
                sessionEnum.GetCount(out count);
                Guid empty = Guid.Empty;
                for (int i = 0; i < count; i++) {
                    IAudioSessionControl ctrl;
                    sessionEnum.GetSession(i, out ctrl);
                    var ctrl2 = ctrl as IAudioSessionControl2;
                    if (ctrl2 != null) {
                        int pid;
                        ctrl2.GetProcessId(out pid);
                        if (pid > 0) {
                            try {
                                var p = Process.GetProcessById(pid);
                                if (p.ProcessName.IndexOf(processName, StringComparison.OrdinalIgnoreCase) >= 0) {
                                    var vol = ctrl as ISimpleAudioVolume;
                                    if (vol != null) {
                                        vol.SetMasterVolume(Math.Max(0f, Math.Min(1f, targetLevel)), ref empty);
                                        return true;
                                    }
                                }
                            } catch {}
                        }
                    }
                }
            } catch {}
            return false;
        }
    }
}
