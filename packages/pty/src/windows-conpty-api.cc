#include "windows-conpty-api.h"

#include <bcrypt.h>

#include <array>
#include <cwchar>
#include <mutex>
#include <utility>
#include <vector>

namespace termwright {
namespace {

constexpr wchar_t kVendorDirectory[] = L"vendor";
constexpr wchar_t kVendoredDll[] = L"conpty.dll";
constexpr wchar_t kVendoredHost[] = L"OpenConsole.exe";
const char kModuleAnchor = 0;

#if defined(_M_X64)
constexpr std::array<unsigned char, 32> kDllDigest = {
    0x39, 0xfb, 0xa2, 0x71, 0x3e, 0x24, 0x95, 0x11, 0x7b, 0x15, 0x91,
    0xae, 0x8c, 0x32, 0xa3, 0xb9, 0x04, 0xbe, 0xa7, 0xaa, 0x66, 0x06,
    0x9c, 0xf7, 0x81, 0x5e, 0x28, 0x44, 0xc7, 0x6d, 0x75, 0xd8};
#elif defined(_M_ARM64)
constexpr std::array<unsigned char, 32> kDllDigest = {
    0xdb, 0x3d, 0x17, 0x36, 0x40, 0xb1, 0x72, 0xba, 0xfd, 0x42, 0xd5,
    0xb5, 0x41, 0xb6, 0x38, 0xa9, 0xae, 0xec, 0x1c, 0x7d, 0x0e, 0x40,
    0xdd, 0x63, 0x6b, 0xf0, 0x28, 0x22, 0xa3, 0x2c, 0x91, 0x2c};
#endif

#if defined(_M_X64)
constexpr std::array<unsigned char, 32> kX64HostDigest = {
    0xb7, 0xfd, 0x93, 0x6c, 0x26, 0x68, 0xb8, 0x7b, 0x9e, 0xcf, 0x7b,
    0x33, 0x66, 0xdc, 0x65, 0x68, 0xaf, 0xc1, 0xc6, 0xf9, 0x81, 0x87,
    0x4c, 0xba, 0x3e, 0x95, 0x5a, 0x1c, 0x35, 0xcf, 0x81, 0x60};
#endif
constexpr std::array<unsigned char, 32> kArm64HostDigest = {
    0xed, 0x76, 0x22, 0xfd, 0x0d, 0x3b, 0xed, 0xc9, 0xab, 0x9f, 0x12,
    0x2f, 0x5e, 0x58, 0xed, 0xf0, 0xde, 0xf9, 0xe7, 0x99, 0x92, 0x24,
    0xf5, 0x2d, 0xd3, 0x95, 0xba, 0x9f, 0x54, 0xed, 0xbe, 0x09};

bool RegularFile(const std::wstring& path) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES &&
         (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

bool Exists(const std::wstring& path) {
  return GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES;
}

std::wstring ModulePath(HMODULE module) {
  if (module == nullptr) return {};
  std::vector<wchar_t> buffer(512);
  for (;;) {
    SetLastError(ERROR_SUCCESS);
    const DWORD length = GetModuleFileNameW(module, buffer.data(),
                                            static_cast<DWORD>(buffer.size()));
    if (length == 0) return {};
    if (length < buffer.size()) return std::wstring(buffer.data(), length);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || buffer.size() >= 32768) return {};
    buffer.resize(buffer.size() * 2);
  }
}

std::wstring DirectoryOf(const std::wstring& path) {
  const size_t separator = path.find_last_of(L"\\/");
  return separator == std::wstring::npos ? std::wstring() : path.substr(0, separator);
}

std::wstring Join(const std::wstring& parent, const wchar_t* child) {
  if (parent.empty()) return {};
  return parent + L"\\" + child;
}

std::wstring FinalPath(HANDLE file) {
  if (file == INVALID_HANDLE_VALUE) return {};
  std::vector<wchar_t> buffer(512);
  std::wstring result;
  for (;;) {
    const DWORD length = GetFinalPathNameByHandleW(
        file, buffer.data(), static_cast<DWORD>(buffer.size()),
        FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (length == 0) break;
    if (length < buffer.size()) {
      result.assign(buffer.data(), length);
      break;
    }
    buffer.resize(static_cast<size_t>(length) + 1);
  }
  return result;
}

std::wstring FinalPath(const std::wstring& path) {
  HANDLE file = CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES,
                            FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr,
                            OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return {};
  const std::wstring result = FinalPath(file);
  CloseHandle(file);
  return result;
}

std::string SelectedHostArchitecture(DWORD* error) {
  USHORT process_machine = IMAGE_FILE_MACHINE_UNKNOWN;
  USHORT native_machine = IMAGE_FILE_MACHINE_UNKNOWN;
  if (!IsWow64Process2(GetCurrentProcess(), &process_machine, &native_machine)) {
    *error = GetLastError();
    return {};
  }
  if (native_machine == IMAGE_FILE_MACHINE_ARM64) return "arm64";
  if (native_machine == IMAGE_FILE_MACHINE_AMD64) return "x64";
  *error = ERROR_NOT_SUPPORTED;
  return {};
}

bool OpenValidatedAsset(const std::wstring& path,
                        const std::array<unsigned char, 32>& expected,
                        HANDLE* retained, DWORD* error) {
  // FILE_SHARE_READ deliberately excludes write and delete sharing. The
  // loader/host may reopen the file for execution, but an updater, quarantine
  // action or attacker cannot replace it after the digest has been accepted.
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                            OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    *error = GetLastError();
    return false;
  }

  BY_HANDLE_FILE_INFORMATION information{};
  if (!GetFileInformationByHandle(file, &information)) {
    *error = GetLastError();
    CloseHandle(file);
    return false;
  }
  if ((information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
    *error = ERROR_INVALID_DATA;
    CloseHandle(file);
    return false;
  }

  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  std::array<unsigned char, 32> actual{};
  bool success = false;
  if (!BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(
          &algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0))) {
    *error = ERROR_NOT_SUPPORTED;
  } else if (!BCRYPT_SUCCESS(
                 BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0))) {
    *error = ERROR_INVALID_FUNCTION;
  } else {
    std::array<unsigned char, 64 * 1024> buffer{};
    for (;;) {
      DWORD read = 0;
      if (!ReadFile(file, buffer.data(), static_cast<DWORD>(buffer.size()), &read,
                    nullptr)) {
        *error = GetLastError();
        break;
      }
      if (read == 0) {
        if (!BCRYPT_SUCCESS(
                BCryptFinishHash(hash, actual.data(),
                                 static_cast<ULONG>(actual.size()), 0))) {
          *error = ERROR_INVALID_DATA;
        } else if (actual != expected) {
          *error = ERROR_CRC;
        } else {
          success = true;
        }
        break;
      }
      if (!BCRYPT_SUCCESS(BCryptHashData(hash, buffer.data(), read, 0))) {
        *error = ERROR_INVALID_DATA;
        break;
      }
    }
  }
  if (hash != nullptr) BCryptDestroyHash(hash);
  if (algorithm != nullptr) BCryptCloseAlgorithmProvider(algorithm, 0);
  if (success) {
    *retained = file;
  } else {
    CloseHandle(file);
  }
  return success;
}

template <typename Function>
Function Export(HMODULE module, const char* name) {
  return reinterpret_cast<Function>(
      reinterpret_cast<void*>(GetProcAddress(module, name)));
}

}  // namespace

