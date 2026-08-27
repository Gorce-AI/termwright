#include "posix-session.h"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <csignal>
#include <cstring>
#include <limits.h>

#include <fcntl.h>
#include <poll.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#if defined(__linux__)
#include <dirent.h>
#include <sys/syscall.h>
#endif

#if defined(__APPLE__)
#include <libproc.h>
#include <sys/event.h>
#include <sys/sysctl.h>
#include <util.h>
#else
#include <pty.h>
#endif

namespace termwright {
namespace {

constexpr size_t kMaximumQueuedWriteBytes = 8 * 1024 * 1024;

#if defined(__APPLE__)
bool CaptureLiveDarwinProcessGroup(pid_t group, std::vector<pid_t>* pids,
                                   int* error) {
  int query[] = {CTL_KERN, KERN_PROC, KERN_PROC_PGRP, group};
  for (;;) {
    size_t bytes = 0;
    if (sysctl(query, 4, nullptr, &bytes, nullptr, 0) == -1) {
      *error = errno;
      return false;
    }
    std::vector<kinfo_proc> records(bytes / sizeof(kinfo_proc) + 16);
    bytes = records.size() * sizeof(kinfo_proc);
    if (sysctl(query, 4, records.data(), &bytes, nullptr, 0) == -1) {
      if (errno == ENOMEM) continue;
      *error = errno;
      return false;
    }
    records.resize(bytes / sizeof(kinfo_proc));
    for (const kinfo_proc& record : records) {
      const pid_t candidate = record.kp_proc.p_pid;
      if (candidate <= 0 || candidate == group ||
          record.kp_proc.p_stat == SZOMB) {
        continue;
      }
      pids->push_back(candidate);
    }
    return true;
  }
}

bool DrainDarwinProcessGroup(pid_t group, int wake_descriptor, int* error) {
  for (;;) {
    if (kill(-group, SIGKILL) == -1) {
      const int code = errno;
      if (code == ESRCH) return true;
      if (code != EPERM) {
        *error = code;
        return false;
      }
    }

    std::vector<pid_t> pids;
    if (!CaptureLiveDarwinProcessGroup(group, &pids, error)) return false;
    if (pids.empty()) return true;

    const int queue = kqueue();
    if (queue == -1) {
      *error = errno;
      return false;
    }
    struct kevent wake_change;
    EV_SET(&wake_change, static_cast<uintptr_t>(wake_descriptor), EVFILT_READ,
           EV_ADD | EV_ENABLE, 0, 0, nullptr);
    if (kevent(queue, &wake_change, 1, nullptr, 0, nullptr) == -1) {
      *error = errno;
      close(queue);
      return false;
    }

    size_t observed = 0;
    bool all_exiting = true;
    for (pid_t candidate : pids) {
      struct kevent process_change;
      EV_SET(&process_change, static_cast<uintptr_t>(candidate), EVFILT_PROC,
             EV_ADD | EV_ENABLE | EV_ONESHOT, NOTE_EXIT, 0, nullptr);
      if (kevent(queue, &process_change, 1, nullptr, 0, nullptr) == -1) {
        if (errno == ESRCH) continue;
        *error = errno;
        close(queue);
        return false;
      }

      // EV_ADD pins the proc object before this membership check. A PID reused
      // between sysctl and registration therefore cannot make us wait on a
      // foreign process.
      proc_bsdinfo info{};
      errno = 0;
      const int info_bytes = proc_pidinfo(candidate, PROC_PIDTBSDINFO, 0,
                                          &info, sizeof(info));
      if (info_bytes == static_cast<int>(sizeof(info)) &&
          info.pbi_pid == static_cast<uint32_t>(candidate) &&
          info.pbi_pgid == static_cast<uint32_t>(group)) {
        observed += 1;
        all_exiting = all_exiting &&
                      (info.pbi_status == SZOMB ||
                       (info.pbi_flags & PROC_FLAG_INEXIT) != 0);
        continue;
      }
      if (info_bytes <= 0 && errno != 0 && errno != ESRCH) {
        *error = errno;
        close(queue);
        return false;
      }
      if (info_bytes > 0 && info_bytes != static_cast<int>(sizeof(info))) {
        *error = EIO;
        close(queue);
        return false;
      }
      struct kevent remove_change;
      EV_SET(&remove_change, static_cast<uintptr_t>(candidate), EVFILT_PROC,
             EV_DELETE, 0, 0, nullptr);
      if (kevent(queue, &remove_change, 1, nullptr, 0, nullptr) == -1 &&
          errno != ENOENT && errno != ESRCH) {
        *error = errno;
        close(queue);
        return false;
      }
    }
    if (observed == 0) {
      close(queue);
      continue;
    }

    // Close the fork-after-first-signal window only after every observed proc
    // identity is pinned. A captured parent cannot fork indefinitely after
    // this signal; its NOTE_EXIT causally advances us to the next rescan.
    if (kill(-group, SIGKILL) == -1) {
      const int code = errno;
      if (code == ESRCH) {
        close(queue);
        continue;
      }
      if (code != EPERM || !all_exiting) {
        close(queue);
        *error = code;
        return false;
      }
    }

    struct kevent event;
    int ready;
    do {
      ready = kevent(queue, nullptr, 0, &event, 1, nullptr);
    } while (ready == -1 && errno == EINTR);
    if (ready == -1) {
      *error = errno;
      close(queue);
      return false;
    }
    close(queue);
    if ((event.flags & EV_ERROR) != 0) {
      *error = event.data == 0 ? EIO : static_cast<int>(event.data);
      return false;
    }
    if (event.filter == EVFILT_READ &&
        event.ident == static_cast<uintptr_t>(wake_descriptor)) {
      *error = ECANCELED;
      return false;
    }
    if (event.filter != EVFILT_PROC || (event.fflags & NOTE_EXIT) == 0) {
      *error = EIO;
      return false;
    }
    // Re-signal and rescan. Kernel exit events, not elapsed quiet, advance
    // this fixed point and close the fork-during-kill race.
  }
}
#endif

#if defined(__linux__)
enum class LinuxProcStatResult { kPresent, kGone, kError };

LinuxProcStatResult ReadLinuxProcStat(pid_t candidate, char* state,
                                      int* process_group, int* error) {
  const std::string path = "/proc/" + std::to_string(candidate) + "/stat";
  FILE* stat = std::fopen(path.c_str(), "r");
  if (stat == nullptr) {
    if (errno == ENOENT) return LinuxProcStatResult::kGone;
    *error = errno;
    return LinuxProcStatResult::kError;
  }

  char record[4096];
  errno = 0;
  const bool read = std::fgets(record, sizeof(record), stat) != nullptr;
  const int read_error = errno;
  std::fclose(stat);
  if (!read) {
    *error = read_error == 0 ? EIO : read_error;
    return LinuxProcStatResult::kError;
  }

  // comm is parenthesized but may itself contain ')', so fields after it
  // begin at the final closing parenthesis: state, parent pid, process group.
  const char* closing = std::strrchr(record, ')');
  int parent = 0;
  if (closing == nullptr ||
      std::sscanf(closing + 2, "%c %d %d", state, &parent, process_group) != 3) {
    *error = EPROTO;
    return LinuxProcStatResult::kError;
  }
  (void)parent;
  return LinuxProcStatResult::kPresent;
}

void CloseDescriptors(std::vector<int>* descriptors) {
  for (int descriptor : *descriptors) close(descriptor);
  descriptors->clear();
}

bool CaptureLiveLinuxProcessGroup(pid_t group, std::vector<int>* pidfds, int* error) {
  DIR* processes = opendir("/proc");
  if (processes == nullptr) {
    *error = errno;
    return false;
  }

  for (;;) {
    errno = 0;
    dirent* entry = readdir(processes);
    if (entry == nullptr) {
      if (errno == 0) break;
      *error = errno;
      CloseDescriptors(pidfds);
      closedir(processes);
      return false;
    }
    char* end = nullptr;
    const long candidate = std::strtol(entry->d_name, &end, 10);
    if (candidate <= 0 || end == entry->d_name || *end != '\0') continue;

    char state = '\0';
    int process_group = 0;
    LinuxProcStatResult stat_result = ReadLinuxProcStat(
        static_cast<pid_t>(candidate), &state, &process_group, error);
    if (stat_result == LinuxProcStatResult::kGone) continue;
    if (stat_result == LinuxProcStatResult::kError) {
      CloseDescriptors(pidfds);
      closedir(processes);
      return false;
    }
    // Do not make ownership of our process tree depend on the ability to open
    // pidfds for every unrelated process in the host's /proc namespace.
    if (process_group != group) continue;

#if defined(SYS_pidfd_open)
    const int descriptor = static_cast<int>(syscall(SYS_pidfd_open, candidate, 0));
#else
    const int descriptor = -1;
    errno = ENOSYS;
#endif
    if (descriptor < 0) {
      if (errno == ESRCH) continue;
      *error = errno;
      CloseDescriptors(pidfds);
      closedir(processes);
      return false;
    }

    // pidfd_open pins the candidate identity. Re-read the numeric /proc entry
    // afterwards and retain the descriptor only if it still names a member of
    // our group; this closes the PID-reuse race between discovery and pinning.
    char confirmed_state = '\0';
    int confirmed_process_group = 0;
    stat_result = ReadLinuxProcStat(static_cast<pid_t>(candidate),
                                    &confirmed_state,
                                    &confirmed_process_group, error);
    if (stat_result == LinuxProcStatResult::kGone) {
      close(descriptor);
      continue;
    }
    if (stat_result == LinuxProcStatResult::kError) {
      close(descriptor);
      CloseDescriptors(pidfds);
      closedir(processes);
      return false;
    }
    if (confirmed_process_group != group) {
      close(descriptor);
      continue;
    }
    if (confirmed_state == 'Z' || confirmed_state == 'X' ||
        confirmed_state == 'x') {
      pollfd completion = {descriptor, static_cast<short>(POLLIN | POLLHUP), 0};
      int ready;
      do {
        ready = poll(&completion, 1, 0);
      } while (ready == -1 && errno == EINTR);
      if (ready == -1 ||
          (ready > 0 && (completion.revents & (POLLERR | POLLNVAL)) != 0)) {
        *error = ready == -1 ? errno : EIO;
        close(descriptor);
        CloseDescriptors(pidfds);
        closedir(processes);
        return false;
      }
      if (ready > 0 && (completion.revents & (POLLIN | POLLHUP)) != 0) {
        close(descriptor);
        continue;
      }
    }
    // A dead thread-group leader can coexist with live worker threads. Its
    // pidfd remains unreadable until the last thread exits, so retain it even
    // when /proc reports Z/X unless readiness proved group-wide completion.
    pidfds->push_back(descriptor);
  }
  if (closedir(processes) != 0) {
    *error = errno;
    CloseDescriptors(pidfds);
    return false;
  }
  return true;
}

bool DrainLinuxProcessGroup(pid_t group, int wake_descriptor, int* error) {
  for (;;) {
    if (kill(-group, SIGKILL) == -1 && errno != ESRCH) {
      *error = errno;
      return false;
    }
    std::vector<int> pidfds;
    if (!CaptureLiveLinuxProcessGroup(group, &pidfds, error)) return false;
    if (pidfds.empty()) return true;

    if (kill(-group, SIGKILL) == -1) {
      const int code = errno;
      for (int descriptor : pidfds) close(descriptor);
      if (code == ESRCH) continue;
      *error = code;
      return false;
    }

    std::vector<pollfd> observations;
    observations.reserve(pidfds.size() + 1);
    for (int descriptor : pidfds) observations.push_back({descriptor, POLLIN, 0});
    const size_t process_count = observations.size();
    observations.push_back({wake_descriptor, POLLIN, 0});
    size_t remaining = process_count;
    while (remaining > 0) {
      int ready;
      do {
        ready = poll(observations.data(), observations.size(), -1);
      } while (ready == -1 && errno == EINTR);
      if (ready == -1) {
        *error = errno;
        for (size_t index = 0; index < process_count; index += 1) {
          if (observations[index].fd >= 0) close(observations[index].fd);
        }
        return false;
      }
      if (observations[process_count].revents != 0) {
        *error = ECANCELED;
        for (size_t index = 0; index < process_count; index += 1) {
          if (observations[index].fd >= 0) close(observations[index].fd);
        }
        return false;
      }
      for (size_t index = 0; index < process_count; index += 1) {
        pollfd& observation = observations[index];
        if (observation.fd < 0 || observation.revents == 0) continue;
        if ((observation.revents & (POLLERR | POLLNVAL)) != 0 ||
            (observation.revents & (POLLIN | POLLHUP)) == 0) {
          *error = EIO;
          for (size_t pending = 0; pending < process_count; pending += 1) {
            if (observations[pending].fd >= 0) close(observations[pending].fd);
          }
          return false;
        }
        close(observation.fd);
        observation.fd = -1;
        remaining -= 1;
      }
    }
    // A member could have forked between the group signal and the first
    // snapshot. Keep the unreaped root as the PGID owner and rescan until no
    // executable task remains; pidfd readiness, not elapsed quiet, is proof.
  }
}
#endif

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

bool SetNonblocking(int descriptor, std::string* error) {
  const int flags = fcntl(descriptor, F_GETFL, 0);
  if (flags != -1 && fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) != -1) {
    return true;
  }
  *error = ErrnoMessage("fcntl(O_NONBLOCK)", errno);
  return false;
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

void DrainWake(int descriptor) {
  uint8_t buffer[256];
  for (;;) {
    const ssize_t count = read(descriptor, buffer, sizeof(buffer));
    if (count > 0) continue;
    if (count == -1 && errno == EINTR) continue;
    return;
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
      !CreateCloseOnExecPipe(writer_wake_, error) ||
      !CreateCloseOnExecPipe(lifecycle_wake_, error) ||
      !SetNonblocking(writer_wake_[0], error) ||
      !SetNonblocking(writer_wake_[1], error)) {
    CloseDescriptor(&exec_status[0]);
    CloseDescriptor(&exec_status[1]);
    CloseDescriptor(&reader_wake_[0]);
    CloseDescriptor(&reader_wake_[1]);
    CloseDescriptor(&writer_wake_[0]);
    CloseDescriptor(&writer_wake_[1]);
    CloseDescriptor(&lifecycle_wake_[0]);
    CloseDescriptor(&lifecycle_wake_[1]);
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
    CloseDescriptor(&lifecycle_wake_[0]);
    CloseDescriptor(&lifecycle_wake_[1]);
    *error = ErrnoMessage("forkpty", code);
    return false;
  }

  if (child == 0) {
    close(exec_status[0]);
    close(reader_wake_[0]);
    close(reader_wake_[1]);
    close(writer_wake_[0]);
    close(writer_wake_[1]);
    close(lifecycle_wake_[0]);
    close(lifecycle_wake_[1]);
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
    CloseDescriptor(&lifecycle_wake_[0]);
    CloseDescriptor(&lifecycle_wake_[1]);
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
    CloseDescriptor(&lifecycle_wake_[0]);
    CloseDescriptor(&lifecycle_wake_[1]);
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
    CloseDescriptor(&lifecycle_wake_[0]);
    CloseDescriptor(&lifecycle_wake_[1]);
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
      std::lock_guard<std::mutex> lock(write_mutex_);
      if (write_queue_.empty()) {
        if (disposed_.load()) return;
      } else {
        pending = std::move(write_queue_.front());
        write_queue_.pop_front();
      }
    }
    if (pending.empty()) {
      // The same self-pipe wakes an idle writer and interrupts a writer whose
      // PTY is backpressured. Queue state remains protected by write_mutex_;
      // the pipe is only the causal edge that makes a state change observable.
      // This also avoids depending on the versioned libstdc++ condition-
      // variable wait symbol in a portable Node-API addon.
      pollfd wake = {writer_wake_[0], POLLIN, 0};
      int ready;
      do {
        ready = poll(&wake, 1, -1);
      } while (ready == -1 && errno == EINTR);
      if (ready == -1) {
        FailWriter("poll(PTY input queue)", errno);
        return;
      }
      if ((wake.revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) != 0) {
        DrainWake(writer_wake_[0]);
      }
      if (disposed_.load()) return;
      continue;
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
        if (ready > 0 &&
            (descriptors[1].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) != 0) {
          DrainWake(writer_wake_[0]);
          if (disposed_.load()) return;
        }
        if (ready > 0 && (descriptors[0].revents & POLLOUT) != 0) continue;
        if (ready == -1) {
          FailWriter("poll(PTY input)", errno);
          return;
        }
        if ((descriptors[0].revents & (POLLHUP | POLLERR | POLLNVAL)) != 0) {
          FailWriter("write(PTY master)", EIO);
          return;
        }
        // A later queue admission can wake this poll while the current write
        // is still backpressured. It changes future work, not the health of
        // the current write, so keep waiting for the master to become writable.
        continue;
      }
      FailWriter("write(PTY master)", count == -1 ? errno : EIO);
      return;
    }

