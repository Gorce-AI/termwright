$source = @"
using System;
using System.Runtime.InteropServices;
public static class TermwrightConsoleMarkerProbe {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleMode(IntPtr h, out uint mode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleMode(IntPtr h, uint mode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
}
"@
Add-Type -TypeDefinition $source

$output = [TermwrightConsoleMarkerProbe]::GetStdHandle(-11)
$original = 0
if (-not [TermwrightConsoleMarkerProbe]::GetConsoleMode($output, [ref]$original)) { exit 40 }
$pipeName = "termwright-marker-" + [Guid]::NewGuid().ToString("N")
$env:TW_MARKER_CONTROL_PIPE = $pipeName
$pipe = $null
$reader = $null
$writer = $null
$markerProcess = $null
try {
  # PowerShell's native-command pipeline replaces stdout with a pipe before
  # launching the child. Start-Process with no redirection lets the marker
  # runtime inherit the actual active console handle that probes receive.
  # Start-Process joins ArgumentList into a native command line, so preserve
  # quotes around a script path containing spaces.
  $markerArgument = '"' + $env:TW_MARKER_SCRIPT + '"'
  $markerProcess = Start-Process -FilePath $env:TW_MARKER_NODE -ArgumentList $markerArgument -NoNewWindow -PassThru
  $pipe = [System.IO.Pipes.NamedPipeClientStream]::new(
    ".",
    $pipeName,
    [System.IO.Pipes.PipeDirection]::InOut,
    [System.IO.Pipes.PipeOptions]::None
  )
  $pipe.Connect(10000)
  $reader = [System.IO.StreamReader]::new($pipe)
  $writer = [System.IO.StreamWriter]::new($pipe)
  $writer.AutoFlush = $true
  if ($reader.ReadLine() -ne "READY") { exit 41 }

  # Runtime startup is complete. Establish the exact precondition immediately
  # around the Termwright call, while the same process remains alive.
  $beforeMarker = 0
  if (-not [TermwrightConsoleMarkerProbe]::GetConsoleMode($output, [ref]$beforeMarker)) { exit 42 }
  $withoutRequiredModes = [uint32]($beforeMarker -band 0xFFFFFFFA)
  if (-not [TermwrightConsoleMarkerProbe]::SetConsoleMode($output, $withoutRequiredModes)) { exit 43 }
  $writer.WriteLine("GO")
  if ($reader.ReadLine() -ne "DONE") { exit 44 }

  $restored = 0
  if (-not [TermwrightConsoleMarkerProbe]::GetConsoleMode($output, [ref]$restored)) { exit 45 }
  if ($restored -ne $withoutRequiredModes) { exit 46 }
  [Console]::Out.Write("MODE_RESTORED")

  # Authorize teardown only after DONE has been consumed and the restored
  # mode has been inspected. CLOSED proves the helper received that command
  # and handed its final response to the pipe without relying on half-close.
  $writer.WriteLine("CLOSE")
  if ($reader.ReadLine() -ne "CLOSED") { exit 52 }

  # The marker process owns the server while this process owns the client.
  # Close the client before waiting for the server process: waiting first
  # creates a circular close dependency on runtimes that keep a named-pipe
  # connection alive until its peer has acknowledged EOF.
  $writer.Dispose()
  $writer = $null
  $reader.Dispose()
  $reader = $null
  $pipe.Dispose()
  $pipe = $null
  # A deadline is diagnostic containment, not evidence: success still requires
  # the real child-exit event. Name a leaked marker process directly instead of
  # letting the outer Vitest deadline hide the owned handle that remained live.
  if (-not $markerProcess.WaitForExit(10000)) {
    [Console]::Error.WriteLine("MARKER_PROCESS_SHUTDOWN_TIMEOUT")
    exit 49
  }
  # Windows is the authority for the native child status. PowerShell 5.1 can
  # leave the adapted Process.ExitCode property null after the timed overload
  # of WaitForExit(), which incorrectly compares as non-zero. Query the still
  # owned process handle directly and reject both an unavailable status and
  # STILL_ACTIVE after the exit signal.
  $markerExitCode = [uint32]0
  if (-not [TermwrightConsoleMarkerProbe]::GetExitCodeProcess(
    $markerProcess.Handle,
    [ref]$markerExitCode
  )) {
    [Console]::Error.WriteLine("MARKER_PROCESS_EXIT_CODE_UNAVAILABLE")
    exit 50
  }
  if ($markerExitCode -eq 259) {
    [Console]::Error.WriteLine("MARKER_PROCESS_STILL_ACTIVE_AFTER_EXIT")
    exit 51
  }
  if ($markerExitCode -ne 0) {
    [Console]::Error.WriteLine("MARKER_PROCESS_EXIT:" + $markerExitCode)
    exit 47
  }
} finally {
  if ($writer) { $writer.Dispose() }
  if ($reader) { $reader.Dispose() }
  if ($pipe) { $pipe.Dispose() }
  if ($markerProcess -and -not $markerProcess.HasExited) { $markerProcess.Kill() }
  if (-not [TermwrightConsoleMarkerProbe]::SetConsoleMode($output, $original)) { exit 48 }
}