ConPtyApi::~ConPtyApi() {
  ClearFunctions();
  for (const HANDLE handle : asset_locks_) CloseHandle(handle);
  asset_locks_.clear();
  if (module_ != nullptr) FreeLibrary(module_);
}

bool ConPtyApi::BindCore(HMODULE module, const char* create_name,
                         const char* resize_name, const char* close_name) {
  create_ = Export<CreatePseudoConsoleFn>(module, create_name);
  resize_ = Export<ResizePseudoConsoleFn>(module, resize_name);
  close_ = Export<ClosePseudoConsoleFn>(module, close_name);
  runtime_info_.core_exports = available();
  return available();
}

void ConPtyApi::ClearFunctions() {
  create_ = nullptr;
  resize_ = nullptr;
  close_ = nullptr;
  runtime_info_.core_exports = false;
}

void ConPtyApi::Fail(std::string failure_code, DWORD failure_win32) {
  ClearFunctions();
  runtime_info_.failure_code = std::move(failure_code);
  runtime_info_.failure_win32 = failure_win32;
  runtime_info_.assets_validated = false;
}

void ConPtyApi::Initialize() {
  HMODULE addon = nullptr;
  if (!GetModuleHandleExW(
          GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
              GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
          reinterpret_cast<LPCWSTR>(&kModuleAnchor), &addon)) {
    Fail("addon-module-path-unavailable", GetLastError());
    return;
  }
  const std::wstring addon_path = ModulePath(addon);
  if (addon_path.empty()) {
    Fail("addon-module-path-unavailable", ERROR_INSUFFICIENT_BUFFER);
    return;
  }
  const std::wstring vendor = Join(DirectoryOf(addon_path), kVendorDirectory);
  const std::wstring dll_path = Join(vendor, kVendoredDll);
  if (Exists(Join(vendor, kVendoredHost))) {
    Fail("vendored-host-sibling-layout-rejected", ERROR_INVALID_DATA);
    return;
  }
  DWORD architecture_error = ERROR_SUCCESS;
  runtime_info_.selected_host_architecture =
      SelectedHostArchitecture(&architecture_error);
  if (runtime_info_.selected_host_architecture.empty()) {
    Fail("host-architecture-unavailable", architecture_error);
    return;
  }
#if defined(_M_ARM64)
  if (runtime_info_.selected_host_architecture != "arm64") {
    Fail("host-architecture-mismatch", ERROR_BAD_ENVIRONMENT);
    return;
  }
#endif
  const bool dll_present = RegularFile(dll_path);
#if defined(_M_X64)
  const std::wstring x64_host = Join(Join(vendor, L"x64"), kVendoredHost);
  const std::wstring arm64_host = Join(Join(vendor, L"arm64"), kVendoredHost);
  const bool x64_host_present = RegularFile(x64_host);
  const bool arm64_host_present = RegularFile(arm64_host);
  const bool hosts_present = x64_host_present && arm64_host_present;
  const bool any_asset_present =
      dll_present || x64_host_present || arm64_host_present;
#elif defined(_M_ARM64)
  const std::wstring arm64_host = Join(Join(vendor, L"arm64"), kVendoredHost);
  const bool arm64_host_present = RegularFile(arm64_host);
  const bool hosts_present = arm64_host_present;
  const bool any_asset_present = dll_present || arm64_host_present;
#else
  Fail("unsupported-addon-architecture", ERROR_NOT_SUPPORTED);
  return;
#endif
  if (!any_asset_present) {
    Fail("vendored-bundle-missing", ERROR_FILE_NOT_FOUND);
    return;
  }
  if (!dll_present || !hosts_present) {
    Fail("vendored-bundle-incomplete", ERROR_FILE_NOT_FOUND);
    return;
  }

  DWORD validation_error = ERROR_SUCCESS;
  std::vector<HANDLE> locked_assets;
  auto lock_asset = [&](const std::wstring& path,
                        const std::array<unsigned char, 32>& digest) {
    HANDLE retained = INVALID_HANDLE_VALUE;
    if (!OpenValidatedAsset(path, digest, &retained, &validation_error)) {
      return false;
    }
    locked_assets.push_back(retained);
    return true;
  };
  auto close_locked_assets = [&]() {
    for (const HANDLE handle : locked_assets) CloseHandle(handle);
    locked_assets.clear();
  };
  if (!lock_asset(dll_path, kDllDigest)
#if defined(_M_X64)
      || !lock_asset(x64_host, kX64HostDigest)
#endif
      || !lock_asset(arm64_host, kArm64HostDigest)) {
    close_locked_assets();
    Fail("vendored-asset-digest-mismatch", validation_error);
    return;
  }

  const std::wstring expected_module_path = FinalPath(locked_assets.front());
  if (expected_module_path.empty()) {
    close_locked_assets();
    Fail("vendored-dll-canonical-path-unavailable", ERROR_INVALID_NAME);
    return;
  }

  HMODULE vendored = LoadLibraryExW(
      dll_path.c_str(), nullptr,
      LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
  if (vendored == nullptr) {
    close_locked_assets();
    Fail("vendored-dll-load-failed", GetLastError());
    return;
  }

  const std::wstring loaded_module_path = FinalPath(ModulePath(vendored));
  if (loaded_module_path.empty() ||
      _wcsicmp(expected_module_path.c_str(), loaded_module_path.c_str()) != 0) {
    FreeLibrary(vendored);
    close_locked_assets();
    Fail("vendored-dll-module-identity-mismatch", ERROR_INVALID_DATA);
    return;
  }

  module_ = vendored;
  if (!BindCore(vendored, "ConptyCreatePseudoConsole",
                "ConptyResizePseudoConsole", "ConptyClosePseudoConsole")) {
    // No HPCON exists yet, so abandoning an incomplete candidate is safe.
    FreeLibrary(vendored);
    module_ = nullptr;
    close_locked_assets();
    Fail("vendored-core-exports-missing", ERROR_PROC_NOT_FOUND);
    return;
  }
  asset_locks_ = std::move(locked_assets);
  runtime_info_.assets_validated = true;
}

HRESULT ConPtyApi::Create(COORD size, HANDLE input, HANDLE output, DWORD flags,
                          HPCON* pseudoconsole) const {
  if (!available()) return HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
  return create_(size, input, output, flags, pseudoconsole);
}

HRESULT ConPtyApi::Resize(HPCON pseudoconsole, COORD size) const {
  if (!available()) return HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
  return resize_(pseudoconsole, size);
}

void ConPtyApi::Close(HPCON pseudoconsole) const {
  if (close_ != nullptr) close_(pseudoconsole);
}

const ConPtyApi& GetConPtyApi() {
  static ConPtyApi api;
  static std::once_flag once;
  std::call_once(once, [] { api.Initialize(); });
  return api;
}

}  // namespace termwright
