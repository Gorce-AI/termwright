// Node-API surface for the ConPTY session.
//
// One session per JS object, one ordered channel out. Data and end-of-output
// are emitted from the same thread through the same queue, so the end can
// never arrive before the bytes that preceded it — the property the JS side
// relies on to call a stream finished.

#include <napi.h>

#include <atomic>
#include <climits>
#include <cmath>
#include <condition_variable>
#include <deque>
#include <io.h>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "windows-conpty-api.h"
#include "windows-session.h"

namespace {

constexpr size_t kMaximumPendingOutputBytes = 8 * 1024 * 1024;
constexpr size_t kMaximumDataBatchBytes = 256 * 1024;

struct DeliveryState {
  std::mutex mutex;
  std::condition_variable space_available;
  std::deque<termwright::SessionEvent> events;
  // Bounds bytes waiting in the native queue. A batch already swapped into
  // the JS callback can coexist with one new queue budget, so peak live data
  // is at most two budgets rather than being unbounded.
  size_t pending_output_bytes = 0;
  bool callback_scheduled = false;
  std::atomic<bool> closed{false};
};

std::mutex console_marker_mutex;

std::string ConsoleMarkerError(const char* operation, DWORD code) {
  return std::string(operation) + " failed with Win32 error " + std::to_string(code);
}

Napi::Value WriteWindowsConsoleMarker(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
    Napi::TypeError::New(env, "writeWindowsConsoleMarker(fd, marker) requires an integer fd and a string")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const double numeric_fd = info[0].As<Napi::Number>().DoubleValue();
  if (!std::isfinite(numeric_fd) || numeric_fd < 0 ||
      numeric_fd > static_cast<double>(INT_MAX) ||
      numeric_fd != static_cast<double>(static_cast<int>(numeric_fd))) {
    Napi::RangeError::New(env, "writeWindowsConsoleMarker fd must be a non-negative integer")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const std::u16string marker = info[1].As<Napi::String>().Utf16Value();
  if (marker.empty()) {
    Napi::RangeError::New(env, "writeWindowsConsoleMarker marker must not be empty")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (marker.size() > MAXDWORD) {
    Napi::RangeError::New(env, "writeWindowsConsoleMarker marker is too large for WriteConsoleW")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  std::lock_guard<std::mutex> lock(console_marker_mutex);
  const intptr_t descriptor_handle = _get_osfhandle(static_cast<int>(numeric_fd));
  if (descriptor_handle == -1) {
    Napi::Error::New(env, "_get_osfhandle failed for the console marker fd")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const HANDLE handle = reinterpret_cast<HANDLE>(descriptor_handle);
  DWORD original_mode = 0;
  if (!GetConsoleMode(handle, &original_mode)) {
    Napi::Error::New(env, ConsoleMarkerError("GetConsoleMode(console marker)", GetLastError()))
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const DWORD required_mode = original_mode | ENABLE_PROCESSED_OUTPUT |
                              ENABLE_VIRTUAL_TERMINAL_PROCESSING;
  const bool changed_mode = required_mode != original_mode;
  if (changed_mode && !SetConsoleMode(handle, required_mode)) {
    Napi::Error::New(env, ConsoleMarkerError("SetConsoleMode(console marker)", GetLastError()))
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  DWORD written = 0;
  const BOOL wrote = WriteConsoleW(handle, marker.data(), static_cast<DWORD>(marker.size()),
                                   &written, nullptr);
  const DWORD write_error = wrote ? ERROR_SUCCESS : GetLastError();
  const bool restored = !changed_mode || SetConsoleMode(handle, original_mode) != FALSE;
  const DWORD restore_error = restored ? ERROR_SUCCESS : GetLastError();

  if (!restored) {
    std::string message = ConsoleMarkerError("SetConsoleMode(console marker restore)", restore_error);
    if (!wrote) message += "; preceding " + ConsoleMarkerError("WriteConsoleW(console marker)", write_error);
    else if (written != marker.size()) {
      message += "; preceding WriteConsoleW(console marker) short write " +
                 std::to_string(written) + "/" + std::to_string(marker.size());
    }
    Napi::Error::New(env, message).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (!wrote) {
    Napi::Error::New(env, ConsoleMarkerError("WriteConsoleW(console marker)", write_error))
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (written != marker.size()) {
    Napi::Error::New(env, "WriteConsoleW(console marker) short write " +
                              std::to_string(written) + "/" +
                              std::to_string(marker.size()))
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return env.Undefined();
}

Napi::Object RuntimeInfo(Napi::Env env) {
  const termwright::ConPtyRuntimeInfo& info = termwright::GetConPtyApi().runtime_info();
  Napi::Object value = Napi::Object::New(env);
  value.Set("provider", Napi::String::New(env, info.provider));
  value.Set("upstreamCommit", Napi::String::New(env, info.upstream_commit));
  value.Set("patchSha256", Napi::String::New(env, info.patch_sha256));
  value.Set("hostCursorRpc", Napi::String::New(env, info.host_cursor_rpc));
  value.Set("applicationReplyRpc", Napi::String::New(env, info.application_reply_rpc));
  value.Set("mode", Napi::String::New(env, info.mode));
  value.Set("policy", Napi::String::New(env, info.policy));
  value.Set("selectedHostArchitecture",
            Napi::String::New(env, info.selected_host_architecture));
  value.Set("failureCode", Napi::String::New(env, info.failure_code));
  value.Set("failureWin32", Napi::Number::New(env, info.failure_win32));
  value.Set("assetsValidated", Napi::Boolean::New(env, info.assets_validated));
  value.Set("coreExports", Napi::Boolean::New(env, info.core_exports));
  value.Set("orderedMarkerSemantics",
            Napi::String::New(env, info.ordered_marker_semantics));
  return value;
}

Napi::Value ConPtyRuntimeInfo(const Napi::CallbackInfo& info) {
  return RuntimeInfo(info.Env());
}

std::wstring ToWide(const std::string& utf8) {
  if (utf8.empty()) return std::wstring();
  int length = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
  std::wstring wide(static_cast<size_t>(length), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), wide.data(), length);
  return wide;
}

/// Builds the double-NUL terminated block CreateProcessW expects.
std::wstring ToEnvironmentBlock(const Napi::Array& pairs) {
  std::wstring block;
  for (uint32_t index = 0; index < pairs.Length(); index += 1) {
    Napi::Value entry = pairs.Get(index);
    if (!entry.IsString()) continue;
    block.append(ToWide(entry.As<Napi::String>().Utf8Value()));
    block.push_back(L'\0');
  }
  if (block.empty()) return block;
  block.push_back(L'\0');
  return block;
}

class ConPtySession : public Napi::ObjectWrap<ConPtySession> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function constructor = DefineClass(
        env, "ConPtySession",
        {
            InstanceMethod("write", &ConPtySession::Write),
            InstanceMethod("closeInput", &ConPtySession::CloseInput),
            InstanceMethod("resize", &ConPtySession::Resize),
            InstanceMethod("terminateTree", &ConPtySession::TerminateTree),
            InstanceMethod("activeProcesses", &ConPtySession::ActiveProcesses),
            InstanceMethod("resourceUsage", &ConPtySession::ResourceUsage),
            InstanceMethod("dispose", &ConPtySession::Dispose),
            InstanceAccessor("pid", &ConPtySession::Pid, nullptr),
        });
    exports.Set("ConPtySession", constructor);
    return exports;
  }

  explicit ConPtySession(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<ConPtySession>(info),
        session_(std::make_unique<termwright::Session>()),
        delivery_(std::make_shared<DeliveryState>()) {
    Napi::Env env = info.Env();
    const termwright::ConPtyApi& api = termwright::GetConPtyApi();
    if (!api.available()) {
      const termwright::ConPtyRuntimeInfo& runtime = api.runtime_info();
      Napi::Error::New(
          env, "strict vendored ConPTY initialization failed: " +
                   runtime.failure_code + " (Win32 " +
                   std::to_string(runtime.failure_win32) + ")")
          .ThrowAsJavaScriptException();
      return;
    }
    if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
      Napi::TypeError::New(env, "ConPtySession(options, onEvent) requires an object and a function")
          .ThrowAsJavaScriptException();
      return;
    }
    Napi::Object options = info[0].As<Napi::Object>();

    termwright::SpawnOptions spawn;
    spawn.command_line = ToWide(options.Get("commandLine").As<Napi::String>().Utf8Value());
    if (options.Has("cwd") && options.Get("cwd").IsString()) {
      spawn.cwd = ToWide(options.Get("cwd").As<Napi::String>().Utf8Value());
    }
    if (options.Has("env") && options.Get("env").IsArray()) {
      spawn.environment_block = ToEnvironmentBlock(options.Get("env").As<Napi::Array>());
    }
    if (options.Has("columns")) {
      spawn.columns = static_cast<SHORT>(options.Get("columns").As<Napi::Number>().Int32Value());
    }
    if (options.Has("rows")) {
      spawn.rows = static_cast<SHORT>(options.Get("rows").As<Napi::Number>().Int32Value());
    }

    // DeliveryState::callback_scheduled is the queue bound: one edge may be
    // executing in JS and at most one later edge can be admitted. Node-API's
    // maxQueueSize=1 counts the executing callback on some runtimes, so a
    // terminal response written reentrantly from a data listener can make the
    // native writer's drain edge report napi_queue_full. Treating that as a
    // closed channel silently discards the later exit and authoritative EOF.
    // An unbounded TSFN queue is safe here because the logical edge remains
    // bounded by callback_scheduled and payload bytes remain bounded below.
    channel_ = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(),
                                             "termwright-windows-pty",
                                             0, 1);

    // Armed before Start, never after. Start launches the reader, the writer
    // and the exit watcher and only then returns, so a gate flipped afterwards
    // discards everything produced in between — which for a child that prints
    // and exits immediately is the entire session. That is not a race that
    // shows up occasionally; it is every fast child, every time.
    started_.store(true);
    std::string error;
    if (!session_->Start(spawn, &ConPtySession::OnSessionEvent, this, &error)) {
      // Start can fail after its threads exist, so join them before letting
      // the channel go.
      session_->Dispose();
      started_.store(false);
      channel_.Release();
      channel_ = Napi::ThreadSafeFunction();
      Napi::Error::New(env, error).ThrowAsJavaScriptException();
      return;
    }
  }

  ~ConPtySession() override { Shutdown(); }

 private:
  static void OnSessionEvent(void* context, termwright::SessionEvent event) {
    auto* self = static_cast<ConPtySession*>(context);
    self->Deliver(std::move(event));
  }

  void Deliver(termwright::SessionEvent event) {
    if (!started_.load()) return;
    const auto delivery = delivery_;
    bool schedule = false;
    {
      std::unique_lock<std::mutex> lock(delivery->mutex);
      if (event.kind == termwright::EventKind::kData) {
        const size_t incoming = event.data.size();
        delivery->space_available.wait(lock, [&] {
          return delivery->closed.load() ||
                 incoming <= kMaximumPendingOutputBytes - delivery->pending_output_bytes;
        });
        if (delivery->closed.load()) return;
        delivery->pending_output_bytes += incoming;
        if (!delivery->events.empty() &&
            delivery->events.back().kind == termwright::EventKind::kData &&
            delivery->events.back().data.size() + incoming <= kMaximumDataBatchBytes) {
          auto& tail = delivery->events.back().data;
          tail.insert(tail.end(), event.data.begin(), event.data.end());
        } else {
          delivery->events.push_back(std::move(event));
        }
      } else {
        if (delivery->closed.load()) return;
        delivery->events.push_back(std::move(event));
      }
      if (!delivery->callback_scheduled) {
        delivery->callback_scheduled = true;
        schedule = true;
      }
    }
    if (!schedule) return;

    auto* carried = new std::shared_ptr<DeliveryState>(delivery);
    // One JS edge drains a byte-bounded native batch. Passthrough ConPTY emits
    // one pipe write for every WriteConsole call; forwarding those calls as
    // one TSFN item each lets event-count backpressure stall a renderer even
    // when only a few kilobytes are pending. Adjacent data is therefore
    // coalesced before crossing into JS, while non-data events retain their
    // exact position in the ordered queue.
    napi_status status;
    {
      // Shutdown aborts and resets the TSFN under this same lock. A producer
      // that passed the started_ check therefore either schedules before the
      // abort or observes a closing channel; it never calls a reset handle.
      std::lock_guard<std::mutex> lock(channel_mutex_);
      status = channel_.NonBlockingCall(
          carried, [](Napi::Env env, Napi::Function callback,
                    std::shared_ptr<DeliveryState>* payload) {
            const std::shared_ptr<DeliveryState> delivery = std::move(*payload);
            delete payload;
            std::deque<termwright::SessionEvent> events;
            {
              std::lock_guard<std::mutex> lock(delivery->mutex);
              if (env != nullptr && !delivery->closed.load()) {
                events.swap(delivery->events);
              } else {
                delivery->events.clear();
              }
              delivery->pending_output_bytes = 0;
              delivery->callback_scheduled = false;
            }
            delivery->space_available.notify_all();
            if (env == nullptr) return;
            for (auto& event : events) {
              if (delivery->closed.load()) return;
              Napi::Object message = Napi::Object::New(env);
              switch (event.kind) {
                case termwright::EventKind::kData: {
                  message.Set("type", Napi::String::New(env, "data"));
                  message.Set("data", Napi::Buffer<uint8_t>::Copy(
                                          env, event.data.data(), event.data.size()));
                  break;
                }
                case termwright::EventKind::kExit: {
                  message.Set("type", Napi::String::New(env, "exit"));
                  message.Set("exitCode",
                              Napi::Number::New(env, static_cast<double>(event.exit_code)));
                  break;
                }
                case termwright::EventKind::kEof: {
                  message.Set("type", Napi::String::New(env, "eof"));
                  message.Set("code",
                              Napi::Number::New(env, static_cast<double>(event.last_error)));
                  break;
                }
                case termwright::EventKind::kDrain: {
                  message.Set("type", Napi::String::New(env, "drain"));
                  message.Set("generation", Napi::BigInt::New(env, event.write_generation));
                  break;
                }
                case termwright::EventKind::kNotice: {
                  message.Set("type", Napi::String::New(env, "notice"));
                  message.Set("message", Napi::String::New(env, event.message));
                  break;
                }
                case termwright::EventKind::kError: {
                  message.Set("type", Napi::String::New(env, "error"));
                  message.Set("message", Napi::String::New(env, event.message));
                  message.Set("code",
                              Napi::Number::New(env, static_cast<double>(event.last_error)));
                  break;
                }
              }
              callback.Call({message});
            }
          });
    }
    if (status != napi_ok) {
      delete carried;
      {
        std::lock_guard<std::mutex> lock(delivery->mutex);
        delivery->events.clear();
        delivery->pending_output_bytes = 0;
        delivery->callback_scheduled = false;
        delivery->closed.store(true);
      }
      delivery->space_available.notify_all();
    }
  }

  Napi::Value Write(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
      Napi::TypeError::New(env, "write(buffer) requires a Buffer").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    std::string error;
    if (!session_->Write(buffer.Data(), buffer.Length(), &error)) {
      Napi::Error::New(env, error).ThrowAsJavaScriptException();
    }
    return env.Undefined();
  }

  Napi::Value Resize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2) {
      Napi::TypeError::New(env, "resize(columns, rows) requires two numbers")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    const SHORT columns = static_cast<SHORT>(info[0].As<Napi::Number>().Int32Value());
    const SHORT rows = static_cast<SHORT>(info[1].As<Napi::Number>().Int32Value());
    return Napi::Boolean::New(env, session_->Resize(columns, rows));
  }

  Napi::Value CloseInput(const Napi::CallbackInfo& info) {
    session_->CloseInput();
    return info.Env().Undefined();
  }

  Napi::Value TerminateTree(const Napi::CallbackInfo& info) {
    std::string error;
    if (!session_->TerminateTree(&error)) {
      Napi::Error::New(info.Env(), error).ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
  }

  Napi::Value ActiveProcesses(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), static_cast<double>(session_->ActiveProcesses()));
  }

  Napi::Value ResourceUsage(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    termwright::JobResourceUsage usage{};
    if (!session_->ResourceUsage(&usage)) return env.Null();
    Napi::Object value = Napi::Object::New(env);
    value.Set("source", Napi::String::New(env, "windows-job-object"));
    value.Set("userTime100ns", Napi::Number::New(env, static_cast<double>(usage.user_time_100ns)));
    value.Set("kernelTime100ns",
              Napi::Number::New(env, static_cast<double>(usage.kernel_time_100ns)));
    value.Set("peakJobMemoryBytes",
              Napi::Number::New(env, static_cast<double>(usage.peak_job_memory_bytes)));
    value.Set("readOperationCount",
              Napi::Number::New(env, static_cast<double>(usage.read_operation_count)));
    value.Set("writeOperationCount",
              Napi::Number::New(env, static_cast<double>(usage.write_operation_count)));
    value.Set("otherOperationCount",
              Napi::Number::New(env, static_cast<double>(usage.other_operation_count)));
    value.Set("readTransferBytes",
              Napi::Number::New(env, static_cast<double>(usage.read_transfer_bytes)));
    value.Set("writeTransferBytes",
              Napi::Number::New(env, static_cast<double>(usage.write_transfer_bytes)));
    value.Set("otherTransferBytes",
              Napi::Number::New(env, static_cast<double>(usage.other_transfer_bytes)));
    value.Set("totalProcesses", Napi::Number::New(env, usage.total_processes));
    value.Set("activeProcesses", Napi::Number::New(env, usage.active_processes));
    value.Set("totalTerminatedProcesses",
              Napi::Number::New(env, usage.total_terminated_processes));
    return value;
  }

  Napi::Value Dispose(const Napi::CallbackInfo& info) {
    Shutdown();
    return info.Env().Undefined();
  }

  Napi::Value Pid(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), static_cast<double>(session_->pid()));
  }

  void Shutdown() {
    if (shuttingDown_.exchange(true)) return;
    if (!started_.load()) return;
    // Abort the bounded JS queue before joining native producers. A reader can
    // be blocked by a busy JS thread; joining it first would deadlock a
    // synchronous dispose. Clean exits deliver EOF before callers dispose.
    started_.store(false);
    {
      std::lock_guard<std::mutex> lock(delivery_->mutex);
      delivery_->closed.store(true);
      delivery_->events.clear();
      delivery_->pending_output_bytes = 0;
    }
    delivery_->space_available.notify_all();
    {
      std::lock_guard<std::mutex> lock(channel_mutex_);
      channel_.Abort();
    }
    session_->Dispose();
    {
      // All native producers have joined, so no later Deliver can race the
      // final handle release after this point.
      std::lock_guard<std::mutex> lock(channel_mutex_);
      channel_ = Napi::ThreadSafeFunction();
    }
  }

  std::unique_ptr<termwright::Session> session_;
  std::shared_ptr<DeliveryState> delivery_;
  std::mutex channel_mutex_;
  Napi::ThreadSafeFunction channel_;
  std::atomic<bool> started_{false};
  std::atomic<bool> shuttingDown_{false};
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  // Runtime discovery is diagnostic and must survive a missing or corrupt
  // side-by-side bundle. Session construction below remains fail-closed.
  ConPtySession::Init(env, exports);
  exports.Set("conPtyRuntimeInfo", Napi::Function::New(env, ConPtyRuntimeInfo));
  exports.Set("writeWindowsConsoleMarker",
              Napi::Function::New(env, WriteWindowsConsoleMarker));
  return exports;
}

}  // namespace

NODE_API_MODULE(termwright_pty, InitAll)
