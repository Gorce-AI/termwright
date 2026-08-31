#include "windows-session.h"

#include <cstring>

namespace termwright {
namespace {

constexpr size_t MAXIMUM_QUEUED_WRITE_BYTES = 8 * 1024 * 1024;

std::string FormatError(const char* what, DWORD code) {
  return std::string(what) + " failed with Win32 error " + std::to_string(code);
}

/// Creates a byte pipe whose host writer supports cancellable overlapped I/O.
/// Anonymous pipes do not: closing a handle concurrently with a synchronous
/// WriteFile is racy, and CancelSynchronousIo can miss the interval before the
/// writer actually enters the syscall.
bool CreateCancellableInputPipe(Handle* conpty_reader, Handle* host_writer,
                                std::string* error) {
  static std::atomic<unsigned long> sequence{0};
  const std::wstring name = L"\\\\.\\pipe\\termwright-pty-" +
                            std::to_wstring(GetCurrentProcessId()) + L"-" +
                            std::to_wstring(sequence.fetch_add(1));
  Handle writer(CreateNamedPipeW(
      name.c_str(), PIPE_ACCESS_OUTBOUND | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
      PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, 1, 64 * 1024, 64 * 1024, 0, nullptr));
  if (!writer.valid()) {
    *error = FormatError("CreateNamedPipe(input)", GetLastError());
    return false;
  }
  Handle reader(CreateFileW(name.c_str(), GENERIC_READ, 0, nullptr, OPEN_EXISTING,
                            FILE_ATTRIBUTE_NORMAL, nullptr));
  if (!reader.valid()) {
    *error = FormatError("CreateFile(input pipe)", GetLastError());
    return false;
  }
  *conpty_reader = std::move(reader);
  *host_writer = std::move(writer);
  return true;
}

}  // namespace

Session::~Session() { Dispose(); }

bool Session::Start(const SpawnOptions& options, EventSink sink, void* context, std::string* error) {
  {
    std::lock_guard<std::mutex> lock(sink_mutex_);
    sink_ = sink;
    sink_context_ = context;
  }

  conpty_api_ = &GetConPtyApi();
  if (!conpty_api_->available()) {
    *error = "the strict vendored ConPTY API is unavailable";
    return false;
  }

  // Both pipes are created here. The two ends the pseudoconsole takes are
  // closed as soon as CreatePseudoConsole has them: a host copy left open is
  // a copy of the writer, and the reader below would then never see the pipe
  // end — the exact way an authoritative EOF turns into a hang.
  Handle conpty_input_read;
  Handle conpty_output_write;
  if (!CreateCancellableInputPipe(&conpty_input_read, &host_input_write_, error)) return false;
  if (!CreatePipe(host_output_read_.receive(), conpty_output_write.receive(), nullptr, 0)) {
    *error = FormatError("CreatePipe(output)", GetLastError());
    return false;
  }

  COORD size{options.columns, options.rows};
  HRESULT created = conpty_api_->Create(size, conpty_input_read.get(),
                                        conpty_output_write.get(), 0,
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
  // A port to be woken on, rather than a sleep to repeat. This is a required
  // lifecycle capability: without it the session cannot wait event-first for
  // tree completion and therefore fails before launching application code.
  completion_port_ = Handle(CreateIoCompletionPort(INVALID_HANDLE_VALUE, nullptr, 0, 1));
  if (!completion_port_.valid()) {
    *error = FormatError("CreateIoCompletionPort(job)", GetLastError());
    return false;
  }
  JOBOBJECT_ASSOCIATE_COMPLETION_PORT association{};
  association.CompletionKey = job_.get();
  association.CompletionPort = completion_port_.get();
  if (!SetInformationJobObject(job_.get(), JobObjectAssociateCompletionPortInformation,
                               &association, sizeof(association))) {
    *error = FormatError("SetInformationJobObject(completion port)", GetLastError());
    return false;
  }

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job_.get(), JobObjectExtendedLimitInformation, &limits,
                               sizeof(limits))) {
    *error = FormatError("SetInformationJobObject", GetLastError());
    return false;
  }
  shutdown_event_ = Handle(CreateEventW(nullptr, TRUE, FALSE, nullptr));
  if (!shutdown_event_.valid()) {
    *error = FormatError("CreateEvent(shutdown)", GetLastError());
    return false;
  }

  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(STARTUPINFOEXW);
  // Say explicitly that the child has no inherited standard handles, so it
  // takes the ones its console gives it. WezTerm's ConPTY backend does exactly
  // this and it is the one concrete difference left between this code and two
  // implementations that work; without it a child can end up writing somewhere
  // other than the pseudoconsole, which is what the empty frames look like.
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
  startup.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
  startup.StartupInfo.hStdError = INVALID_HANDLE_VALUE;
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
    WaitForSingleObject(root_process_.get(), INFINITE);
    *error = FormatError("AssignProcessToJobObject", code);
    return false;
  }

  if (ResumeThread(root_thread_.get()) == static_cast<DWORD>(-1)) {
    const DWORD code = GetLastError();
    TerminateProcess(root_process_.get(), 1);
    WaitForSingleObject(root_process_.get(), INFINITE);
    *error = FormatError("ResumeThread", code);
    return false;
  }

  state_.store(State::kRunning);
  reader_ = std::thread([this] { ReaderLoop(); });
  writer_ = std::thread([this] { WriterLoop(); });
  exit_watcher_ = std::thread([this] { WaitForRootExit(); });

  return true;
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
      State observed = state_.load();
      while (observed != State::kDisposed && observed != State::kSourceEof &&
             !state_.compare_exchange_weak(observed, State::kSourceEof)) {
      }
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
  Handle completion_event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
  if (!completion_event.valid()) {
    FailWriter("CreateEvent(input write)", GetLastError());
    return;
  }
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
      OVERLAPPED operation{};
      operation.hEvent = completion_event.get();
      ResetEvent(completion_event.get());
      DWORD written = 0;
      bool pending_io = false;
      {
        std::lock_guard<std::mutex> issue(writer_io_mutex_);
        if (writer_stop_.load()) return;
        if (!WriteFile(host_input_write_.get(), pending.data() + offset,
                       static_cast<DWORD>(pending.size() - offset), &written, &operation)) {
          const DWORD code = GetLastError();
          if (code != ERROR_IO_PENDING) {
            FailWriter("WriteFile(conpty input)", code);
            return;
          }
          pending_io = true;
        }
      }
      if (pending_io) {
        WaitForSingleObject(completion_event.get(), INFINITE);
        if (!GetOverlappedResult(host_input_write_.get(), &operation, &written, FALSE)) {
          const DWORD code = GetLastError();
          if (writer_stop_.load() && code == ERROR_OPERATION_ABORTED) return;
          FailWriter("WriteFile(conpty input)", code);
          return;
        }
      }
      if (written == 0) {
        FailWriter("WriteFile(conpty input returned zero bytes)", ERROR_WRITE_FAULT);
        return;
      }
      offset += written;
    }
    uint64_t drained_generation = 0;
    {
      std::lock_guard<std::mutex> lock(write_mutex_);
      queued_write_bytes_ -= pending.size();
      if (queued_write_bytes_ == 0) drained_generation = write_generation_;
    }
    if (drained_generation != 0) {
      SessionEvent event;
      event.kind = EventKind::kDrain;
      event.write_generation = drained_generation;
      Emit(std::move(event));
    }
  }
}

