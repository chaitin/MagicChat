import { execFile } from "node:child_process"
import { join } from "node:path"
import { promisify } from "node:util"
import type { Display } from "electron"
import type { ScreenshotWindowBounds } from "../shared/screenshot"

const runFile = promisify(execFile)

type Bounds = { X: number; Y: number; Width: number; Height: number }
type CapturedScreen = Bounds & { Png: string }
type WindowSnapshot = { Monitors: Bounds[]; Windows: Bounds[]; Screens?: CapturedScreen[] }
export type WindowsCapture = {
  windows: Map<number, ScreenshotWindowBounds[]>
  pngs: Map<number, Buffer>
}

const enumerateWindows = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class ScreenshotWindows {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)] public struct MonitorInfo {
    public int Size; public Rect Monitor; public Rect Work; public uint Flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string Device;
  }
  public class Bounds { public int X { get; set; } public int Y { get; set; } public int Width { get; set; } public int Height { get; set; } }
  public class Snapshot { public Bounds[] Monitors { get; set; } public Bounds[] Windows { get; set; } }
  private delegate bool MonitorCallback(IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data);
  private delegate bool WindowCallback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr rect, MonitorCallback callback, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
  [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr data);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect result, int size);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int result, int size);

  private static Bounds Convert(Rect rect) {
    return new Bounds { X=rect.Left, Y=rect.Top, Width=rect.Right-rect.Left, Height=rect.Bottom-rect.Top };
  }
  public static Snapshot Read() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
    var monitors = new List<Bounds>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (monitor, hdc, rect, data) => {
      var info = new MonitorInfo { Size=Marshal.SizeOf(typeof(MonitorInfo)) };
      if (GetMonitorInfo(monitor, ref info)) monitors.Add(Convert(info.Monitor));
      return true;
    }, IntPtr.Zero);
    var windows = new List<Bounds>();
    EnumWindows((window, data) => {
      if (!IsWindowVisible(window) || IsIconic(window) || GetWindowTextLength(window) == 0 || GetWindow(window, 4) != IntPtr.Zero || (GetWindowLong(window, -20) & 0x80) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(window, 14, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
      Rect bounds;
      if (DwmGetWindowAttribute(window, 9, out bounds, Marshal.SizeOf(typeof(Rect))) != 0 && !GetWindowRect(window, out bounds)) return true;
      var item = Convert(bounds);
      if (item.Width >= 32 && item.Height >= 32) windows.Add(item);
      return true;
    }, IntPtr.Zero);
    return new Snapshot { Monitors=monitors.ToArray(), Windows=windows.ToArray() };
  }
}
'@ -ErrorAction Stop
$snapshot = [ScreenshotWindows]::Read()
Add-Type -AssemblyName System.Windows.Forms,System.Drawing -ErrorAction Stop
$screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  $r = $_.Bounds
  $bitmap = $null; $graphics = $null; $memory = $null
  try {
    $bitmap = New-Object System.Drawing.Bitmap($r.Width,$r.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($r.X,$r.Y,0,0,$bitmap.Size)
    $memory = New-Object System.IO.MemoryStream
    $bitmap.Save($memory,[System.Drawing.Imaging.ImageFormat]::Png)
    [PSCustomObject]@{ X=$r.X; Y=$r.Y; Width=$r.Width; Height=$r.Height; Png=[Convert]::ToBase64String($memory.ToArray()) }
  } finally {
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
    if ($memory) { $memory.Dispose() }
  }
})
[PSCustomObject]@{ Monitors=$snapshot.Monitors; Windows=$snapshot.Windows; Screens=$screens } | ConvertTo-Json -Compress -Depth 5
`

export async function captureWindowsDisplays(
  displays: readonly Display[],
): Promise<WindowsCapture> {
  const empty = (): WindowsCapture => ({ windows: new Map(), pngs: new Map() })
  if (process.platform !== "win32" || !displays.length) return empty()
  try {
    const command = Buffer.from(enumerateWindows, "utf16le").toString("base64")
    const { stdout } = await runFile(
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", command],
      { windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 * 1024 },
    )
    const snapshot: unknown = JSON.parse(stdout.trim())
    if (!isSnapshot(snapshot)) return empty()
    return {
      windows: projectWindowsToDisplays(snapshot, displays),
      pngs: projectCapturedScreens(snapshot, displays),
    }
  } catch {
    return empty()
  }
}

export function projectCapturedScreens(
  snapshot: WindowSnapshot,
  displays: readonly { id: number; bounds: ScreenshotWindowBounds; scaleFactor?: number }[],
): Map<number, Buffer> {
  const result = new Map<number, Buffer>()
  const pairs = matchMonitors(displays, snapshot.Monitors)
  if (!pairs || !snapshot.Screens || snapshot.Screens.length !== pairs.length) return result
  for (const { monitor, display } of pairs) {
    const captured = snapshot.Screens.find(
      (screen) =>
        screen.X === monitor.X &&
        screen.Y === monitor.Y &&
        screen.Width === monitor.Width &&
        screen.Height === monitor.Height,
    )
    if (!captured || typeof captured.Png !== "string" || captured.Png.length > 64 * 1024 * 1024)
      return new Map()
    const png = Buffer.from(captured.Png, "base64")
    if (
      png.length < 24 ||
      png.length > 48 * 1024 * 1024 ||
      !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      png.readUInt32BE(16) !== monitor.Width ||
      png.readUInt32BE(20) !== monitor.Height
    )
      return new Map()
    result.set(display.id, png)
  }
  return result
}

export function projectWindowsToDisplays(
  snapshot: WindowSnapshot,
  displays: readonly { id: number; bounds: ScreenshotWindowBounds; scaleFactor?: number }[],
): Map<number, ScreenshotWindowBounds[]> {
  const result = new Map<number, ScreenshotWindowBounds[]>()
  const pairs = matchMonitors(displays, snapshot.Monitors)
  if (!pairs) return result
  for (const { monitor, display } of pairs) {
    const candidates: ScreenshotWindowBounds[] = []
    for (const window of snapshot.Windows) {
      const left = Math.max(window.X, monitor.X)
      const top = Math.max(window.Y, monitor.Y)
      const right = Math.min(window.X + window.Width, monitor.X + monitor.Width)
      const bottom = Math.min(window.Y + window.Height, monitor.Y + monitor.Height)
      if (right - left < 24 || bottom - top < 24) continue
      candidates.push({
        x: ((left - monitor.X) * display.bounds.width) / monitor.Width,
        y: ((top - monitor.Y) * display.bounds.height) / monitor.Height,
        width: ((right - left) * display.bounds.width) / monitor.Width,
        height: ((bottom - top) * display.bounds.height) / monitor.Height,
      })
    }
    result.set(display.id, candidates)
  }
  return result
}

function matchMonitors<
  T extends { id: number; bounds: ScreenshotWindowBounds; scaleFactor?: number },
>(displays: readonly T[], physical: readonly Bounds[]): { monitor: Bounds; display: T }[] | null {
  if (physical.length !== displays.length || physical.length === 0) return null
  const monitors = [...physical].sort(compareBounds)
  const sortedDisplays = [...displays].sort((a, b) => compareBounds(a.bounds, b.bounds))
  const pairs = monitors.map((monitor, index) => ({ monitor, display: sortedDisplays[index] }))
  if (
    pairs.some(
      ({ monitor, display }) =>
        monitor.Width <= 0 ||
        monitor.Height <= 0 ||
        display.bounds.width <= 0 ||
        display.bounds.height <= 0 ||
        (display.scaleFactor !== undefined &&
          (Math.abs(monitor.Width / display.bounds.width - display.scaleFactor) > 0.15 ||
            Math.abs(monitor.Height / display.bounds.height - display.scaleFactor) > 0.15)),
    )
  )
    return null
  return pairs
}

function compareBounds(
  a: { x?: number; y?: number; X?: number; Y?: number },
  b: { x?: number; y?: number; X?: number; Y?: number },
) {
  return (a.x ?? a.X ?? 0) - (b.x ?? b.X ?? 0) || (a.y ?? a.Y ?? 0) - (b.y ?? b.Y ?? 0)
}

function isSnapshot(value: unknown): value is WindowSnapshot {
  if (!value || typeof value !== "object" || !("Monitors" in value) || !("Windows" in value))
    return false
  const entry = value as { Monitors: unknown; Windows: unknown; Screens?: unknown }
  const valid = (item: unknown): item is Bounds =>
    Boolean(
      item &&
      typeof item === "object" &&
      ["X", "Y", "Width", "Height"].every(
        (key) =>
          typeof (item as Record<string, unknown>)[key] === "number" &&
          Number.isFinite((item as Record<string, number>)[key]),
      ),
    )
  return (
    Array.isArray(entry.Monitors) &&
    entry.Monitors.every(valid) &&
    Array.isArray(entry.Windows) &&
    entry.Windows.every(valid) &&
    (entry.Screens === undefined ||
      (Array.isArray(entry.Screens) &&
        entry.Screens.every(
          (screen) => valid(screen) && typeof (screen as CapturedScreen).Png === "string",
        )))
  )
}
