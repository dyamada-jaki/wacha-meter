#include "probe.hpp"
#include <iostream>

struct Fake final : probe::Sdk {
  std::string scenario;
  bool live = false;
  int attempts = 0;
  int polls = 0;
  explicit Fake(std::string s) : scenario(std::move(s)) {}
  bool initialize() override { live = true; return scenario != "init-failure"; }
  bool authenticate(const std::string&) override { ++attempts; return scenario != "api-failure"; }
  probe::AuthState poll() override {
    ++polls;
    using A = probe::AuthState;
    if (scenario == "failure") return A::failure;
    if (scenario == "sdk-timeout") return A::timeout;
    if (scenario == "rate-limit") return A::rate_limited;
    if (scenario == "pending" || scenario == "interrupt-pending") return A::pending;
    return A::success;
  }
  bool cleanup() override { live = false; return scenario != "cleanup-failure"; }
};
int main(int argc, char** argv) {
  if (argc != 2) return 99;
  Fake sdk(argv[1]);
  auto result = probe::run(sdk, "dummy-token", sdk.scenario == "init-only",
    std::chrono::milliseconds(15), [&] {
      return sdk.scenario == "interrupted" || (sdk.scenario == "interrupt-pending" && sdk.polls > 0);
    });
  std::cout << result.code << ' ' << result.initialized << ' ' << result.cleaned
            << ' ' << sdk.live << ' ' << sdk.attempts << '\n';
}