void Session::WaitForRootExit() {
  HANDLE waits[] = {root_process_.get(), shutdown_event_.get()};
  const DWORD waited = WaitForMultipleObjects(2, waits, FALSE, INFINITE);
  if (waited == WAIT_OBJECT_0 + 1) return;
  if (waited != WAIT_OBJECT_0) {
    const DWORD failure_code = GetLastError();
    SessionEvent failure;
    failure.kind = EventKind::kError;
    failure.message = FormatError("WaitForMultipleObjects(root)", failure_code);
    failure.last_error = failure_code;
    Emit(std::move(failure));
    std::string terminate_error;
    if (!TerminateTree(&terminate_error)) {
      SessionEvent termination;
      termination.kind = EventKind::kError;
      termination.message = terminate_error;
      Emit(std::move(termination));
      std::lock_guard<std::mutex> lock(job_mutex_);
      job_.Close();
    }
    CloseOwnedPseudoConsole();
    return;
  }
  DWORD code = 0;
  if (!GetExitCodeProcess(root_process_.get(), &code) || code == STILL_ACTIVE) {
    const DWORD failure_code = code == STILL_ACTIVE ? ERROR_PROCESS_ABORTED : GetLastError();
    SessionEvent failure;
    failure.kind = EventKind::kError;
    failure.message = FormatError("GetExitCodeProcess(root)", failure_code);
    failure.last_error = failure_code;
    Emit(std::move(failure));
    std::string terminate_error;
    if (!TerminateTree(&terminate_error)) {
      SessionEvent termination;
      termination.kind = EventKind::kError;
      termination.message = terminate_error;
      Emit(std::move(termination));
      std::lock_guard<std::mutex> lock(job_mutex_);
      job_.Close();
    }
    CloseOwnedPseudoConsole();
    return;
  }
  // The root exiting is its own event. Descendants can still hold the
  // pseudoconsole, so this never ends the output stream — only the reader
  // seeing the pipe end does that.
  State running = State::kRunning;
  state_.compare_exchange_strong(running, State::kRootExited);
  // Reported the moment it is true. Holding this back until the tree drained
  // made the event a lie: `onExit` fired only after the job was already empty,
  // so a listener asking what the tree looked like at root exit was always
  // told nothing was left — including when a descendant had been holding the
  // console for the whole time in between.
  SessionEvent exited;
  exited.kind = EventKind::kExit;
  exited.exit_code = code;
  Emit(std::move(exited));

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
  Notice("root exited with " + std::to_string(code) + "; job members " +
         std::to_string(ActiveProcesses()));
  if (WaitForEmptyTree()) {
    Notice("closing the pseudoconsole; job members " + std::to_string(ActiveProcesses()));
    CloseOwnedPseudoConsole();
  } else {
    if (state_.load() == State::kDisposed) return;
    // The lifecycle claim failed closed. End the owned tree before releasing
    // the console, and put the error on the ordered event channel before EOF.
    std::string terminate_error;
    if (!TerminateTree(&terminate_error)) {
      SessionEvent failure;
      failure.kind = EventKind::kError;
      failure.message = terminate_error;
      failure.last_error = GetLastError();
      Emit(std::move(failure));
      std::lock_guard<std::mutex> lock(job_mutex_);
      job_.Close();
    }
    CloseOwnedPseudoConsole();
  }
}

