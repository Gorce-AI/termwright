$source = @'
using System;
using System.Runtime.InteropServices;

public static class TermwrightResizeProbe {
  private const int STD_INPUT_HANDLE = -10;
  private const int STD_OUTPUT_HANDLE = -11;
  private const uint ENABLE_LINE_INPUT = 0x0002;
  private const uint ENABLE_ECHO_INPUT = 0x0004;
  private const uint ENABLE_WINDOW_INPUT = 0x0008;
  private const uint ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;
  private const ushort KEY_EVENT = 0x0001;
  private const ushort WINDOW_BUFFER_SIZE_EVENT = 0x0004;
  private const ushort VK_ESCAPE = 0x001b;

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

  [StructLayout(LayoutKind.Explicit, Size = 16, CharSet = CharSet.Unicode)]
  public struct KEY_EVENT_RECORD {
    [FieldOffset(0)] public int KeyDown;
    [FieldOffset(4)] public ushort RepeatCount;
    [FieldOffset(6)] public ushort VirtualKeyCode;
    [FieldOffset(8)] public ushort VirtualScanCode;
    [FieldOffset(10)] public ushort UnicodeChar;
    [FieldOffset(12)] public uint ControlKeyState;
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
  private static extern bool FlushConsoleInputBuffer(IntPtr input);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool ReadFile(
    IntPtr handle,
    [Out] byte[] buffer,
    uint length,
    out uint read,
    IntPtr overlapped
  );

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
  private static extern bool SetConsoleCursorPosition(IntPtr output, COORD position);

  private static bool WriteAll(IntPtr output, byte[] bytes) {
    uint written;
    return WriteFile(output, bytes, (uint)bytes.Length, out written, IntPtr.Zero) &&
           written == (uint)bytes.Length;
  }

  private static bool HostReplyLeaked(IntPtr input) {
    uint count;
    if (!GetNumberOfConsoleInputEvents(input, out count)) throw new InvalidOperationException("input-count");
    if (count == 0) return false;
    var records = new INPUT_RECORD[checked((int)count)];
    uint read;
    if (!PeekConsoleInputW(input, records, count, out read)) throw new InvalidOperationException("input-peek");
    for (var index = 0; index < (int)read; index++) {
      var record = records[index];
      if (record.EventType == KEY_EVENT && record.KeyEvent.KeyDown != 0) {
        return true;
      }
    }
    return false;
  }

  private static byte[] ReadCursorPositionReport(IntPtr input) {
    var result = new System.Collections.Generic.List<byte>();
    var next = new byte[1];
    while (result.Count < 64) {
      uint read;
      if (!ReadFile(input, next, 1, out read, IntPtr.Zero) || read != 1) {
        throw new InvalidOperationException("input-read");
      }
      result.Add(next[0]);
      if (next[0] == (byte)'R') return result.ToArray();
    }
    throw new InvalidOperationException("oversized-cpr");
  }

  private static bool InputRecordLayoutIsExact() {
    return Marshal.SizeOf(typeof(KEY_EVENT_RECORD)) == 16 &&
      Marshal.OffsetOf(typeof(KEY_EVENT_RECORD), "KeyDown").ToInt32() == 0 &&
      Marshal.OffsetOf(typeof(KEY_EVENT_RECORD), "RepeatCount").ToInt32() == 4 &&
      Marshal.OffsetOf(typeof(KEY_EVENT_RECORD), "VirtualKeyCode").ToInt32() == 6 &&
      Marshal.OffsetOf(typeof(KEY_EVENT_RECORD), "VirtualScanCode").ToInt32() == 8 &&
      Marshal.OffsetOf(typeof(KEY_EVENT_RECORD), "UnicodeChar").ToInt32() == 10 &&
      Marshal.OffsetOf(typeof(KEY_EVENT_RECORD), "ControlKeyState").ToInt32() == 12 &&
      Marshal.SizeOf(typeof(INPUT_RECORD)) == 20 &&
      Marshal.OffsetOf(typeof(INPUT_RECORD), "EventType").ToInt32() == 0 &&
      Marshal.OffsetOf(typeof(INPUT_RECORD), "KeyEvent").ToInt32() == 4 &&
      Marshal.OffsetOf(typeof(INPUT_RECORD), "WindowBufferSize").ToInt32() == 4;
  }

