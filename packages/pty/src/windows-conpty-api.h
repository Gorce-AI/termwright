// One immutable ConPTY API table for one process.
//
// A standalone ConPTY handle is private to the DLL that created it. Mixing
// Create/Resize/Close from different modules is invalid, so sessions
// retain this table and route every HPCON operation through it.

#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>

#include <string>
#include <vector>

namespace termwright {

using CreatePseudoConsoleFn = HRESULT(WINAPI*)(COORD, HANDLE, HANDLE, DWORD, HPCON*);
using ResizePseudoConsoleFn = HRESULT(WINAPI*)(HPCON, COORD);
using ClosePseudoConsoleFn = void(WINAPI*)(HPCON);

struct ConPtyRuntimeInfo {
  std::string provider = "termwright-patched-openconsole";
  std::string upstream_commit =
      "dd494ac79a82a04e1e7252a91c8939a3c3039908";
  std::string patch_sha256 =
      "a09171f65d36283338c589b1a3ab4a95816cbe63bd81b2657eaf7551d1013527";
  std::string host_cursor_rpc = "twh-cpr-v1";
  std::string mode = "ordered-vt-passthrough";
  std::string policy = "strict";
  std::string selected_host_architecture;
  std::string failure_code;
  DWORD failure_win32 = 0;
  bool assets_validated = false;
  bool core_exports = false;
  std::string ordered_marker_semantics =
      "marker-authoritative-after-behavioral-certification";
};

class ConPtyApi {
 public:
  ConPtyApi() = default;
  ~ConPtyApi();
  ConPtyApi(const ConPtyApi&) = delete;
  ConPtyApi& operator=(const ConPtyApi&) = delete;

  bool available() const {
    return create_ != nullptr && resize_ != nullptr && close_ != nullptr;
  }
  HRESULT Create(COORD size, HANDLE input, HANDLE output, DWORD flags,
                 HPCON* pseudoconsole) const;
  HRESULT Resize(HPCON pseudoconsole, COORD size) const;
  void Close(HPCON pseudoconsole) const;
  const ConPtyRuntimeInfo& runtime_info() const { return runtime_info_; }

 private:
  friend const ConPtyApi& GetConPtyApi();
  void Initialize();
  bool BindCore(HMODULE module, const char* create_name,
                const char* resize_name, const char* close_name);
  void ClearFunctions();
  void Fail(std::string failure_code, DWORD failure_win32);

  CreatePseudoConsoleFn create_ = nullptr;
  ResizePseudoConsoleFn resize_ = nullptr;
  ClosePseudoConsoleFn close_ = nullptr;
  // Deliberately retained for process lifetime: each HPCON contains state
  // private to the module whose create function returned it.
  HMODULE module_ = nullptr;
  // conpty.dll silently falls back to the inbox conhost when its selected
  // OpenConsole.exe disappears. Keep deny-write/delete handles to every
  // verified bundle member so the path cannot change after validation and
  // before a later Create call.
  std::vector<HANDLE> asset_locks_;
  ConPtyRuntimeInfo runtime_info_;
};

/// Verifies and resolves the complete side-by-side bundle. There is no inbox
/// fallback. The returned table is immutable and lives until process exit.
const ConPtyApi& GetConPtyApi();

}  // namespace termwright
