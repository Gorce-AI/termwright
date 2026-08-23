#include "session.h"

#include <cstring>

namespace termwright {
namespace {

/// How long teardown waits for the owned tree to empty before giving up.
constexpr DWORD TREE_DRAIN_TIMEOUT_MS = 10'000;
constexpr DWORD TREE_POLL_INTERVAL_MS = 5;

/// `ReleasePseudoConsole`, when the running Windows exports it.
///
/// Feature detection rather than a version comparison: the symbol is the fact
/// that matters, and a build number is only a proxy for it that goes wrong on
/// every backport and every future edition.
using ReleasePseudoConsoleFn = HRESULT(WINAPI*)(HPCON);

ReleasePseudoConsoleFn LoadReleasePseudoConsole() {
  HMODULE kernel32 = GetModuleHandleW(L"kernel32.dll");
  if (kernel32 == nullptr) return nullptr;
  return reinterpret_cast<ReleasePseudoConsoleFn>(
      reinterpret_cast<void*>(GetProcAddress(kernel32, "ReleasePseudoConsole")));
}

std::string FormatError(const char* what, DWORD code) {
  return std::string(what) + " failed with Win32 error " + std::to_string(code);
}

}  // namespace

Session::~Session() { Dispose(); }

bool Session::Start(const SpawnOptions& options, EventSink sink, void* context, std::string* error) {
  {
    std::lock_guard<std::mutex> lock(sink_mutex_);
    sink_ = sink;
    sink_context_ = context;
  }

  // Both pipes are created here. The two ends the pseudoconsole takes are
  // closed as soon as CreatePseudoConsole has them: a host copy left open is
  // a copy of the writer, and the reader below would then never see the pipe
  // end — the exact way an authoritative EOF turns into a hang.
  Handle conpty_input_read;
  Handle conpty_output_write;
  if (!CreatePipe(conpty_input_read.receive(), host_input_write_.receive(), nullptr, 0)) {
    *error = FormatError("CreatePipe(input)", GetLastError());
    return false;
  }
  if (!CreatePipe(host_output_read_.receive(), conpty_output_write.receive(), nullptr, 0)) {
    *error = FormatError("CreatePipe(output)", GetLastError());
    return false;
  }

  COORD size{options.columns, options.rows};
  HRESULT created = CreatePseudoConsole(size, conpty_input_read.get(), conpty_output_write.get(), 0,
                                        &pseudoconsole_);
  if (FAILED(created)) {
    *error = "CreatePseudoConsole failed with HRESULT " + std::to_string(static_cast<long>(created));
    return false;
  }
  conpty_input_read.Close();
  conpty_output_write.Close();

  // The job exists before the process does, so there is no window in which a
  // root can spawn a child outside the ownership boundary.
  job_ = Handle(CreateJobObjectW(nullptr, nullptr));
  if (!job_.valid()) {
    *error = FormatError("CreateJobObject", GetLastError());
    return false;
  }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job_.get(), JobObjectExtendedLimitInformation, &limits,
                               sizeof(limits))) {
    *error = FormatError("SetInformationJobObject", GetLastError());
    return false;
  }

  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(STARTUPINFOEXW);
  SIZE_T attribute_bytes = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &attribute_bytes);
  std::vector<char> attribute_storage(attribute_bytes);
  startup.lpAttributeList =
      reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attribute_storage.data());
  if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 1, 0, &attribute_bytes)) {
    *error = FormatError("InitializeProcThreadAttributeList", GetLastError());
    return false;
  }
  if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0,
                                 PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, pseudoconsole_,
                                 sizeof(HPCON), nullptr, nullptr)) {
    DWORD code = GetLastError();
    DeleteProcThreadAttributeList(startup.lpAttributeList);
    *error = FormatError("UpdateProcThreadAttribute", code);
    return false;
  }

  std::wstring command_line = options.command_line;  // CreateProcessW may modify it
  PROCESS_INFORMATION process{};
  const wchar_t* cwd = options.cwd.empty() ? nullptr : options.cwd.c_str();
  void* environment = options.environment_block.empty()
                          ? nullptr
                          : const_cast<wchar_t*>(options.environment_block.c_str());
  // Suspended, so the root is inside the job before it can run a single
  // instruction — the alternative is a race the job could never win.
  //
  // No CREATE_NO_WINDOW. It says "this process has no console", which is the
  // opposite of what the pseudoconsole attribute asks for, and the child then
  // never attaches: it runs — the job still counts it — while producing
  // nothing into the pseudoconsole and reading nothing from it, and the
  // console, having no clients, ends the output pipe at once. That is exactly
  // what the first runs showed: a legitimate EOF code, zero bytes, and input
  // going nowhere. Microsoft's own sample passes only the extended startup
  // info for this reason.
  const DWORD flags =
      EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED;
  BOOL spawned = CreateProcessW(nullptr, command_line.data(), nullptr, nullptr, FALSE, flags,
                                environment, cwd, &startup.StartupInfo, &process);
  DWORD spawn_error = GetLastError();
  DeleteProcThreadAttributeList(startup.lpAttributeList);
  if (!spawned) {
    *error = FormatError("CreateProcessW", spawn_error);
    return false;
  }
  root_process_ = Handle(process.hProcess);
  root_thread_ = Handle(process.hThread);
  pid_ = process.dwProcessId;

  if (!AssignProcessToJobObject(job_.get(), root_process_.get())) {
    // Never resume a process we do not own: a child that escapes the job can
    // outlive the session with nothing able to prove it is gone.
    DWORD code = GetLastError();
    TerminateProcess(root_process_.get(), 1);
    *error = FormatError("AssignProcessToJobObject", code);
    return false;
  }

  state_.store(State::kRunning);
  reader_ = std::thread([this] { ReaderLoop(); });
  writer_ = std::thread([this] { WriterLoop(); });
  exit_watcher_ = std::thread([this] { WaitForRootExit(); });

  if (ResumeThread(root_thread_.get()) == static_cast<DWORD>(-1)) {
    *error = FormatError("ResumeThread", GetLastError());
    return false;
  }

  // Detected now, released later. Releasing here tears the pseudoconsole down
  // before the child has attached to it: the first run produced an immediate
  // EOF with no bytes, no input accepted and no exit, while the job still
  // showed a live process — a child running against a console that had already
  // gone. The release happens when the root exits, which is the first moment
  // the host demonstrably no longer needs to hold it, and descendants that are
  // still attached keep it alive until the last one detaches.
  static ReleasePseudoConsoleFn detected = LoadReleasePseudoConsole();
  release_supported_ = detected != nullptr;
  return true;
}

