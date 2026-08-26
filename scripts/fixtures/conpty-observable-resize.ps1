$source = @'
using System;
using System.Runtime.InteropServices;

public static class TermwrightResizeProbe {
  private const int STD_INPUT_HANDLE = -10;
  private const int STD_OUTPUT_HANDLE = -11;
  private const uint ENABLE_WINDOW_INPUT = 0x0008;
  private const ushort WINDOW_BUFFER_SIZE_EVENT = 0x0004;

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
    [FieldOffset(4)] public COORD WindowBufferSize;
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
  private static extern bool GetConsoleScreenBufferInfo(
    IntPtr output,
    out CONSOLE_SCREEN_BUFFER_INFO info
  );

  public static int Run(short expectedColumns, short expectedRows) {
    var input = GetStdHandle(STD_INPUT_HANDLE);
    var output = GetStdHandle(STD_OUTPUT_HANDLE);
    uint originalMode;
    if (!GetConsoleMode(input, out originalMode)) return 41;
    if (!SetConsoleMode(input, originalMode | ENABLE_WINDOW_INPUT)) return 42;

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

        CONSOLE_SCREEN_BUFFER_INFO info;
        if (!GetConsoleScreenBufferInfo(output, out info)) return 44;
        var columns = info.Window.Right - info.Window.Left + 1;
        var rows = info.Window.Bottom - info.Window.Top + 1;
        Console.Out.Write("RESIZED:" + columns + "x" + rows);
        Console.Out.Flush();
        return columns == expectedColumns && rows == expectedRows ? 0 : 45;
      }
    } finally {
      SetConsoleMode(input, originalMode);
    }
  }
}
'@

Add-Type -TypeDefinition $source
exit [TermwrightResizeProbe]::Run(120, 40)