    uint64_t drained_generation = 0;
    {
      std::lock_guard<std::mutex> lock(write_mutex_);
      queued_write_bytes_ -= pending.size();
      if (queued_write_bytes_ == 0) drained_generation = write_generation_;
    }
    if (drained_generation != 0) {
      PosixSessionEvent event;
      event.kind = PosixEventKind::kDrain;
      event.write_generation = drained_generation;
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
    const int wait_error = errno;
    {
      std::lock_guard<std::mutex> lock(lifecycle_mutex_);
      tree_probe_closed_.store(true);
    }
    EmitError("waitid(WNOWAIT)", wait_error);
    return;
  }

  // The root is known to have exited but remains unreaped here, so its PID
  // and process-group id cannot be reused. Kill remaining group members at
  // this boundary, then reap the root.
  const int killed = kill(-pid_, SIGKILL);
  const int kill_error = killed == -1 ? errno : 0;
  if (killed == -1 && kill_error != ESRCH) {
#if defined(__APPLE__)
    // Darwin may report EPERM when only the unreaped zombie leader remains.
    // The causal drain below distinguishes that case from an unsignalable
    // live member with a process-group snapshot before caching tree absence.
    if (kill_error != EPERM) EmitError("kill(process group)", kill_error);
#else
    EmitError("kill(process group)", kill_error);
#endif
  }

#if defined(__linux__)
  if (killed == 0 || kill_error == ESRCH) {
    int drain_error = 0;
    if (DrainLinuxProcessGroup(pid_, lifecycle_wake_[0], &drain_error)) {
      tree_gone_.store(true);
    } else if (drain_error != ECANCELED || !disposed_.load()) {
      EmitError("drain(PTY process group)", drain_error);
    }
  }
#elif defined(__APPLE__)
  if (killed == 0 || kill_error == EPERM || kill_error == ESRCH) {
    int drain_error = 0;
    if (DrainDarwinProcessGroup(pid_, lifecycle_wake_[0], &drain_error)) {
      tree_gone_.store(true);
    } else if (drain_error != ECANCELED || !disposed_.load()) {
      EmitError("drain(PTY process group)", drain_error);
    }
  }
#endif

