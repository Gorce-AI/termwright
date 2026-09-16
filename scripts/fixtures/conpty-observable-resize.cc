#include <windows.h>

#include <array>
#include <string>
#include <vector>

namespace {

constexpr SHORT kExpectedColumns = 120;
constexpr SHORT kExpectedRows = 40;

bool WriteAll(const HANDLE output, const std::string& bytes) {
  size_t offset = 0;
  while (offset < bytes.size()) {
    DWORD written = 0;
    if (!WriteFile(output, bytes.data() + offset,
                   static_cast<DWORD>(bytes.size() - offset), &written, nullptr) ||
        written == 0) {
      return false;
    }
    offset += written;
  }
  return true;
}

bool HostReplyLeaked(const HANDLE input) {
  DWORD count = 0;
  if (!GetNumberOfConsoleInputEvents(input, &count)) return true;
  if (count == 0) return false;
  std::vector<INPUT_RECORD> records(count);
  DWORD read = 0;
  if (!PeekConsoleInputW(input, records.data(), count, &read)) return true;
  for (DWORD index = 0; index < read; ++index) {
    const auto& record = records[index];
    if (record.EventType == KEY_EVENT && record.Event.KeyEvent.bKeyDown) return true;
  }
  return false;
}

bool ReadTerminalResponse(const HANDLE input, const BYTE terminator,
                          std::vector<BYTE>& response) {
  response.clear();
  while (response.size() < 64) {
    BYTE next = 0;
    DWORD read = 0;
    if (!ReadFile(input, &next, 1, &read, nullptr) || read != 1) return false;
    response.push_back(next);
    if (next == terminator) return true;
  }
  return false;
}

std::string Hex(const std::vector<BYTE>& bytes) {
  static constexpr char digits[] = "0123456789abcdef";
  std::string result(bytes.size() * 2, '\0');
  for (size_t index = 0; index < bytes.size(); ++index) {
    result[index * 2] = digits[bytes[index] >> 4];
    result[index * 2 + 1] = digits[bytes[index] & 0x0f];
  }
  return result;
}

struct RestoreInputMode {
  HANDLE input;
  DWORD mode;
  ~RestoreInputMode() { SetConsoleMode(input, mode); }
};

}  // namespace

int main() {
  static_assert(sizeof(KEY_EVENT_RECORD) == 16);
  static_assert(sizeof(INPUT_RECORD) == 20);

  const HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  const HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  if (input == INVALID_HANDLE_VALUE || output == INVALID_HANDLE_VALUE) return 39;

  DWORD original_mode = 0;
  if (!GetConsoleMode(input, &original_mode)) return 41;
  const RestoreInputMode restore{input, original_mode};
  if (!SetConsoleMode(input, original_mode | ENABLE_WINDOW_INPUT)) return 42;

  if (!SetConsoleCursorPosition(output, COORD{4, 2})) return 52;
  if (!WriteAll(output, "RESIZE-READY")) return 50;

  std::array<INPUT_RECORD, 1> records{};
  for (;;) {
    DWORD read = 0;
    if (!ReadConsoleInputW(input, records.data(), 1, &read)) return 43;
    if (read != 1 || records[0].EventType != WINDOW_BUFFER_SIZE_EVENT) continue;
    const auto size = records[0].Event.WindowBufferSizeEvent.dwSize;
    if (size.X != kExpectedColumns || size.Y != kExpectedRows) continue;
    break;
  }

  CONSOLE_SCREEN_BUFFER_INFO info{};
  if (!GetConsoleScreenBufferInfo(output, &info)) return 44;
  const SHORT columns = info.srWindow.Right - info.srWindow.Left + 1;
  const SHORT rows = info.srWindow.Bottom - info.srWindow.Top + 1;
  const bool host_reply_leaked = HostReplyLeaked(input);
  if (!WriteAll(output,
                "RESIZED:" + std::to_string(columns) + "x" + std::to_string(rows) +
                    ";HOST-CPR:" + std::to_string(info.dwCursorPosition.X) + "," +
                    std::to_string(info.dwCursorPosition.Y) + ";HOST-REPLY-LEAK:" +
                    (host_reply_leaked ? "true" : "false"))) {
    return 50;
  }
  if (columns != kExpectedColumns || rows != kExpectedRows) return 45;
  if (info.dwCursorPosition.X != 16 || info.dwCursorPosition.Y != 2) return 46;
  if (host_reply_leaked) return 47;

  if (!FlushConsoleInputBuffer(input)) return 48;
  const DWORD byte_input_mode = original_mode & ~ENABLE_LINE_INPUT & ~ENABLE_ECHO_INPUT &
                                ~ENABLE_WINDOW_INPUT & ~ENABLE_VIRTUAL_TERMINAL_INPUT;
  if (!SetConsoleMode(input, byte_input_mode)) return 49;
  if (!WriteAll(output, ";APP-DSR:\x1b[6n")) return 50;
  std::vector<BYTE> response;
  if (!ReadTerminalResponse(input, 'R', response)) return 51;
  if (!WriteAll(output, ";APP-CPR:" + Hex(response))) return 50;
  const std::vector<BYTE> expected_cpr{0x1b, '[', '9', ';', '1', '7', 'R'};
  if (response != expected_cpr) return 51;

  if (!SetConsoleMode(input, byte_input_mode | ENABLE_VIRTUAL_TERMINAL_INPUT)) return 55;
  if (!WriteAll(output, ";APP-MODE-QUERY:\x1b[?2026$p")) return 56;
  if (!ReadTerminalResponse(input, 'y', response)) return 57;
  if (!WriteAll(output, ";APP-MODE-REPLY:" + Hex(response))) return 56;
  const std::vector<BYTE> expected_mode{0x1b, '[', '?', '2', '0', '2', '6', ';', '2', '$', 'y'};
  if (response != expected_mode) return 57;
  if (!SetConsoleMode(input, byte_input_mode)) return 58;

  if (!WriteAll(output, ";ESC-READY")) return 53;
  for (;;) {
    DWORD read = 0;
    if (!ReadConsoleInputW(input, records.data(), 1, &read)) return 53;
    if (read != 1 || records[0].EventType != KEY_EVENT ||
        !records[0].Event.KeyEvent.bKeyDown) {
      continue;
    }
    const auto& key = records[0].Event.KeyEvent;
    if (!WriteAll(output,
                  ";ESC:" + Hex({static_cast<BYTE>(key.uChar.UnicodeChar)}) +
                      ";VK:" + std::to_string(key.wVirtualKeyCode) +
                      ";SCAN:" + std::to_string(key.wVirtualScanCode) +
                      ";REPEAT:" + std::to_string(key.wRepeatCount))) {
      return 53;
    }
    return key.uChar.UnicodeChar == 0x1b && key.wVirtualKeyCode == VK_ESCAPE &&
                   key.wVirtualScanCode == 1 && key.wRepeatCount == 1
               ? 0
               : 54;
  }
}
