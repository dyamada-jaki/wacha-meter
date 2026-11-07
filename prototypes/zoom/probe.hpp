#pragma once
#include <chrono>
#include <functional>
#include <string>
#include <thread>

namespace probe {
enum class AuthState { pending, success, failure, timeout, rate_limited };
struct Sdk {
  virtual ~Sdk() = default;
  virtual bool initialize() = 0;
  virtual bool authenticate(const std::string&) = 0;
  virtual AuthState poll() = 0;
  virtual bool cleanup() = 0;
};
struct Result { int code; bool initialized; bool cleaned; };
inline Result run(Sdk& sdk, const std::string& token, bool init_only,
                  std::chrono::milliseconds timeout, const std::function<bool()>& stopped) {
  Result result{0, false, false};
  if (stopped()) result.code = 7;
  else if (!(result.initialized = sdk.initialize())) result.code = 3;
  else if (!init_only) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    if (stopped()) result.code = 7;
    else if (!sdk.authenticate(token)) result.code = 4;
    else for (;;) {
      if (stopped()) { result.code = 7; break; }
      const auto state = sdk.poll();
      if (state == AuthState::success) break;
      if (state == AuthState::failure) { result.code = 4; break; }
      if (state == AuthState::rate_limited) { result.code = 9; break; }
      if (state == AuthState::timeout || std::chrono::steady_clock::now() >= deadline) {
        result.code = 5; break;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
  }
  // callback から抜けてから解放する。初期化の途中で失敗した場合も対象。
  result.cleaned = sdk.cleanup();
  if (!result.cleaned) result.code = 6;
  return result;
}
}