  int status = 0;
  pid_t waited;
  {
    // Serialize the last owned numeric-PGID operation with public signal and
    // dispose calls. Once this flag is visible, waitpid may release the PID,
    // but no caller can act on its number again.
    std::lock_guard<std::mutex> lock(lifecycle_mutex_);
    tree_probe_closed_.store(true);
    do {
      waited = waitpid(pid_, &status, 0);
    } while (waited == -1 && errno == EINTR);
  }
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
  bool wake_writer = false;
  {
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
    wake_writer = write_queue_.empty();
    write_queue_.emplace_back(data, data + length);
    queued_write_bytes_ += length;
    write_generation_ += 1;
  }
  if (wake_writer) Wake(writer_wake_[1]);
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

int PosixSession::Signal(int signal) {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  if (pid_ <= 0 || disposed_.load()) return EBADF;
  if (tree_probe_closed_.load()) return tree_gone_.load() ? 0 : EIO;
  if (kill(-pid_, signal) == 0) return 0;
  const int code = errno;
  // A process group that is already gone satisfies the lifecycle request.
  // Preserve every other errno for the supervisor: Darwin can report EPERM
  // while the root is an unreaped zombie, and only later exit/tree evidence is
  // allowed to decide whether that refusal was harmless.
  return code == ESRCH ? 0 : code;
}

int PosixSession::TreeState() const {
  std::lock_guard<std::mutex> lock(lifecycle_mutex_);
  if (pid_ <= 0) return -1;
  if (tree_gone_.load()) return 0;
  if (tree_probe_closed_.load()) return -1;
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

  // Wake a Linux pidfd or Darwin kqueue drain before waiting for its ownership
  // transition.
  Wake(lifecycle_wake_[1]);
  int hangup_error = 0;
  int terminate_error = 0;
  {
    std::lock_guard<std::mutex> lock(lifecycle_mutex_);
    if (pid_ > 0 && !tree_probe_closed_.load()) {
      if (kill(-pid_, SIGHUP) == -1 && errno != ESRCH) {
        hangup_error = errno;
      }
      if (kill(-pid_, SIGKILL) == -1 && errno != ESRCH) {
        terminate_error = errno;
      }
    }
  }
  if (hangup_error != 0) EmitError("hang up process group", hangup_error);
  if (terminate_error != 0) EmitError("terminate process group", terminate_error);
  Wake(reader_wake_[1]);
  Wake(writer_wake_[1]);
  {
    std::lock_guard<std::mutex> lock(write_mutex_);
    write_queue_.clear();
  }
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
  CloseDescriptor(&lifecycle_wake_[0]);
  CloseDescriptor(&lifecycle_wake_[1]);

  std::lock_guard<std::mutex> lock(sink_mutex_);
  sink_ = nullptr;
  sink_context_ = nullptr;
}

}  // namespace termwright
