#include <napi.h>

#include <atomic>
#include <memory>
#include <string>
#include <vector>

#include "posix-session.h"

namespace {

constexpr size_t kMaximumPendingEvents = 64;

std::vector<std::string> StringArray(const Napi::Array& input) {
  std::vector<std::string> output;
  output.reserve(input.Length());
  for (uint32_t index = 0; index < input.Length(); ++index) {
    Napi::Value value = input.Get(index);
    if (!value.IsString()) continue;
    output.push_back(value.As<Napi::String>().Utf8Value());
  }
  return output;
}

class PosixPtySession : public Napi::ObjectWrap<PosixPtySession> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function constructor = DefineClass(
        env, "PosixPtySession",
        {
            InstanceMethod("write", &PosixPtySession::Write),
            InstanceMethod("resize", &PosixPtySession::Resize),
            InstanceMethod("signal", &PosixPtySession::Signal),
            InstanceMethod("treeState", &PosixPtySession::TreeState),
            InstanceMethod("dispose", &PosixPtySession::Dispose),
            InstanceAccessor("pid", &PosixPtySession::Pid, nullptr),
        });
    exports.Set("PosixPtySession", constructor);
    return exports;
  }

  explicit PosixPtySession(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<PosixPtySession>(info),
        session_(std::make_unique<termwright::PosixSession>()) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
      Napi::TypeError::New(env, "PosixPtySession(options, onEvent) requires an object and a function")
          .ThrowAsJavaScriptException();
      return;
    }
    Napi::Object options = info[0].As<Napi::Object>();
    if (!options.Get("command").IsArray() || !options.Get("env").IsArray()) {
      Napi::TypeError::New(env, "command and env must be arrays of strings")
          .ThrowAsJavaScriptException();
      return;
    }

    termwright::PosixSpawnOptions spawn;
    spawn.command = StringArray(options.Get("command").As<Napi::Array>());
    spawn.environment = StringArray(options.Get("env").As<Napi::Array>());
    if (options.Has("cwd") && options.Get("cwd").IsString()) {
      spawn.cwd = options.Get("cwd").As<Napi::String>().Utf8Value();
    }
    spawn.columns = static_cast<unsigned short>(options.Get("columns").As<Napi::Number>().Uint32Value());
    spawn.rows = static_cast<unsigned short>(options.Get("rows").As<Napi::Number>().Uint32Value());

    channel_ = Napi::ThreadSafeFunction::New(
        env, info[1].As<Napi::Function>(), "termwright-posix-pty",
        kMaximumPendingEvents, 1);
    started_.store(true);
    std::string error;
    if (!session_->Start(spawn, &PosixPtySession::OnSessionEvent, this, &error)) {
      session_->Dispose();
      started_.store(false);
      channel_.Release();
      channel_ = Napi::ThreadSafeFunction();
      Napi::Error::New(env, error).ThrowAsJavaScriptException();
    }
  }

  ~PosixPtySession() override { Shutdown(); }

 private:
  static void OnSessionEvent(void* context, termwright::PosixSessionEvent event) {
    static_cast<PosixPtySession*>(context)->Deliver(std::move(event));
  }

  void Deliver(termwright::PosixSessionEvent event) {
    if (!started_.load()) return;
    auto* carried = new termwright::PosixSessionEvent(std::move(event));
    napi_status status = channel_.BlockingCall(
        carried,
        [](Napi::Env env, Napi::Function callback, termwright::PosixSessionEvent* payload) {
          std::unique_ptr<termwright::PosixSessionEvent> owned(payload);
          if (env == nullptr) return;
          Napi::Object message = Napi::Object::New(env);
          switch (owned->kind) {
            case termwright::PosixEventKind::kData:
              message.Set("type", "data");
              message.Set("data", Napi::Buffer<uint8_t>::Copy(
                                      env, owned->data.data(), owned->data.size()));
              break;
            case termwright::PosixEventKind::kExit:
              message.Set("type", "exit");
              message.Set("exitCode", owned->exit_code);
              message.Set("signal", owned->signal);
              break;
            case termwright::PosixEventKind::kEof:
              message.Set("type", "eof");
              message.Set("code", owned->error_code);
              break;
            case termwright::PosixEventKind::kDrain:
              message.Set("type", "drain");
              message.Set("generation", Napi::BigInt::New(env, owned->write_generation));
              break;
            case termwright::PosixEventKind::kError:
              message.Set("type", "error");
              message.Set("message", owned->message);
              message.Set("code", owned->error_code);
              break;
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
    std::string error;
    if (!session_->Write(buffer.Data(), buffer.Length(), &error)) {
      Napi::Error::New(env, error).ThrowAsJavaScriptException();
    }
    return env.Undefined();
  }

  Napi::Value Resize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
      Napi::TypeError::New(env, "resize(columns, rows) requires two numbers")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Boolean::New(
        env, session_->Resize(static_cast<unsigned short>(info[0].As<Napi::Number>().Uint32Value()),
                              static_cast<unsigned short>(info[1].As<Napi::Number>().Uint32Value())));
  }

  Napi::Value Signal(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
      Napi::TypeError::New(env, "signal(number) requires a signal number")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    return Napi::Number::New(env, session_->Signal(info[0].As<Napi::Number>().Int32Value()));
  }

  Napi::Value TreeState(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), session_->TreeState());
  }

  Napi::Value Dispose(const Napi::CallbackInfo& info) {
    Shutdown();
    return info.Env().Undefined();
  }

  Napi::Value Pid(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), static_cast<double>(session_->pid()));
  }

  void Shutdown() {
    if (shutting_down_.exchange(true) || !started_.load()) return;
    // A bounded TSFN can have a producer blocked behind a busy JS thread.
    // Abort it before joining native threads so synchronous dispose cannot
    // deadlock; normal EOF is delivered before callers dispose a clean exit.
    started_.store(false);
    channel_.Abort();
    session_->Dispose();
    channel_ = Napi::ThreadSafeFunction();
  }

  std::unique_ptr<termwright::PosixSession> session_;
  Napi::ThreadSafeFunction channel_;
  std::atomic<bool> started_{false};
  std::atomic<bool> shutting_down_{false};
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  return PosixPtySession::Init(env, exports);
}

}  // namespace

NODE_API_MODULE(termwright_pty, InitAll)
