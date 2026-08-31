param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('alt-teardown', 'same-buffer', 'physical-buffers', 'input-eof')]
  [string]$Scenario
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
  private static readonly ConsoleCtrlHandler IgnoreClose = controlType => true;

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

  private static int RunPhysicalBuffers(IntPtr input, IntPtr output, short columns, short rows) {
    var secondOutput = CreateConsoleScreenBuffer(
      GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      IntPtr.Zero,
      CONSOLE_TEXTMODE_BUFFER,
      IntPtr.Zero
    );
    if (secondOutput == INVALID_HANDLE_VALUE) return 90;
    try {
      if (!ConfigureOutput(secondOutput)) return 91;
      if (!WriteAll(output, "PHYSICAL-A-READY")) return 92;
      if (!ReadResize(input, columns, rows)) return 93;
      var first = new Query();
      var second = new Query();
      using (var done = new CountdownEvent(2)) {
        // Begin A's query while A is still active. The asynchronous Console API
        // waiter releases the console lock, so the main thread can switch the
        // physical buffer without resolving or invalidating A's request.
        var firstThread = StartQuery(output, first, done);
        if (!ReadCommand(input, 'B')) return 94;
        if (!SetConsoleActiveScreenBuffer(secondOutput)) return 95;
        if (!WriteAll(secondOutput, "PHYSICAL-B-READY")) return 96;
        if (!ReadResize(input, (short)(columns + 1), (short)(rows + 1))) return 97;
        var secondThread = StartQuery(secondOutput, second, done);
        done.Wait();
        firstThread.Join();
        secondThread.Join();
      }
      if (!first.Success || !second.Success) return 98;
      if (first.Info.CursorPosition.X != 10 || first.Info.CursorPosition.Y != 3 ||
          second.Info.CursorPosition.X != 30 || second.Info.CursorPosition.Y != 6) return 99;
      if (!WriteAll(secondOutput,
          "MULTI:A=" + first.Info.CursorPosition.X + "," + first.Info.CursorPosition.Y +
          ";B=" + second.Info.CursorPosition.X + "," + second.Info.CursorPosition.Y)) return 100;
      return 0;
    } finally {
      SetConsoleActiveScreenBuffer(output);
      CloseHandle(secondOutput);
    }
  }

  private static int RunInputEof(IntPtr input, IntPtr output, short columns, short rows) {
    if (!SetConsoleCtrlHandler(IgnoreClose, true)) return 110;
    var secondOutput = CreateConsoleScreenBuffer(
      GENERIC_READ | GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      IntPtr.Zero,
      CONSOLE_TEXTMODE_BUFFER,
      IntPtr.Zero
    );
    if (secondOutput == INVALID_HANDLE_VALUE) return 111;
    try {
      if (!ConfigureOutput(secondOutput)) return 112;
      if (!WriteAll(output, "EOF-A-READY")) return 113;
      if (!ReadResize(input, columns, rows)) return 114;
      var first = new Query();
      var second = new Query();
      using (var done = new CountdownEvent(2)) {
        var firstThread = StartQuery(output, first, done);
        if (!ReadCommand(input, 'B')) return 115;
        if (!SetConsoleActiveScreenBuffer(secondOutput)) return 116;
        if (!WriteAll(secondOutput, "\x1b[?1049hEOF-B-ALT-READY")) return 117;
        if (!ReadResize(input, (short)(columns + 1), (short)(rows + 1))) return 118;
        var secondThread = StartQuery(secondOutput, second, done);
        // No command follows. The parent closes only ConPTY's input pipe after
        // it has observed both addressed requests. SendCloseEvent must cancel
        // both synchronization states and wake this causal barrier.
        done.Wait();
        firstThread.Join();
        secondThread.Join();
      }
      if (!first.Success || !second.Success) return 119;
      if (!WriteAll(secondOutput, "EOF-WAITERS:2")) return 120;
      if (!WriteAll(secondOutput, "\x1b[?1049l")) return 121;
      return 0;
    } finally {
      SetConsoleActiveScreenBuffer(output);
      CloseHandle(secondOutput);
      SetConsoleCtrlHandler(IgnoreClose, false);
    }
  }

  public static int Run(string scenario, short columns, short rows) {
    var input = GetStdHandle(STD_INPUT_HANDLE);
    var output = GetStdHandle(STD_OUTPUT_HANDLE);
    uint originalInputMode;
    var prepared = PrepareInput(input, out originalInputMode);
    if (prepared != 0) return prepared;
    if (!ConfigureOutput(output)) return 66;
    try {
      if (scenario == "alt-teardown") return RunAltTeardown(input, output, columns, rows);
      if (scenario == "same-buffer") return RunSameBuffer(input, output, columns, rows);
      if (scenario == "physical-buffers") return RunPhysicalBuffers(input, output, columns, rows);
      if (scenario == "input-eof") return RunInputEof(input, output, columns, rows);
      return 67;
    } finally {
      SetConsoleMode(input, originalInputMode);
    }
  }
}
'@

Add-Type -TypeDefinition $source
exit [TermwrightHostCursorLifecycleProbe]::Run($Scenario, 120, 40)
