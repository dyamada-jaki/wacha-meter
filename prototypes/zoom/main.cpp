#include "probe.hpp"
#include <zoom_sdk.h>
#include <auth_service_interface.h>
#include <glib.h>
#include <atomic>
#include <csignal>
#include <iostream>

namespace z = ZOOM_SDK_NAMESPACE;
namespace {
volatile std::sig_atomic_t stopped = 0;
void stop(int) { stopped = 1; }

class Zoom final : public probe::Sdk, public z::IAuthServiceEvent {
  z::IAuthService* auth_ = nullptr;
  bool initialized_ = false;
  std::atomic<probe::AuthState> state_{probe::AuthState::pending};
public:
  bool initialize() override {
    z::InitParam parameters;
    parameters.strWebDomain = "https://zoom.us";
    parameters.strSupportUrl = "https://zoom.us";
    parameters.emLanguageID = z::LANGUAGE_English;
    parameters.enableGenerateDump = false;
    parameters.enableLogByDefault = false;
    initialized_ = z::InitSDK(parameters) == z::SDKERR_SUCCESS;
    return initialized_;
  }
  bool authenticate(const std::string& token) override {
    if (z::CreateAuthService(&auth_) != z::SDKERR_SUCCESS || !auth_) return false;
    if (auth_->SetEvent(this) != z::SDKERR_SUCCESS) return false;
    z::AuthContext context;
    context.jwt_token = token.c_str();
    // 1回だけ。失敗時・回数制限時にも再試行しない。
    const auto result = auth_->SDKAuth(context);
    if (result == z::SDKERR_TOO_FREQUENT_CALL) {
      state_ = probe::AuthState::rate_limited;
      return true;
    }
    return result == z::SDKERR_SUCCESS;
  }
  probe::AuthState poll() override {
    // イベントが絶えず来ても deadline を再確認できるよう1回ずつ処理する。
    g_main_context_iteration(nullptr, false);
    return state_.load();
  }
  bool cleanup() override {
    bool ok = true;
    if (auth_) {
      ok = z::DestroyAuthService(auth_) == z::SDKERR_SUCCESS;
      auth_ = nullptr;
    }
    if (initialized_) {
      const bool cleaned = z::CleanUPSDK() == z::SDKERR_SUCCESS;
      ok = cleaned && ok;
      initialized_ = false;
    }
    return ok;
  }
  void onAuthenticationReturn(z::AuthResult result) override {
    using A = probe::AuthState;
    if (result == z::AUTHRET_SUCCESS) state_ = A::success;
    else if (result == z::AUTHRET_OVERTIME) state_ = A::timeout;
    else if (result == z::AUTHRET_LIMIT_EXCEEDED_EXCEPTION) state_ = A::rate_limited;
    else state_ = A::failure;
  }
  void onLoginReturnWithReason(z::LOGINSTATUS, z::IAccountInfo*, z::LoginFailReason) override {}
  void onLogout() override {}
  void onZoomIdentityExpired() override {}
  void onZoomAuthIdentityExpired() override {}
};
}

int main(int argc, char** argv) {
  std::signal(SIGINT, stop);
  std::signal(SIGTERM, stop);
  const bool init_only = argc == 2 && std::string(argv[1]) == "--init-only";
  if (!init_only && !(argc == 2 && std::string(argv[1]) == "--auth")) return 2;
  std::string token;
  if (!init_only) {
    // stdin のみ。外側の監視で読込停止も有限時間にする。
    for (char c; std::cin.get(c) && c != '\n';) {
      if (token.size() >= 16384) return 2;
      token += c;
    }
    if (token.empty()) return 2;
  }
  Zoom sdk;
  const auto result = probe::run(sdk, token, init_only, std::chrono::seconds(30), [] { return stopped != 0; });
  if (result.initialized) std::cout << "WACHA_INIT_OK\n";
  if (result.cleaned) std::cout << "WACHA_CLEAN_OK\n";
  std::cout << "WACHA_RESULT_" << result.code << std::endl;
  return result.code;
}
