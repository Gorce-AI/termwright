#include "posix-session.h"

#include <cerrno>
#include <csignal>
#include <cstring>
#include <limits.h>

#include <fcntl.h>
#include <poll.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <util.h>
#else
#include <pty.h>
#endif

namespace termwright {
namespace {

constexpr size_t kMaximumQueuedWriteBytes = 8 * 1024 * 1024;

std::string ErrnoMessage(const char* operation, int code) {
  return std::string(operation) + " failed: " + std::strerror(code) +
         " (errno " + std::to_string(code) + ")";
}

bool CreateCloseOnExecPipe(int descriptors[2], std::string* error) {
  if (pipe(descriptors) != 0) {
    *error = ErrnoMessage("pipe", errno);
    return false;
  }
  for (int descriptor : {descriptors[0], descriptors[1]}) {
    if (fcntl(descriptor, F_SETFD, FD_CLOEXEC) == -1) {
      const int code = errno;
      close(descriptors[0]);
      close(descriptors[1]);
      descriptors[0] = descriptors[1] = -1;
      *error = ErrnoMessage("fcntl(FD_CLOEXEC)", code);
      return false;
    }
  }
  return true;
}

void CloseDescriptor(int* descriptor) {
  if (*descriptor >= 0) close(*descriptor);
  *descriptor = -1;
}

void Wake(int descriptor) {
  if (descriptor < 0) return;
  const uint8_t byte = 1;
  while (write(descriptor, &byte, sizeof(byte)) == -1 && errno == EINTR) {
  }
}

std::vector<char*> Pointers(std::vector<std::string>* values) {
  std::vector<char*> pointers;
  pointers.reserve(values->size() + 1);
  for (std::string& value : *values) pointers.push_back(value.data());
  pointers.push_back(nullptr);
  return pointers;
}

bool ResolveExecutable(std::vector<std::string>* command,
                       const std::vector<std::string>& environment,
                       const std::string& requested_cwd, std::string* error) {
  if ((*command)[0].find('/') != std::string::npos) return true;

  char current[PATH_MAX];
  if (getcwd(current, sizeof(current)) == nullptr) {
    *error = ErrnoMessage("getcwd", errno);
    return false;
  }
  const std::string child_cwd = requested_cwd.empty()
                                    ? std::string(current)
                                    : requested_cwd[0] == '/'
                                        ? requested_cwd
                                        : std::string(current) + "/" + requested_cwd;
  std::string search = "/usr/bin:/bin";
  for (const std::string& entry : environment) {
    if (entry.rfind("PATH=", 0) == 0) {
      search = entry.substr(5);
      break;
    }
  }

  size_t begin = 0;
  for (;;) {
    const size_t end = search.find(':', begin);
    const std::string directory = search.substr(begin, end - begin);
    const std::string base = directory.empty()
                                 ? child_cwd
                                 : directory[0] == '/'
                                     ? directory
                                     : child_cwd + "/" + directory;
    const std::string candidate = base + "/" + (*command)[0];
    struct stat metadata {};
    if (stat(candidate.c_str(), &metadata) == 0 && !S_ISDIR(metadata.st_mode) &&
        access(candidate.c_str(), X_OK) == 0) {
      (*command)[0] = candidate;
      return true;
    }
    if (end == std::string::npos) break;
    begin = end + 1;
  }
  *error = "executable not found on PATH: " + (*command)[0];
  return false;
}

}  // namespace

PosixSession::~PosixSession() { Dispose(); }

bool PosixSession::Start(const PosixSpawnOptions& options, EventSink sink, void* context,
                         std::string* error) {
  if (options.command.empty()) {
    *error = "a PTY command needs at least an executable";
    return false;
  }

  std::vector<std::string> command = options.command;
  if (!ResolveExecutable(&command, options.environment, options.cwd, error)) return false;

  int exec_status[2] = {-1, -1};
  if (!CreateCloseOnExecPipe(exec_status, error) ||
      !CreateCloseOnExecPipe(reader_wake_, error) ||
      !CreateCloseOnExecPipe(writer_wake_, error)) {
    CloseDescriptor(&exec_status[0]);
    CloseDescriptor(&exec_status[1]);
    CloseDescriptor(&reader_wake_[0]);
    CloseDescriptor(&reader_wake_[1]);
    CloseDescriptor(&writer_wake_[0]);
    CloseDescriptor(&writer_wake_[1]);
    return false;
  }

  std::vector<std::string> environment = options.environment;
  std::vector<char*> argv = Pointers(&command);
  std::vector<char*> envp = Pointers(&environment);
  struct winsize size {};
  size.ws_col = options.columns;
  size.ws_row = options.rows;

  int master = -1;
  const pid_t child = forkpty(&master, nullptr, nullptr, &size);
  if (child == -1) {
    const int code = errno;
    CloseDescriptor(&exec_status[0]);
    CloseDescriptor(&exec_status[1]);
    CloseDescriptor(&reader_wake_[0]);
    CloseDescriptor(&reader_wake_[1]);
    CloseDescriptor(&writer_wake_[0]);
    CloseDescriptor(&writer_wake_[1]);
    *error = ErrnoMessage("forkpty", code);
    return false;
  }

  if (child == 0) {
    close(exec_status[0]);
    close(reader_wake_[0]);
    close(reader_wake_[1]);
    close(writer_wake_[0]);
    close(writer_wake_[1]);
    if (!options.cwd.empty() && chdir(options.cwd.c_str()) != 0) {
      const int code = errno;
      (void)write(exec_status[1], &code, sizeof(code));
      _exit(127);
    }
    execve(command[0].c_str(), argv.data(), envp.data());
    const int code = errno;
    (void)write(exec_status[1], &code, sizeof(code));
    _exit(127);
  }

  close(exec_status[1]);
  exec_status[1] = -1;
  int exec_error = 0;
  ssize_t status_read;
  do {
    status_read = read(exec_status[0], &exec_error, sizeof(exec_error));
  } while (status_read == -1 && errno == EINTR);
  CloseDescriptor(&exec_status[0]);
  if (status_read > 0) {
    close(master);
    int ignored = 0;
    while (waitpid(child, &ignored, 0) == -1 && errno == EINTR) {
    }
    CloseDescriptor(&reader_wake_[0]);
    CloseDescriptor(&reader_wake_[1]);
    CloseDescriptor(&writer_wake_[0]);
    CloseDescriptor(&writer_wake_[1]);
    *error = ErrnoMessage("execve", exec_error);
    return false;
  }
  if (status_read == -1) {
    const int code = errno;
    kill(-child, SIGKILL);
    close(master);
    int ignored = 0;
    while (waitpid(child, &ignored, 0) == -1 && errno == EINTR) {
    }
    CloseDescriptor(&reader_wake_[0]);
    CloseDescriptor(&reader_wake_[1]);
    CloseDescriptor(&writer_wake_[0]);
    CloseDescriptor(&writer_wake_[1]);
    *error = ErrnoMessage("read(exec status)", code);
    return false;
  }

  const int flags = fcntl(master, F_GETFL, 0);
  if (flags == -1 || fcntl(master, F_SETFL, flags | O_NONBLOCK) == -1 ||
      fcntl(master, F_SETFD, FD_CLOEXEC) == -1) {
    const int code = errno;
    kill(-child, SIGKILL);
    close(master);
    int ignored = 0;
    while (waitpid(child, &ignored, 0) == -1 && errno == EINTR) {
    }
    CloseDescriptor(&reader_wake_[0]);
    CloseDescriptor(&reader_wake_[1]);
    CloseDescriptor(&writer_wake_[0]);
    CloseDescriptor(&writer_wake_[1]);
    *error = ErrnoMessage("configure PTY master", code);
    return false;
  }

  {
    std::lock_guard<std::mutex> lock(sink_mutex_);
    sink_ = sink;
    sink_context_ = context;
  }
  pid_ = child;
  master_.store(master);
  reader_ = std::thread([this] { ReaderLoop(); });
  writer_ = std::thread([this] { WriterLoop(); });
  exit_watcher_ = std::thread([this] { WaitForRootExit(); });
  return true;
}

void PosixSession::ReaderLoop() {
  std::vector<uint8_t> buffer(64 * 1024);
  // A PTY may return only a few kilobytes per read even when much more is
  // already queued. Coalesce only what is immediately available, with a hard
  // cap, so a megabyte tail does not become hundreds of cross-thread calls.
  // EAGAIN remains the latency boundary for interactive output.
  constexpr size_t kDeliveryBytes = 256 * 1024;
  for (;;) {
    pollfd descriptors[2] = {
        {master_.load(), POLLIN, 0},
        {reader_wake_[0], POLLIN, 0},
    };
    int ready;
    do {
      ready = poll(descriptors, 2, -1);
    } while (ready == -1 && errno == EINTR);
    if (ready == -1) {
      EmitError("poll(PTY output)", errno);
      EmitEof(errno);
      return;
    }
    if ((descriptors[1].revents & POLLIN) != 0) {
      // Disposal has its own JS-side completion and is deliberately not an
      // EOF observation. Publishing a synthetic end here would let a teardown
      // race overwrite the reason reported by a real source end.
      return;
    }
    const bool terminal_end =
        (descriptors[0].revents & (POLLHUP | POLLERR | POLLNVAL)) != 0;
    if ((descriptors[0].revents & POLLIN) == 0 && !terminal_end) continue;

    std::vector<uint8_t> delivery;
    const auto publish = [this, &delivery]() {
      if (delivery.empty()) return;
      PosixSessionEvent event;
      event.kind = PosixEventKind::kData;
      event.data = std::move(delivery);
      Emit(std::move(event));
      delivery.clear();
    };
    for (;;) {
      const ssize_t count = read(master_.load(), buffer.data(), buffer.size());
      if (count > 0) {
        delivery.insert(delivery.end(), buffer.begin(), buffer.begin() + count);
        if (delivery.size() >= kDeliveryBytes) publish();
        continue;
      }
      if (count == 0) {
        publish();
        EmitEof(0);
        return;
      }
      const int code = errno;
      if (code == EINTR) continue;
      if (code == EIO) {
        // Linux reports a closed PTY slave as EIO after every queued byte has
        // been read. It is the PTY form of EOF, not an I/O failure.
        publish();
        EmitEof(0);
        return;
      }
      if (code == EAGAIN || code == EWOULDBLOCK) {
        publish();
        if (terminal_end) {
          EmitEof(0);
          return;
        }
        break;
      }
      publish();
      EmitError("read(PTY master)", code);
      EmitEof(code);
      return;
    }
  }
}

void PosixSession::WriterLoop() {
  for (;;) {
    std::vector<uint8_t> pending;
    {
      std::unique_lock<std::mutex> lock(write_mutex_);
      write_signal_.wait(lock, [this] {
        return disposed_.load() || !write_queue_.empty();
      });
      if (write_queue_.empty()) {
        if (disposed_.load()) return;
        continue;
      }
      pending = std::move(write_queue_.front());
      write_queue_.pop_front();
    }

    size_t offset = 0;
    while (offset < pending.size()) {
      if (disposed_.load()) return;
      const ssize_t count = write(master_.load(), pending.data() + offset,
                                  pending.size() - offset);
      if (count > 0) {
        offset += static_cast<size_t>(count);
        continue;
      }
      if (count == -1 && errno == EINTR) continue;
      if (count == -1 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
        pollfd descriptors[2] = {
            {master_.load(), POLLOUT, 0},
            {writer_wake_[0], POLLIN, 0},
        };
        int ready;
        do {
          ready = poll(descriptors, 2, -1);
        } while (ready == -1 && errno == EINTR);
        if (ready > 0 && (descriptors[1].revents & POLLIN) != 0) return;
        if (ready > 0 && (descriptors[0].revents & POLLOUT) != 0) continue;
        if (ready == -1) FailWriter("poll(PTY input)", errno);
        else FailWriter("write(PTY master)", EIO);
        return;
      }
      FailWriter("write(PTY master)", count == -1 ? errno : EIO);
      return;
    }

    bool drained;
    {
      std::lock_guard<std::mutex> lock(write_mutex_);
      queued_write_bytes_ -= pending.size();
      drained = queued_write_bytes_ == 0;
    }
    if (drained) {
      PosixSessionEvent event;
      event.kind = PosixEventKind::kDrain;
      Emit(std::move(event));
    }
  }
}

void PosixSession::WaitForRootExit() {
  siginfo_t observation {};
  int observed;
  do {
    observed = waitid(P_PID, static_cast<id_t>(pid_), &observation, WEXITED | WNOWAIT);
  } while (observed == -1 && errno == EINTR);
  if (observed == -1) {
    EmitError("waitid(WNOWAIT)", errno);
    return;
  }

  // The root is known to have exited but remains unreaped here, so its PID
  // and process-group id cannot be reused. Kill remaining group members at
  // this boundary, then reap the root.
  if (kill(-pid_, SIGKILL) == -1 && errno != ESRCH) {
#if defined(__APPLE__)
    // Darwin reports EPERM when the process group contains only its unreaped
    // zombie leader. Any live descendant created by this child has the same
    // credentials, so killpg succeeds if there is a signalable member. At
    // this exact WNOWAIT boundary EPERM therefore means there was no live
    // descendant to terminate; it is not an ownership failure.
    if (errno != EPERM) EmitError("kill(process group)", errno);
#else
    EmitError("kill(process group)", errno);
#endif
  }

  int status = 0;
  pid_t waited;
  do {
    waited = waitpid(pid_, &status, 0);
  } while (waited == -1 && errno == EINTR);
  if (waited == -1) {
    EmitError("waitpid", errno);
    return;
  }

  PosixSessionEvent event;
  event.kind = PosixEventKind::kExit;
  if (WIFEXITED(status)) {
    event.exit_code = WEXITSTATUS(status);
  } else if (WIFSIGNALED(status)) {
    event.exit_code = -1;
    event.signal = WTERMSIG(status);
  } else {
    event.exit_code = -1;
  }
  Emit(std::move(event));
}

bool PosixSession::Write(const uint8_t* data, size_t length, std::string* error) {
  if (length == 0) return true;
  std::lock_guard<std::mutex> lock(write_mutex_);
  if (disposed_.load() || source_ended_.load()) {
    *error = "PTY input is closed";
    return false;
  }
  if (writer_failed_) {
    *error = writer_error_;
    return false;
  }
  if (length > kMaximumQueuedWriteBytes - queued_write_bytes_) {
    *error = "PTY input queue capacity exceeded (8 MiB)";
    return false;
  }
  write_queue_.emplace_back(data, data + length);
  queued_write_bytes_ += length;
  write_signal_.notify_one();
  return true;
}

bool PosixSession::Resize(unsigned short columns, unsigned short rows) {
  const int master = master_.load();
  if (master < 0 || disposed_.load()) return false;
  struct winsize size {};
  size.ws_col = columns;
  size.ws_row = rows;
  return ioctl(master, TIOCSWINSZ, &size) == 0;
}

bool PosixSession::Signal(int signal) {
  if (pid_ <= 0 || disposed_.load()) return false;
  if (kill(-pid_, signal) == 0) return true;
  return errno == ESRCH;
}

int PosixSession::TreeState() const {
  if (pid_ <= 0) return -1;
  if (kill(-pid_, 0) == 0) return 1;
  if (errno == ESRCH) return 0;
  if (errno == EPERM) return 1;
  return -1;
}

void PosixSession::EmitError(const char* operation, int code) {
  PosixSessionEvent event;
  event.kind = PosixEventKind::kError;
  event.error_code = code;
  event.message = ErrnoMessage(operation, code);
  Emit(std::move(event));
}

void PosixSession::FailWriter(const char* operation, int code) {
  const std::string message = ErrnoMessage(operation, code);
  {
    std::lock_guard<std::mutex> lock(write_mutex_);
    if (writer_failed_) return;
    writer_failed_ = true;
    writer_error_ = message;
    write_queue_.clear();
    queued_write_bytes_ = 0;
  }
  PosixSessionEvent event;
  event.kind = PosixEventKind::kError;
  event.error_code = code;
  event.message = message;
  Emit(std::move(event));
}

void PosixSession::EmitEof(int code) {
  if (source_ended_.exchange(true)) return;
  PosixSessionEvent event;
  event.kind = PosixEventKind::kEof;
  event.error_code = code;
  Emit(std::move(event));
}

void PosixSession::Emit(PosixSessionEvent event) {
  EventSink sink = nullptr;
  void* context = nullptr;
  {
    std::lock_guard<std::mutex> lock(sink_mutex_);
    sink = sink_;
    context = sink_context_;
  }
  if (sink != nullptr) sink(context, std::move(event));
}

void PosixSession::Dispose() {
  if (disposed_.exchange(true)) return;

  if (pid_ > 0) {
    if (kill(-pid_, SIGHUP) == -1 && errno != ESRCH) {
      EmitError("hang up process group", errno);
    }
    if (kill(-pid_, SIGKILL) == -1 && errno != ESRCH) {
      EmitError("terminate process group", errno);
    }
  }
  Wake(reader_wake_[1]);
  Wake(writer_wake_[1]);
  {
    std::lock_guard<std::mutex> lock(write_mutex_);
    write_queue_.clear();
  }
  write_signal_.notify_all();

  if (writer_.joinable()) writer_.join();
  if (reader_.joinable()) reader_.join();
  if (exit_watcher_.joinable()) exit_watcher_.join();

  {
    std::lock_guard<std::mutex> lock(write_mutex_);
    queued_write_bytes_ = 0;
  }

  const int master = master_.exchange(-1);
  if (master >= 0) close(master);
  CloseDescriptor(&reader_wake_[0]);
  CloseDescriptor(&reader_wake_[1]);
  CloseDescriptor(&writer_wake_[0]);
  CloseDescriptor(&writer_wake_[1]);

  std::lock_guard<std::mutex> lock(sink_mutex_);
  sink_ = nullptr;
  sink_context_ = nullptr;
}

}  // namespace termwright