  public static int Run(short expectedColumns, short expectedRows) {
    if (!InputRecordLayoutIsExact()) return 40;
    var input = GetStdHandle(STD_INPUT_HANDLE);
    var output = GetStdHandle(STD_OUTPUT_HANDLE);
    uint originalMode;
    if (!GetConsoleMode(input, out originalMode)) return 41;
    if (!SetConsoleMode(input, originalMode | ENABLE_WINDOW_INPUT)) return 42;

    if (!SetConsoleCursorPosition(output, new COORD { X = 4, Y = 2 })) return 52;
    Console.Out.Write("RESIZE-READY");
    Console.Out.Flush();
    try {
      var records = new INPUT_RECORD[1];
      while (true) {
        uint read;
        if (!ReadConsoleInputW(input, records, 1, out read)) return 43;
        if (read != 1 || records[0].EventType != WINDOW_BUFFER_SIZE_EVENT) continue;
        if (records[0].WindowBufferSize.X != expectedColumns ||
            records[0].WindowBufferSize.Y != expectedRows) continue;

        // This call is the runtime host-query seam under test. Resize marks
        // OpenConsole's cursor shadow dirty; GetConsoleScreenBufferInfo emits
        // a request-addressed private RPC and blocks for its matching reply.
        CONSOLE_SCREEN_BUFFER_INFO info;
        if (!GetConsoleScreenBufferInfo(output, out info)) return 44;
        var columns = info.Window.Right - info.Window.Left + 1;
        var rows = info.Window.Bottom - info.Window.Top + 1;
        var hostReplyLeaked = HostReplyLeaked(input);
        Console.Out.Write(
          "RESIZED:" + columns + "x" + rows +
          ";HOST-CPR:" + info.CursorPosition.X + "," + info.CursorPosition.Y +
          ";HOST-REPLY-LEAK:" + (hostReplyLeaked ? "true" : "false")
        );
        Console.Out.Flush();
        if (columns != expectedColumns || rows != expectedRows) return 45;
        if (info.CursorPosition.X != 16 || info.CursorPosition.Y != 2) return 46;
        if (hostReplyLeaked) return 47;

        // Remove resize/focus records before the byte-oriented application
        // query. VT input is deliberately disabled: the private application
        // envelope must still commit the complete CPR without host capture or
        // byte splitting.
        if (!FlushConsoleInputBuffer(input)) return 48;
        var byteInputMode = originalMode &
          ~ENABLE_LINE_INPUT &
          ~ENABLE_ECHO_INPUT &
          ~ENABLE_WINDOW_INPUT &
          ~ENABLE_VIRTUAL_TERMINAL_INPUT;
        if (!SetConsoleMode(input, byteInputMode)) return 49;
        var dsr = new byte[] { 0x1b, 0x5b, 0x36, 0x6e };
        var prefix = System.Text.Encoding.ASCII.GetBytes(";APP-DSR:");
        if (!WriteAll(output, prefix) || !WriteAll(output, dsr)) return 50;
        var response = ReadCursorPositionReport(input);
        Console.Out.Write(";APP-CPR:" + BitConverter.ToString(response).Replace("-", "").ToLowerInvariant());
        Console.Out.Flush();
        var expected = new byte[] { 0x1b, 0x5b, 0x39, 0x3b, 0x31, 0x37, 0x52 };
        if (!System.Linq.Enumerable.SequenceEqual(response, expected)) return 51;

        // Once ConPTY has observed W32IM, a raw trailing ESC is deliberately
        // retained as a possible split control sequence. Termwright's key
        // transport must therefore deliver a physical Escape as one W32IM
        // KEY_EVENT, without needing a second byte to disambiguate it.
        Console.Out.Write(";ESC-READY");
        Console.Out.Flush();
        var escapeRecords = new INPUT_RECORD[1];
        while (true) {
          uint escapeRead;
          if (!ReadConsoleInputW(input, escapeRecords, 1, out escapeRead)) return 53;
          if (escapeRead != 1 || escapeRecords[0].EventType != KEY_EVENT || escapeRecords[0].KeyEvent.KeyDown == 0) continue;
          var escape = escapeRecords[0].KeyEvent;
          Console.Out.Write(
            ";ESC:" + ((int)escape.UnicodeChar).ToString("x2") +
            ";VK:" + escape.VirtualKeyCode +
            ";SCAN:" + escape.VirtualScanCode +
            ";REPEAT:" + escape.RepeatCount
          );
          Console.Out.Flush();
          return escape.UnicodeChar == 0x1b &&
            escape.VirtualKeyCode == VK_ESCAPE &&
            escape.VirtualScanCode == 1 &&
            escape.RepeatCount == 1 ? 0 : 54;
        }
      }
    } finally {
      SetConsoleMode(input, originalMode);
    }
  }
}
'@

Add-Type -TypeDefinition $source
exit [TermwrightResizeProbe]::Run(120, 40)
