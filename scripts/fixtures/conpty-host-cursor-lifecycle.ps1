param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    'alt-teardown',
    'same-buffer',
    'physical-buffers',
    'physical-buffers-helper',
    'input-eof',
    'input-eof-helper'
  )]
  [string]$Scenario,
  [string]$EventName = ''
)

$source = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class TermwrightHostCursorLifecycleProbe {
  private const int STD_INPUT_HANDLE = -10;
  private const int STD_OUTPUT_HANDLE = -11;
  private const uint GENERIC_READ = 0x80000000;
  private const uint GENERIC_WRITE = 0x40000000;
  private const uint FILE_SHARE_READ = 0x00000001;
  private const uint FILE_SHARE_WRITE = 0x00000002;
  private const uint CONSOLE_TEXTMODE_BUFFER = 0x00000001;
  private const uint ENABLE_PROCESSED_OUTPUT = 0x00000001;
  private const uint ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x00000004;
  private const uint ENABLE_LINE_INPUT = 0x00000002;
  private const uint ENABLE_ECHO_INPUT = 0x00000004;
  private const uint ENABLE_WINDOW_INPUT = 0x00000008;
  private const uint ENABLE_VIRTUAL_TERMINAL_INPUT = 0x00000200;
  private const ushort KEY_EVENT = 0x0001;
  private const ushort WINDOW_BUFFER_SIZE_EVENT = 0x0004;
  private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);
  private delegate bool ConsoleCtrlHandler(uint controlType);
  private static readonly EventWaitHandle ShutdownComplete =
    new EventWaitHandle(false, EventResetMode.ManualReset);
  private static readonly ConsoleCtrlHandler WaitForShutdown = controlType => {
    ShutdownComplete.WaitOne();
    return true;
  };

  [StructLayout(LayoutKind.Sequential)]
  public struct COORD {
    public short X;
    public short Y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct SMALL_RECT {
    public short Left;
    public short Top;
    public short Right;
    public short Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct CONSOLE_SCREEN_BUFFER_INFO {
    public COORD Size;
    public COORD CursorPosition;
    public ushort Attributes;
    public SMALL_RECT Window;
    public COORD MaximumWindowSize;
  }

  [StructLayout(LayoutKind.Explicit, Size = 20)]
  public struct INPUT_RECORD {
    [FieldOffset(0)] public ushort EventType;
    [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
    [FieldOffset(4)] public COORD WindowBufferSize;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct KEY_EVENT_RECORD {
    [MarshalAs(UnmanagedType.Bool)] public bool KeyDown;
    public ushort RepeatCount;
    public ushort VirtualKeyCode;
    public ushort VirtualScanCode;
    public char UnicodeChar;
    public uint ControlKeyState;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr GetStdHandle(int id);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool GetConsoleMode(IntPtr handle, out uint mode);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool SetConsoleMode(IntPtr handle, uint mode);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool ReadConsoleInputW(
    IntPtr input,
    [Out] INPUT_RECORD[] records,
    uint length,
    out uint read
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool PeekConsoleInputW(
    IntPtr input,
    [Out] INPUT_RECORD[] records,
    uint length,
    out uint read
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool GetNumberOfConsoleInputEvents(IntPtr input, out uint count);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool WriteFile(
    IntPtr handle,
    byte[] buffer,
    uint length,
    out uint written,
    IntPtr overlapped
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool GetConsoleScreenBufferInfo(
    IntPtr output,
    out CONSOLE_SCREEN_BUFFER_INFO info
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr CreateConsoleScreenBuffer(
    uint access,
    uint share,
    IntPtr security,
    uint flags,
    IntPtr data
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool SetConsoleActiveScreenBuffer(IntPtr output);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool CloseHandle(IntPtr handle);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool SetConsoleCtrlHandler(ConsoleCtrlHandler handler, bool add);

  private static bool WriteAll(IntPtr output, string text) {
    var bytes = System.Text.Encoding.UTF8.GetBytes(text);
    uint written;
    return WriteFile(output, bytes, (uint)bytes.Length, out written, IntPtr.Zero) &&
           written == (uint)bytes.Length;
  }

  private static bool ConfigureOutput(IntPtr output) {
    uint mode;
    return GetConsoleMode(output, out mode) &&
           SetConsoleMode(output, mode | ENABLE_PROCESSED_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
  }

  private static bool ReadResize(IntPtr input, short columns, short rows) {
    var records = new INPUT_RECORD[1];
    while (true) {
      uint read;
      if (!ReadConsoleInputW(input, records, 1, out read)) return false;
      if (read == 1 && records[0].EventType == WINDOW_BUFFER_SIZE_EVENT &&
          records[0].WindowBufferSize.X == columns && records[0].WindowBufferSize.Y == rows) {
        return true;
      }
    }
  }

  private static bool ReadCommand(IntPtr input, char expected) {
    var records = new INPUT_RECORD[1];
    while (true) {
      uint read;
      if (!ReadConsoleInputW(input, records, 1, out read)) return false;
      if (read == 1 && records[0].EventType == KEY_EVENT && records[0].KeyEvent.KeyDown &&
          records[0].KeyEvent.UnicodeChar == expected) {
        return true;
      }
    }
  }

  private static bool KeyDownPrecedesCommand(IntPtr input, char expected) {
    var records = new INPUT_RECORD[1];
    while (true) {
      uint read;
      if (!ReadConsoleInputW(input, records, 1, out read)) {
        throw new InvalidOperationException("input-command");
      }
      if (read != 1 || records[0].EventType != KEY_EVENT || !records[0].KeyEvent.KeyDown) continue;
      return records[0].KeyEvent.UnicodeChar != expected;
    }
  }

  private static bool KeyDownQueued(IntPtr input) {
    uint count;
    if (!GetNumberOfConsoleInputEvents(input, out count)) throw new InvalidOperationException("input-count");
    if (count == 0) return false;
    var records = new INPUT_RECORD[checked((int)count)];
    uint read;
    if (!PeekConsoleInputW(input, records, count, out read)) throw new InvalidOperationException("input-peek");
    for (var index = 0; index < (int)read; index++) {
      if (records[index].EventType == KEY_EVENT && records[index].KeyEvent.KeyDown) return true;
    }
    return false;
  }

  private sealed class Query {
    internal bool Success;
    internal CONSOLE_SCREEN_BUFFER_INFO Info;
  }

  private sealed class BorrowedProcessWaitHandle : WaitHandle {
    internal BorrowedProcessWaitHandle(System.Diagnostics.Process process) {
      SafeWaitHandle = new Microsoft.Win32.SafeHandles.SafeWaitHandle(process.Handle, false);
    }
  }

  private static Thread StartQuery(IntPtr output, Query result, CountdownEvent done) {
    var thread = new Thread(() => {
      try {
        result.Success = GetConsoleScreenBufferInfo(output, out result.Info);
      } finally {
        done.Signal();
      }
    });
    thread.IsBackground = true;
    thread.Start();
    return thread;
  }

  private static System.Diagnostics.Process StartHelper(
    string scriptPath,
    string scenario,
    string eventName
  ) {
    var start = new System.Diagnostics.ProcessStartInfo();
    start.FileName = "powershell.exe";
    start.UseShellExecute = false;
    start.Arguments =
      "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" +
      scriptPath.Replace("\"", "\\\"") + "\" -Scenario " + scenario +
      " -EventName \"" + eventName.Replace("\"", "\\\"") + "\"";
    return System.Diagnostics.Process.Start(start);
  }

  private static string NewHelperEventName() {
    return "Local\\TermwrightCursor-" +
      System.Diagnostics.Process.GetCurrentProcess().Id + "-" + Guid.NewGuid().ToString("N");
  }

  private static bool SignalHelperCompletion(string eventName) {
    using (var done = EventWaitHandle.OpenExisting(eventName + "-done")) {
      return done.Set();
    }
  }

  private static void StopHelper(System.Diagnostics.Process helper) {
    try {
      if (!helper.HasExited) helper.Kill();
    } catch (InvalidOperationException) {
      // The helper exited between HasExited and Kill.
    }
    try {
      helper.WaitForExit();
    } catch (InvalidOperationException) {
      // Process startup failed before a native handle became available.
    }
  }

  private static int PrepareInput(IntPtr input, out uint originalMode) {
    if (!GetConsoleMode(input, out originalMode)) return 60;
    // This fixture validates KEY_EVENT and WINDOW_BUFFER_SIZE_EVENT records
    // through ReadConsoleInputW. VT input mode deliberately serializes those
    // records back to terminal sequences before storage, so retaining an
    // inherited ENABLE_VIRTUAL_TERMINAL_INPUT would test the opposite API
    // contract and make a semantic KEY_EVENT impossible by construction.
    var mode = (originalMode | ENABLE_WINDOW_INPUT) &
               ~ENABLE_LINE_INPUT &
               ~ENABLE_ECHO_INPUT &
               ~ENABLE_VIRTUAL_TERMINAL_INPUT;
    return SetConsoleMode(input, mode) ? 0 : 61;
  }

  private static int VerifyStaleReplyIsConsumed(IntPtr input, IntPtr output) {
    if (!WriteAll(output, ";STALE-READY")) return 62;
    // The parent writes the stale host response before this physical key. The
    // key therefore proves the preceding response passed through ConPTY's
    // input state machine before we inspect the application queue.
    var leaked = KeyDownPrecedesCommand(input, 'C');
    // When C was first, also inspect records already queued behind it. This
    // catches both possible orderings without consuming leaked key-downs while
    // searching for the command itself.
    if (!leaked) leaked = KeyDownQueued(input);
    if (!WriteAll(output, ";STALE-LEAK:" + (leaked ? "true" : "false"))) return 64;
    return leaked ? 65 : 0;
  }

  private static int RunAltTeardown(IntPtr input, IntPtr output, short columns, short rows) {
    if (!WriteAll(output, "\x1b[?1049hALT-READY")) return 70;
    if (!ReadResize(input, columns, rows)) return 71;
    var result = new Query();
    using (var done = new CountdownEvent(1)) {
      var worker = StartQuery(output, result, done);
      if (!ReadCommand(input, 'T')) return 72;
      if (!WriteAll(output, "\x1b[?1049l")) return 73;
      done.Wait();
      worker.Join();
    }
    if (!result.Success) return 74;
    if (!WriteAll(output, "ALT-WAIT-RETURNED:ok")) return 75;
    return VerifyStaleReplyIsConsumed(input, output);
  }

  private static int RunSameBuffer(IntPtr input, IntPtr output, short columns, short rows) {
    if (!WriteAll(output, "SAME-READY")) return 80;
    if (!ReadResize(input, columns, rows)) return 81;
    var first = new Query();
    var second = new Query();
    using (var done = new CountdownEvent(2)) {
      var firstThread = StartQuery(output, first, done);
      var secondThread = StartQuery(output, second, done);
      done.Wait();
      firstThread.Join();
      secondThread.Join();
    }
    if (!first.Success || !second.Success) return 82;
    if (first.Info.CursorPosition.X != 30 || first.Info.CursorPosition.Y != 6 ||
        second.Info.CursorPosition.X != 30 || second.Info.CursorPosition.Y != 6) return 83;
    if (!WriteAll(output, "CONCURRENT-SAME:2:30,6")) return 84;
    return VerifyStaleReplyIsConsumed(input, output);
  }

  private static int RunPhysicalBufferHelper(
    IntPtr input,
    IntPtr output,
    short columns,
    short rows,
    bool inputEof,
    string eventName
  ) {
    if (String.IsNullOrEmpty(eventName)) return inputEof ? 130 : 100;
    if (!WriteAll(
        output,
        inputEof ? "EOF-HELPER-READY" : "PHYSICAL-HELPER-READY")) {
      return inputEof ? 140 : 110;
    }
    using (var start = EventWaitHandle.OpenExisting(eventName)) {
      start.WaitOne();
    }
    if (inputEof && !SetConsoleCtrlHandler(WaitForShutdown, true)) return 131;
    var secondOutput = CreateConsoleScreenBuffer(
      GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      IntPtr.Zero,
      CONSOLE_TEXTMODE_BUFFER,
      IntPtr.Zero
    );
    if (secondOutput == INVALID_HANDLE_VALUE) return inputEof ? 132 : 101;
    try {
      if (!ConfigureOutput(secondOutput)) return inputEof ? 133 : 102;
      if (!ReadCommand(input, 'B')) return inputEof ? 134 : 103;
      if (!SetConsoleActiveScreenBuffer(secondOutput)) return inputEof ? 135 : 104;
      if (!WriteAll(
          secondOutput,
          inputEof ? "\x1b[?1049hEOF-B-ALT-READY" : "PHYSICAL-B-READY")) {
        return inputEof ? 136 : 105;
      }
      if (!ReadResize(input, (short)(columns + 1), (short)(rows + 1))) {
        return inputEof ? 137 : 106;
      }
      var second = new Query();
      using (var done = new CountdownEvent(1)) {
        var secondThread = StartQuery(secondOutput, second, done);
        done.Wait();
        secondThread.Join();
      }
      if (!second.Success) return inputEof ? 138 : 107;
      if (inputEof) {
        if (!WriteAll(secondOutput, "EOF-B-WAITER")) return 139;
      } else {
        if (second.Info.CursorPosition.X != 30 || second.Info.CursorPosition.Y != 6) return 108;
        if (!WriteAll(secondOutput, "MULTI:B=30,6")) return 109;
      }
      return 0;
    } finally {
      SetConsoleActiveScreenBuffer(output);
      CloseHandle(secondOutput);
    }
  }

  private static int RunPhysicalBuffers(
    IntPtr input,
    IntPtr output,
    short columns,
    short rows,
    string scriptPath
  ) {
    var eventName = NewHelperEventName();
    using (var start = new EventWaitHandle(false, EventResetMode.ManualReset, eventName)) {
      using (var helper = StartHelper(scriptPath, "physical-buffers-helper", eventName)) {
        if (helper == null) return 90;
        try {
          if (!WriteAll(output, "PHYSICAL-A-READY")) return 91;
          if (!ReadResize(input, columns, rows)) return 92;
          start.Set();
          var first = new Query();
          using (var done = new CountdownEvent(1)) {
            var firstThread = StartQuery(output, first, done);
            done.Wait();
            firstThread.Join();
          }
          if (!first.Success) return 93;
          helper.WaitForExit();
          if (helper.ExitCode != 0) return 94;
          if (first.Info.CursorPosition.X != 10 || first.Info.CursorPosition.Y != 3) return 95;
          if (!WriteAll(output, "MULTI:A=10,3")) return 96;
          return 0;
        } finally {
          StopHelper(helper);
        }
      }
    }
  }

  private static int RunInputEof(
    IntPtr input,
    IntPtr output,
    short columns,
    short rows,
    string scriptPath
  ) {
    if (!SetConsoleCtrlHandler(WaitForShutdown, true)) return 110;
    try {
      var eventName = NewHelperEventName();
      using (var start = new EventWaitHandle(false, EventResetMode.ManualReset, eventName)) {
        using (var helperDone = new EventWaitHandle(
            false,
            EventResetMode.ManualReset,
            eventName + "-done")) {
          using (var helper = StartHelper(scriptPath, "input-eof-helper", eventName)) {
            if (helper == null) return 112;
            try {
              if (!WriteAll(output, "EOF-A-READY")) return 113;
              if (!ReadResize(input, columns, rows)) return 114;
              start.Set();
              var first = new Query();
              using (var done = new CountdownEvent(1)) {
                var firstThread = StartQuery(output, first, done);
                // No command follows B. The parent closes only ConPTY's input pipe
                // after both processes have established their addressed requests.
                done.Wait();
                firstThread.Join();
              }
              if (!first.Success) return 119;
              // A CTRL_CLOSE_EVENT gives every attached process one shared,
              // finite shutdown window. The helper signals only after its B
              // query completed and its finally restored physical buffer A;
              // waiting for that causal boundary avoids spending the window
              // inside PowerShell's outer process-exit machinery.
              using (var helperExit = new BorrowedProcessWaitHandle(helper)) {
                var boundary = WaitHandle.WaitAny(new WaitHandle[] { helperDone, helperExit });
                if (boundary == 1) {
                  helper.WaitForExit();
                  return 120;
                }
              }
              if (!WriteAll(output, "EOF-A-WAITER")) return 121;
              return 0;
            } finally {
              StopHelper(helper);
            }
          }
        }
      }
    } finally {
      // CTRL_CLOSE_EVENT handlers are allowed to return only after the main
      // thread has published every causal completion marker and cleaned up
      // the helper. Returning earlier gives Windows permission to terminate
      // this process in the middle of the shutdown proof.
      ShutdownComplete.Set();
      SetConsoleCtrlHandler(WaitForShutdown, false);
    }
  }

  public static int Run(
    string scenario,
    short columns,
    short rows,
    string scriptPath,
    string eventName
  ) {
    var input = GetStdHandle(STD_INPUT_HANDLE);
    var output = GetStdHandle(STD_OUTPUT_HANDLE);
    uint originalInputMode;
    var prepared = PrepareInput(input, out originalInputMode);
    if (prepared != 0) return prepared;
    if (!ConfigureOutput(output)) return 66;
    try {
      if (scenario == "alt-teardown") return RunAltTeardown(input, output, columns, rows);
      if (scenario == "same-buffer") return RunSameBuffer(input, output, columns, rows);
      if (scenario == "physical-buffers") return RunPhysicalBuffers(input, output, columns, rows, scriptPath);
      if (scenario == "physical-buffers-helper") return RunPhysicalBufferHelper(input, output, columns, rows, false, eventName);
      if (scenario == "input-eof") return RunInputEof(input, output, columns, rows, scriptPath);
      if (scenario == "input-eof-helper") {
        try {
          var result = RunPhysicalBufferHelper(input, output, columns, rows, true, eventName);
          if (result != 0) return result;
          return SignalHelperCompletion(eventName) ? 0 : 141;
        } finally {
          // Signal locally only after the cross-process completion event was
          // set. The handler may now return without exposing a partial frame.
          ShutdownComplete.Set();
          SetConsoleCtrlHandler(WaitForShutdown, false);
        }
      }
      return 67;
    } finally {
      SetConsoleMode(input, originalInputMode);
    }
  }
}
'@

Add-Type -TypeDefinition $source
exit [TermwrightHostCursorLifecycleProbe]::Run($Scenario, 120, 40, $PSCommandPath, $EventName)