void Session::Notice(std::string message) {
  SessionEvent notice;
  notice.kind = EventKind::kNotice;
  notice.message = std::move(message);
  Emit(std::move(notice));
}

bool Session::WaitForEmptyTree() {
  // Woken by the job, confirmed by the job.
  //
  // Windows posts JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO to a completion port the
  // job is associated with, so there is a real event to block on rather than a
  // sleep to repeat. The message alone is not the proof though — it can be
  // delivered for a job that goes on to gain a process again — so the wake-up
  // is followed by the accounting query, which is what actually says the tree
  // is empty. There is no elapsed-time substitute for that state transition.
  if (state_.load() == State::kDisposed) return false;
  const long long initial_members = ActiveProcesses();
  if (initial_members == 0) {
    Notice("tree already empty when the drain began");
    return true;
  }
  if (initial_members < 0) {
    SessionEvent failure;
    failure.kind = EventKind::kError;
    failure.message = "QueryInformationJobObject failed before tree drain";
    failure.last_error = GetLastError();
    Emit(std::move(failure));
    return false;
  }
  for (;;) {
    DWORD completion = 0;
    ULONG_PTR key = 0;
    LPOVERLAPPED overlapped = nullptr;
    if (!GetQueuedCompletionStatus(completion_port_.get(), &completion, &key, &overlapped,
                                   INFINITE)) {
      const DWORD code = GetLastError();
      SessionEvent failure;
      failure.kind = EventKind::kError;
      failure.message = FormatError("GetQueuedCompletionStatus(job)", code);
      failure.last_error = code;
      Emit(std::move(failure));
      return false;
    }
    if (state_.load() == State::kDisposed) return false;
    const long long members = ActiveProcesses();
    if (members == 0) {
      Notice("job reported the tree empty");
      return true;
    }
    if (members < 0) {
      SessionEvent failure;
      failure.kind = EventKind::kError;
      failure.message = "QueryInformationJobObject failed during tree drain";
      failure.last_error = GetLastError();
      Emit(std::move(failure));
      return false;
    }
  }
}

