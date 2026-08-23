// Termwright's Windows ConPTY session: one owner for one pseudoconsole.
//
// Everything that outlives a call lives here — the pseudoconsole, both pipe
// ends the host keeps, the root process and thread, the job object that owns
// the tree, and the two threads that move bytes. Nothing about the session is
// inferred from a timer or from enumerating process ids.

#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>

#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace termwright {

/// A HANDLE with exactly one owner, closed once.
class Handle {
 public:
  Handle() = default;
  explicit Handle(HANDLE value) : value_(value) {}
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& other) noexcept : value_(other.release()) {}
  Handle& operator=(Handle&& other) noexcept {
    if (this != &other) {
      Close();
      value_ = other.release();
    }
    return *this;
  }
  ~Handle() { Close(); }

  HANDLE get() const { return value_; }
  bool valid() const { return value_ != nullptr && value_ != INVALID_HANDLE_VALUE; }
  HANDLE* receive() { return &value_; }

  HANDLE release() {
    HANDLE taken = value_;
    value_ = nullptr;
    return taken;
  }

  void Close() {
    if (valid()) CloseHandle(value_);
    value_ = nullptr;
  }

 private:
  HANDLE value_ = nullptr;
};

/// What the session hands to JavaScript, in the order it happened.
///
/// `kNotice` carries the session's own account of its lifecycle: when the root
/// left, what the job said, and when the console was closed. It exists because
/// the alternative is inferring those moments from their consequences, and a
/// consequence arrives after the thing that caused it has stopped being
/// observable — the console takes its own evidence with it when it goes.
enum class EventKind { kData, kExit, kEof, kError, kNotice };

struct SessionEvent {
  EventKind kind = EventKind::kData;
  std::vector<uint8_t> data;  // kData
  DWORD exit_code = 0;        // kExit
  std::string message;        // kError
  DWORD last_error = 0;       // kError
};

struct SpawnOptions {
  std::wstring command_line;
  std::wstring cwd;                 // empty means inherit
  std::wstring environment_block;   // double-NUL terminated, empty means inherit
  SHORT columns = 80;
  SHORT rows = 24;
};

/**
 * The states a session moves through, in order.
 *
 * Every destructive transition happens at most once, and the enum is what
 * enforces it — not a scattering of booleans that can disagree with each
 * other. `kSourceEof` is reached only by the output reader observing the pipe
 * actually end; nothing else may set it.
 */
enum class State {
  kCreated,
  kRunning,
  kRootExited,
  kSourceEof,
  kDisposed,
};

class Session {
 public:
  using EventSink = void (*)(void* context, SessionEvent event);

  Session() = default;
  ~Session();
  Session(const Session&) = delete;
  Session& operator=(const Session&) = delete;

  /// Creates the pseudoconsole, the job, and the suspended root, then resumes.
  bool Start(const SpawnOptions& options, EventSink sink, void* context, std::string* error);

  DWORD pid() const { return pid_; }
  bool release_supported() const { return release_supported_; }

  void Write(const uint8_t* data, size_t length);
  bool Resize(SHORT columns, SHORT rows);
  /// Terminates the whole owned tree. Output keeps flowing until real EOF.
  void TerminateTree();
  /// Live members of the owned job, or -1 when the job cannot be queried.
  long long ActiveProcesses() const;
  void Dispose();

 private:
  void ReaderLoop();
  void WriterLoop();
  void WaitForRootExit();
  void WaitForEmptyTree();
  void Emit(SessionEvent event);
  /// Records a lifecycle moment on the same ordered channel as the output.
  void Notice(std::string message);

  HPCON pseudoconsole_ = nullptr;
  Handle host_output_read_;
  Handle host_input_write_;
  Handle root_process_;
  Handle root_thread_;
  Handle job_;
  Handle completion_port_;

  DWORD pid_ = 0;
  bool release_supported_ = false;

  std::atomic<State> state_{State::kCreated};
  std::atomic<bool> first_output_seen_{false};
  std::atomic<bool> closed_pseudoconsole_{false};
  std::atomic<bool> writer_stop_{false};

  std::thread reader_;
  std::thread writer_;
  std::thread exit_watcher_;

  std::mutex write_mutex_;
  std::condition_variable write_signal_;
  std::deque<std::vector<uint8_t>> write_queue_;

  std::mutex sink_mutex_;
  EventSink sink_ = nullptr;
  void* sink_context_ = nullptr;
};

}  // namespace termwright
