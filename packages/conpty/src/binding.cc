// Node-API surface for the ConPTY session.
//
// One session per JS object, one ordered channel out. Data and end-of-output
// are emitted from the same thread through the same queue, so the end can
// never arrive before the bytes that preceded it — the property the JS side
// relies on to call a stream finished.

#include <napi.h>

#include <atomic>
#include <memory>
#include <string>
#include <vector>

#include "session.h"

namespace {

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
            InstanceMethod("resize", &ConPtySession::Resize),
            InstanceMethod("terminateTree", &ConPtySession::TerminateTree),
            InstanceMethod("activeProcesses", &ConPtySession::ActiveProcesses),
            InstanceMethod("dispose", &ConPtySession::Dispose),
            InstanceAccessor("pid", &ConPtySession::Pid, nullptr),
            InstanceAccessor("releaseSupported", &ConPtySession::ReleaseSupported, nullptr),
        });
    exports.Set("ConPtySession", constructor);
    return exports;
  }

  explicit ConPtySession(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<ConPtySession>(info), session_(std::make_unique<termwright::Session>()) {
    Napi::Env env = info.Env();
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

    channel_ = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(),
                                             "termwright-conpty", 0, 1);

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
    auto* carried = new termwright::SessionEvent(std::move(event));
    // BlockingCall keeps the queue ordered and applies backpressure to the
    // producing thread instead of growing without bound.
    napi_status status = channel_.BlockingCall(
        carried, [](Napi::Env env, Napi::Function callback, termwright::SessionEvent* payload) {
          std::unique_ptr<termwright::SessionEvent> owned(payload);
          Napi::Object message = Napi::Object::New(env);
          switch (owned->kind) {
            case termwright::EventKind::kData: {
              message.Set("type", Napi::String::New(env, "data"));
              message.Set("data", Napi::Buffer<uint8_t>::Copy(env, owned->data.data(),
                                                              owned->data.size()));
              break;
            }
            case termwright::EventKind::kExit: {
              message.Set("type", Napi::String::New(env, "exit"));
              message.Set("exitCode", Napi::Number::New(env, static_cast<double>(owned->exit_code)));
              break;
            }
            case termwright::EventKind::kEof: {
              message.Set("type", Napi::String::New(env, "eof"));
              message.Set("code", Napi::Number::New(env, static_cast<double>(owned->last_error)));
              break;
            }
            case termwright::EventKind::kNotice: {
              message.Set("type", Napi::String::New(env, "notice"));
              message.Set("message", Napi::String::New(env, owned->message));
              break;
            }
            case termwright::EventKind::kError: {
              message.Set("type", Napi::String::New(env, "error"));
              message.Set("message", Napi::String::New(env, owned->message));
              message.Set("code", Napi::Number::New(env, static_cast<double>(owned->last_error)));
              break;
            }
          }
          callback.Call({message});
        });
    if (status != napi_ok) delete carried;
  }

  Napi::Value Write(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
      Napi::TypeError::New(env, "write(buffer) requires a Buffer").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    session_->Write(buffer.Data(), buffer.Length());
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

  Napi::Value TerminateTree(const Napi::CallbackInfo& info) {
    session_->TerminateTree();
    return info.Env().Undefined();
  }

  Napi::Value ActiveProcesses(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), static_cast<double>(session_->ActiveProcesses()));
  }

  Napi::Value Dispose(const Napi::CallbackInfo& info) {
    Shutdown();
    return info.Env().Undefined();
  }

  Napi::Value Pid(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), static_cast<double>(session_->pid()));
  }

  Napi::Value ReleaseSupported(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), session_->release_supported());
  }

  void Shutdown() {
    if (shuttingDown_.exchange(true)) return;
    if (!started_.load()) return;
    // Dispose first, and keep delivering while it runs. It joins the producing
    // threads, so once it returns nothing can emit — but until then the reader
    // may still see the pipe genuinely end, and closing the gate first would
    // discard that EOF and leave the session reporting it never happened. The
    // queue is unbounded, so a producer mid-call cannot be waiting on us.
    session_->Dispose();
    started_.store(false);
    channel_.Release();
    channel_ = Napi::ThreadSafeFunction();
  }

  std::unique_ptr<termwright::Session> session_;
  Napi::ThreadSafeFunction channel_;
  std::atomic<bool> started_{false};
  std::atomic<bool> shuttingDown_{false};
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  return ConPtySession::Init(env, exports);
}

}  // namespace

NODE_API_MODULE(termwright_conpty, InitAll)