void Session::CloseOwnedPseudoConsole() {
  std::lock_guard<std::mutex> lock(pseudoconsole_mutex_);
  if (pseudoconsole_ == nullptr) return;
  HPCON closing = pseudoconsole_;
  pseudoconsole_ = nullptr;
  conpty_api_->Close(closing);
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

void Session::FailWriter(const char* operation, DWORD code) {
  const std::string message = FormatError(operation, code);
  {
    std::lock_guard<std::mutex> lock(write_mutex_);
    if (writer_failed_) return;
    writer_failed_ = true;
    writer_error_ = message;
    write_queue_.clear();
    queued_write_bytes_ = 0;
  }
  SessionEvent failure;
  failure.kind = EventKind::kError;
  failure.message = message;
  failure.last_error = code;
  Emit(std::move(failure));
}

bool Session::Write(const uint8_t* data, size_t length, std::string* error) {
  if (length == 0) return true;
  std::lock_guard<std::mutex> lock(write_mutex_);
  const State state = state_.load();
  if (writer_stop_.load() || state == State::kSourceEof || state == State::kDisposed) {
    *error = "ConPTY input is closed";
    return false;
  }
  if (writer_failed_) {
    *error = writer_error_;
    return false;
  }
  if (length > MAXIMUM_QUEUED_WRITE_BYTES - queued_write_bytes_) {
    *error = "ConPTY input queue capacity exceeded (8 MiB)";
    return false;
  }
  write_queue_.emplace_back(data, data + length);
  queued_write_bytes_ += length;
  write_generation_ += 1;
  write_signal_.notify_one();
  return true;
}

void Session::CloseInput() {
  std::lock_guard<std::mutex> close_lock(input_close_mutex_);

  writer_stop_.store(true);
  {
    std::lock_guard<std::mutex> lock(write_mutex_);
    write_queue_.clear();
  }
  write_signal_.notify_all();

  // The writer issues each operation while holding writer_io_mutex_. Since the
  // stop flag was set first, this either cancels the already-issued operation
  // or prevents another operation from being issued after cancellation.
  {
    std::lock_guard<std::mutex> issue(writer_io_mutex_);
    if (host_input_write_.valid()) CancelIoEx(host_input_write_.get(), nullptr);
  }
  if (writer_.joinable()) writer_.join();
  {
    // The joined writer can no longer subtract its in-flight batch. Resetting
    // before the join would let that final accounting underflow this size_t.
    std::lock_guard<std::mutex> lock(write_mutex_);
    queued_write_bytes_ = 0;
  }
  // No operation can now be using the handle. Closing only this pipe end is a
  // real terminal-input EOF; it deliberately leaves HPCON and output intact.
  host_input_write_.Close();
}

bool Session::Resize(SHORT columns, SHORT rows) {
  std::lock_guard<std::mutex> lock(pseudoconsole_mutex_);
  if (pseudoconsole_ == nullptr) return false;
  COORD size{columns, rows};
  return conpty_api_ != nullptr && SUCCEEDED(conpty_api_->Resize(pseudoconsole_, size));
}

bool Session::TerminateTree(std::string* error) {
  std::lock_guard<std::mutex> lock(job_mutex_);
  if (!job_.valid()) {
    if (error != nullptr) *error = "ConPTY job is closed";
    return false;
  }
  if (TerminateJobObject(job_.get(), 1)) return true;
  if (error != nullptr) *error = FormatError("TerminateJobObject", GetLastError());
  return false;
}

long long Session::ActiveProcesses() const {
  std::lock_guard<std::mutex> lock(job_mutex_);
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
  if (disposing_.exchange(true)) return;

  CloseInput();

  // Disposal owns the entire process tree. A successful TerminateJobObject is
  // followed by the existing lifecycle thread's causal barriers: the root
  // process handle becomes signalled, then JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO
  // is confirmed by QueryInformationJobObject. Joining that thread makes a
  // successful dispose mean the complete job is gone, not merely that Windows
  // accepted a termination request.
  //
  // Only a failed termination request takes the emergency wake path. Closing
  // the job is then the independent KILL_ON_JOB_CLOSE fallback, and the
  // shutdown events ensure an OS-level failure cannot strand teardown.
  std::string terminate_error;
  const bool terminated = TerminateTree(&terminate_error);
  if (!terminated) {
    state_.store(State::kDisposed);
    if (shutdown_event_.valid()) SetEvent(shutdown_event_.get());
    if (completion_port_.valid()) {
      PostQueuedCompletionStatus(completion_port_.get(), 0, 0, nullptr);
    }
    std::lock_guard<std::mutex> lock(job_mutex_);
    job_.Close();
  }

  if (exit_watcher_.joinable()) exit_watcher_.join();
  state_.store(State::kDisposed);
  CloseOwnedPseudoConsole();
  if (reader_.joinable()) reader_.join();

  host_output_read_.Close();
  root_thread_.Close();
  root_process_.Close();
  completion_port_.Close();
  {
    std::lock_guard<std::mutex> lock(job_mutex_);
    job_.Close();
  }
  shutdown_event_.Close();

  std::lock_guard<std::mutex> lock(sink_mutex_);
  sink_ = nullptr;
  sink_context_ = nullptr;
}

}  // namespace termwright
