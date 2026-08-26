#pragma once

#include <atomic>
#include <cstdint>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <sys/types.h>

namespace termwright {

enum class PosixEventKind { kData, kExit, kEof, kDrain, kError };

struct PosixSessionEvent {
  PosixEventKind kind = PosixEventKind::kData;
  std::vector<uint8_t> data;
  int exit_code = 0;
  int signal = 0;
  int error_code = 0;
  uint64_t write_generation = 0;
  std::string message;
};

struct PosixSpawnOptions {
  std::vector<std::string> command;
  std::string cwd;
  std::vector<std::string> environment;
  unsigned short columns = 80;
  unsigned short rows = 24;
};

class PosixSession {
 public:
  using EventSink = void (*)(void* context, PosixSessionEvent event);

  PosixSession() = default;
  ~PosixSession();
  PosixSession(const PosixSession&) = delete;
  PosixSession& operator=(const PosixSession&) = delete;

  bool Start(const PosixSpawnOptions& options, EventSink sink, void* context,
             std::string* error);
  pid_t pid() const { return pid_; }
  bool Write(const uint8_t* data, size_t length, std::string* error);
  bool Resize(unsigned short columns, unsigned short rows);
  int Signal(int signal);
  int TreeState() const;
  void Dispose();

 private:
  void ReaderLoop();
  void WriterLoop();
  void WaitForRootExit();
  void Emit(PosixSessionEvent event);
  void EmitError(const char* operation, int code);
  void EmitEof(int code);
  void FailWriter(const char* operation, int code);

  pid_t pid_ = -1;
  std::atomic<int> master_{-1};
  int reader_wake_[2] = {-1, -1};
  int writer_wake_[2] = {-1, -1};
  std::atomic<bool> disposed_{false};
  std::atomic<bool> source_ended_{false};

  std::thread reader_;
  std::thread writer_;
  std::thread exit_watcher_;

  std::mutex write_mutex_;
  std::deque<std::vector<uint8_t>> write_queue_;
  size_t queued_write_bytes_ = 0;
  uint64_t write_generation_ = 0;
  bool writer_failed_ = false;
  std::string writer_error_;

  std::mutex sink_mutex_;
  EventSink sink_ = nullptr;
  void* sink_context_ = nullptr;
};

}  // namespace termwright
