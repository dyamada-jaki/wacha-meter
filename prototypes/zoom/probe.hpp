#pragma once
#include <chrono>
#include <functional>
#include <string>

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
inline Result run(Sdk&, const std::string&, bool, std::chrono::milliseconds,
                  const std::function<bool()>&) {
  return {8, false, false};
}
}