void Session::ReleasePseudoConsoleIfSupported() {
  static ReleasePseudoConsoleFn release = LoadReleasePseudoConsole();
  if (release == nullptr || pseudoconsole_ == nullptr) return;
  if (released_.exchange(true)) return;
  release(pseudoconsole_);
  state_.store(State::kReleased);
}

void Session::ReaderLoop() {
  // A dedicated blocking reader. ClosePseudoConsole can block on older
  // Windows until the client disconnects, so the thread that must keep
  // reading is never the thread that closes.
  std::vector<uint8_t> buffer(64 * 1024);
  for (;;) {
    DWORD read = 0;
    BOOL ok = ReadFile(host_output_read_.get(), buffer.data(),
                       static_cast<DWORD>(buffer.size()), &read, nullptr);
    if (!ok || read == 0) {
      DWORD code = GetLastError();
      // Any of these is the pipe ending rather than a fault: the writer is
      // gone, the handle went away with it, or the read was cancelled during
      // teardown. Everything else is worth reporting.
      const bool eof = ok || code == ERROR_BROKEN_PIPE || code == ERROR_HANDLE_EOF ||
                       code == ERROR_PIPE_NOT_CONNECTED || code == ERROR_INVALID_HANDLE ||
                       code == ERROR_OPERATION_ABORTED;
      if (!eof) {
        SessionEvent failure;
        failure.kind = EventKind::kError;
        failure.message = FormatError("ReadFile(conpty output)", code);
        failure.last_error = code;
        Emit(std::move(failure));
      }
      state_.store(State::kSourceEof);
      SessionEvent end;
      end.kind = EventKind::kEof;
      // How the pipe ended, not merely that it did. A stream that ends for the
      // wrong reason looks identical to one that ended properly, and the
      // difference is the whole claim this backend makes.
      end.last_error = ok ? 0 : code;
      Emit(std::move(end));
      return;
    }
    SessionEvent chunk;
    chunk.kind = EventKind::kData;
    chunk.data.assign(buffer.begin(), buffer.begin() + read);
    Emit(std::move(chunk));
  }
}

void Session::WriterLoop() {
  for (;;) {
    std::vector<uint8_t> pending;
    {
      std::unique_lock<std::mutex> lock(write_mutex_);
      write_signal_.wait(lock, [this] { return writer_stop_.load() || !write_queue_.empty(); });
      if (write_queue_.empty()) {
        if (writer_stop_.load()) return;
        continue;
      }
      pending = std::move(write_queue_.front());
      write_queue_.pop_front();
    }
    size_t offset = 0;
    while (offset < pending.size()) {
      DWORD written = 0;
      if (!WriteFile(host_input_write_.get(), pending.data() + offset,
                     static_cast<DWORD>(pending.size() - offset), &written, nullptr)) {
        DWORD code = GetLastError();
        if (code != ERROR_BROKEN_PIPE && code != ERROR_NO_DATA && code != ERROR_INVALID_HANDLE) {
          SessionEvent failure;
          failure.kind = EventKind::kError;
          failure.message = FormatError("WriteFile(conpty input)", code);
          failure.last_error = code;
          Emit(std::move(failure));
        }
        return;
      }
      offset += written;
    }
  }
}

