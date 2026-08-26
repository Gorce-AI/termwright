$source = @"
using System;
using System.Runtime.InteropServices;
public static class TermwrightConsoleMarkerProbe {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleMode(IntPtr h, out uint mode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleMode(IntPtr h, uint mode);
}
"@
Add-Type -TypeDefinition $source

$output = [TermwrightConsoleMarkerProbe]::GetStdHandle(-11)
$original = 0
if (-not [TermwrightConsoleMarkerProbe]::GetConsoleMode($output, [ref]$original)) { exit 40 }
$withoutRequiredModes = [uint32]($original -band 0xFFFFFFFA)
if (-not [TermwrightConsoleMarkerProbe]::SetConsoleMode($output, $withoutRequiredModes)) { exit 41 }
try {
  # PowerShell's native-command pipeline replaces stdout with a pipe before
  # launching the child. Start-Process with no redirection lets the marker
  # runtime inherit the actual active console handle that probes receive.
  # Start-Process joins ArgumentList into a native command line, so preserve
  # quotes around a script path containing spaces.
  $markerArgument = '"' + $env:TW_MARKER_SCRIPT + '"'
  $markerProcess = Start-Process -FilePath $env:TW_MARKER_NODE -ArgumentList $markerArgument -NoNewWindow -Wait -PassThru
  if ($markerProcess.ExitCode -ne 0) { exit 42 }
  $restored = 0
  if (-not [TermwrightConsoleMarkerProbe]::GetConsoleMode($output, [ref]$restored)) { exit 43 }
  if ($restored -ne $withoutRequiredModes) { exit 44 }
  [Console]::Out.Write("MODE_RESTORED")
} finally {
  if (-not [TermwrightConsoleMarkerProbe]::SetConsoleMode($output, $original)) { exit 45 }
}
