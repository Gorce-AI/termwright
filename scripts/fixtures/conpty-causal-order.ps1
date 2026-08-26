$source = @'
using System;
using System.Runtime.InteropServices;
public static class TermwrightConsoleProbe {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleMode(IntPtr h, out uint mode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleMode(IntPtr h, uint mode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool WriteFile(IntPtr h, byte[] b, uint n, out uint written, IntPtr overlapped);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool WriteConsoleW(IntPtr h, string text, uint n, out uint written, IntPtr reserved);
}
'@
Add-Type -TypeDefinition $source
$output = [TermwrightConsoleProbe]::GetStdHandle(-11)
$mode = 0
if (-not [TermwrightConsoleProbe]::GetConsoleMode($output, [ref]$mode)) { exit 10 }
if (-not [TermwrightConsoleProbe]::SetConsoleMode($output, $mode -bor 5)) { exit 11 }
$utf8 = [Text.Encoding]::UTF8
function Raw([string]$text) {
  $bytes = $utf8.GetBytes($text); $written = 0
  if (-not [TermwrightConsoleProbe]::WriteFile($output, $bytes, $bytes.Length, [ref]$written, [IntPtr]::Zero) -or $written -ne $bytes.Length) { exit 12 }
}
for ($index = 0; $index -lt 256; $index++) {
  $id = $index.ToString('x4')
  Raw ("A$id$([char]27)]8487;TW_LEGACY;A;$id$([char]7)")
  $written = 0
  if (-not [TermwrightConsoleProbe]::WriteConsoleW($output, "B$id", 5, [ref]$written, [IntPtr]::Zero) -or $written -ne 5) { exit 13 }
  Raw ("$([char]27)]8487;TW_LEGACY;B;$id$([char]7)")
  Raw ("A$id$([char]27)]8487;TW_LEGACY;C;$id$([char]7)")
}
[TermwrightConsoleProbe]::SetConsoleMode($output, $mode) | Out-Null
