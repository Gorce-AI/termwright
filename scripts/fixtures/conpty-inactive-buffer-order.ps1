$source = @'
using System;
using System.Runtime.InteropServices;
public static class TermwrightInactiveBufferProbe {
  public const uint GENERIC_READ = 0x80000000;
  public const uint GENERIC_WRITE = 0x40000000;
  public const uint FILE_SHARE_READ = 1;
  public const uint FILE_SHARE_WRITE = 2;
  public const uint CONSOLE_TEXTMODE_BUFFER = 1;
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleMode(IntPtr h, out uint mode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleMode(IntPtr h, uint mode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateConsoleScreenBuffer(uint access, uint share, IntPtr security, uint flags, IntPtr data);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleActiveScreenBuffer(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool WriteConsoleW(IntPtr h, string text, uint n, out uint written, IntPtr reserved);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool WriteFile(IntPtr h, byte[] b, uint n, out uint written, IntPtr overlapped);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
}
'@
Add-Type -TypeDefinition $source
$original = [TermwrightInactiveBufferProbe]::GetStdHandle(-11)
$mode = 0
if (-not [TermwrightInactiveBufferProbe]::GetConsoleMode($original, [ref]$mode)) { exit 20 }
if (-not [TermwrightInactiveBufferProbe]::SetConsoleMode($original, $mode -bor 5)) { exit 21 }
$utf8 = [Text.Encoding]::UTF8
function Raw([IntPtr]$handle, [string]$text) {
  $bytes = $utf8.GetBytes($text); $written = 0
  if (-not [TermwrightInactiveBufferProbe]::WriteFile($handle, $bytes, $bytes.Length, [ref]$written, [IntPtr]::Zero) -or $written -ne $bytes.Length) { exit 22 }
}

Raw $original "ACTIVE-BEFORE$([char]27)]8487;TW_BUFFER;BEFORE$([char]7)"
$inactive = [TermwrightInactiveBufferProbe]::CreateConsoleScreenBuffer(
  [TermwrightInactiveBufferProbe]::GENERIC_READ -bor [TermwrightInactiveBufferProbe]::GENERIC_WRITE,
  [TermwrightInactiveBufferProbe]::FILE_SHARE_READ -bor [TermwrightInactiveBufferProbe]::FILE_SHARE_WRITE,
  [IntPtr]::Zero,
  [TermwrightInactiveBufferProbe]::CONSOLE_TEXTMODE_BUFFER,
  [IntPtr]::Zero)
if ($inactive -eq [IntPtr](-1)) { exit 23 }
$inactiveMode = 0
if (-not [TermwrightInactiveBufferProbe]::GetConsoleMode($inactive, [ref]$inactiveMode)) { exit 24 }
if (-not [TermwrightInactiveBufferProbe]::SetConsoleMode($inactive, $inactiveMode -bor 5)) { exit 25 }
$written = 0
if (-not [TermwrightInactiveBufferProbe]::WriteConsoleW($inactive, "INACTIVE-BUFFER", 15, [ref]$written, [IntPtr]::Zero) -or $written -ne 15) { exit 26 }
Raw $inactive "$([char]27)]8487;TW_BUFFER;INACTIVE$([char]7)"
if (-not [TermwrightInactiveBufferProbe]::SetConsoleActiveScreenBuffer($inactive)) { exit 27 }
Raw $inactive "$([char]27)]8487;TW_BUFFER;AFTER$([char]7)"
if (-not [TermwrightInactiveBufferProbe]::SetConsoleActiveScreenBuffer($original)) { exit 28 }
[TermwrightInactiveBufferProbe]::CloseHandle($inactive) | Out-Null