void Session::WaitForRootExit() {
  WaitForSingleObject(root_process_.get(), INFINITE);
  DWORD code = 0;
  GetExitCodeProcess(root_process_.get(), &code);
  // The root exiting is its own event. Descendants can still hold the
  // pseudoconsole, so this never ends the output stream — only the reader
  // seeing the pipe end does that.
  State previous = state_.load();
  if (previous != State::kSourceEof && previous != State::kDisposed) {
    state_.store(State::kRootExited);
  }
  // Root exit is not the end of the session, only of its first process. Wait
  // for the job to say the tree is empty, because until then a descendant can
  // still be writing, and only then let the console go.
  //
  // ReleasePseudoConsole is not what ends the stream here. Three placements
  // were tried — at startup, at root exit, at the first output — and every one
  // of them tore the console down before a short-lived child's output had been
  // rendered; the stream carried ConPTY's startup and shutdown sequences and
  // nothing in between. What makes this authoritative is not a call but a
  // fact: a job reporting zero active processes cannot produce another byte.
  // Closing after that is a cleanup of something already finished, and the
  // reader still ends on the pipe rather than on a timer.
  WaitForEmptyTree();
  if (pseudoconsole_ != nullptr && !closed_pseudoconsole_.exchange(true)) {
    HPCON closing = pseudoconsole_;
    pseudoconsole_ = nullptr;
    ClosePseudoConsole(closing);
  }
  SessionEvent exited;
  exited.kind = EventKind::kExit;
  exited.exit_code = code;
  Emit(std::move(exited));
}

void Session::WaitForEmptyTree() {
  // Queried, not assumed. The job is the owner of the tree, so its accounting
  // is the only thing that can say the last process is gone; the loop exists
  // because there is no notification this thread can wait on that means the
  // same, and it is bounded so a job that never empties cannot hold teardown
  // open for ever.
  const DWORD deadline = GetTickCount() + TREE_DRAIN_TIMEOUT_MS;
  for (;;) {
    const long long active = ActiveProcesses();
    if (active <= 0) return;
    if (GetTickCount() > deadline) return;
    Sleep(TREE_POLL_INTERVAL_MS);
  }
}

void Session::Emit(SessionEvent event) {
  EventSink sink = nullptr;
  void* context = nullptr;
  {
    std::lock_guard<std::mutex> lock(sink_mutex_);
    sink = sink_;
    context = sink_context_;
  }
  if (sink != nullptr) sink(context, std::move(event));
}

void Session::Write(const uint8_t* data, size_t length) {
  if (length == 0) return;
  {
    std::lock_guard<std::mutex> lock(write_mutex_);
    write_queue_.emplace_back(data, data + length);
  }
  write_signal_.notify_one();
}

bool Session::Resize(SHORT columns, SHORT rows) {
  if (pseudoconsole_ == nullptr || closed_pseudoconsole_.load()) return false;
  COORD size{columns, rows};
  return SUCCEEDED(ResizePseudoConsole(pseudoconsole_, size));
}

void Session::TerminateTree() {
  if (job_.valid()) TerminateJobObject(job_.get(), 1);
}

long long Session::ActiveProcesses() const {
  if (!job_.valid()) return -1;
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  DWORD returned = 0;
  if (!QueryInformationJobObject(job_.get(), JobObjectBasicAccountingInformation, &accounting,
                                 sizeof(accounting), &returned)) {
    return -1;
  }
  return static_cast<long long>(accounting.ActiveProcesses);
}

void Session::Dispose() {
  if (state_.exchange(State::kDisposed) == State::kDisposed) return;

  writer_stop_.store(true);
  write_signal_.notify_all();

  // Closing the input write end tells the child its stdin is finished and
  // unblocks anything waiting on it.
  host_input_write_.Close();

  if (pseudoconsole_ != nullptr && !closed_pseudoconsole_.exchange(true)) {
    ClosePseudoConsole(pseudoconsole_);
    pseudoconsole_ = nullptr;
  }

  if (writer_.joinable()) writer_.join();
  if (reader_.joinable()) reader_.join();
  if (exit_watcher_.joinable()) exit_watcher_.join();

  host_output_read_.Close();
  root_thread_.Close();
  root_process_.Close();
  job_.Close();

  std::lock_guard<std::mutex> lock(sink_mutex_);
  sink_ = nullptr;
  sink_context_ = nullptr;
}

}  // namespace termwright
