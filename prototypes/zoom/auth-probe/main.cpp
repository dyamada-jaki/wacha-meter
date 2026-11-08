// わちゃメーター: Zoom Meeting SDK の初期化・認証だけを確かめる検証プログラム。
//
//   wacha-zoom-auth-probe init            InitSDK → CleanUPSDK
//   wacha-zoom-auth-probe auth <秒>       標準入力の JWT で SDKAuth し、結果か時間切れを待つ
//
// 結果は標準出力に「WACHA_PROBE_RESULT {json}」の1行で書く。JWT は出力しない。
// 会議サービス・音声・録音の API は呼ばない。
//
// 終了コード: 0 成功 / 1 初期化などの失敗 / 2 使い方の誤り / 3 認証失敗 / 4 時間切れ

#include <glib.h>

#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <string>

#include "auth_service_interface.h"
#include "zoom_sdk.h"
#include "zoom_sdk_def.h"

USING_ZOOM_SDK_NAMESPACE

namespace {

constexpr int kExitSuccess = 0;
constexpr int kExitOther = 1;
constexpr int kExitUsage = 2;
constexpr int kExitAuthFailed = 3;
constexpr int kExitTimedOut = 4;

const char* SdkErrorName(SDKError e) {
  switch (e) {
    case SDKERR_SUCCESS: return "SDKERR_SUCCESS";
    case SDKERR_NO_IMPL: return "SDKERR_NO_IMPL";
    case SDKERR_WRONG_USAGE: return "SDKERR_WRONG_USAGE";
    case SDKERR_INVALID_PARAMETER: return "SDKERR_INVALID_PARAMETER";
    case SDKERR_MODULE_LOAD_FAILED: return "SDKERR_MODULE_LOAD_FAILED";
    case SDKERR_MEMORY_FAILED: return "SDKERR_MEMORY_FAILED";
    case SDKERR_SERVICE_FAILED: return "SDKERR_SERVICE_FAILED";
    case SDKERR_UNINITIALIZE: return "SDKERR_UNINITIALIZE";
    case SDKERR_UNAUTHENTICATION: return "SDKERR_UNAUTHENTICATION";
    case SDKERR_UNKNOWN: return "SDKERR_UNKNOWN";
    case SDKERR_OTHER_SDK_INSTANCE_RUNNING: return "SDKERR_OTHER_SDK_INSTANCE_RUNNING";
    case SDKERR_INTERNAL_ERROR: return "SDKERR_INTERNAL_ERROR";
    case SDKERR_TOO_FREQUENT_CALL: return "SDKERR_TOO_FREQUENT_CALL";
    default: return "SDKERR_OTHER";
  }
}

const char* AuthResultName(AuthResult r) {
  switch (r) {
    case AUTHRET_SUCCESS: return "AUTHRET_SUCCESS";
    case AUTHRET_KEYORSECRETEMPTY: return "AUTHRET_KEYORSECRETEMPTY";
    case AUTHRET_KEYORSECRETWRONG: return "AUTHRET_KEYORSECRETWRONG";
    case AUTHRET_ACCOUNTNOTSUPPORT: return "AUTHRET_ACCOUNTNOTSUPPORT";
    case AUTHRET_ACCOUNTNOTENABLESDK: return "AUTHRET_ACCOUNTNOTENABLESDK";
    case AUTHRET_UNKNOWN: return "AUTHRET_UNKNOWN";
    case AUTHRET_SERVICE_BUSY: return "AUTHRET_SERVICE_BUSY";
    case AUTHRET_NONE: return "AUTHRET_NONE";
    case AUTHRET_OVERTIME: return "AUTHRET_OVERTIME";
    case AUTHRET_NETWORKISSUE: return "AUTHRET_NETWORKISSUE";
    case AUTHRET_CLIENT_INCOMPATIBLE: return "AUTHRET_CLIENT_INCOMPATIBLE";
    case AUTHRET_JWTTOKENWRONG: return "AUTHRET_JWTTOKENWRONG";
    case AUTHRET_LIMIT_EXCEEDED_EXCEPTION: return "AUTHRET_LIMIT_EXCEEDED_EXCEPTION";
    default: return "AUTHRET_OTHER";
  }
}

void PrintResult(const char* mode, const char* outcome, const char* stage, const char* code) {
  std::string line = std::string("WACHA_PROBE_RESULT {\"mode\":\"") + mode + "\",\"outcome\":\"" + outcome + "\"";
  if (stage) line += std::string(",\"stage\":\"") + stage + "\"";
  if (code) line += std::string(",\"code\":\"") + code + "\"";
  line += "}";
  std::cout << line << std::endl;
}

void Progress(const char* message) { std::cerr << "[probe] " << message << std::endl; }

struct AuthState {
  GMainLoop* loop = nullptr;
  bool returned = false;
  bool timed_out = false;
  AuthResult result = AUTHRET_NONE;
};

class AuthEvent : public IAuthServiceEvent {
 public:
  explicit AuthEvent(AuthState* state) : state_(state) {}
  void onAuthenticationReturn(AuthResult ret) override {
    if (state_->returned || state_->timed_out) return;
    state_->returned = true;
    state_->result = ret;
    g_main_loop_quit(state_->loop);
  }
  void onLoginReturnWithReason(LOGINSTATUS, IAccountInfo*, LoginFailReason) override {}
  void onLogout() override {}
  void onZoomIdentityExpired() override {}
  void onZoomAuthIdentityExpired() override {}

 private:
  AuthState* state_;
};

gboolean OnTimeout(gpointer data) {
  auto* state = static_cast<AuthState*>(data);
  if (!state->returned) {
    state->timed_out = true;
    g_main_loop_quit(state->loop);
  }
  return G_SOURCE_REMOVE;
}

SDKError Init() {
  InitParam param;
  param.strWebDomain = "https://zoom.us";
  param.emLanguageID = LANGUAGE_English;
  // ログ・クラッシュダンプは残さない（秘密や会議の情報を含みうるファイルを作らない）
  param.enableLogByDefault = false;
  param.enableGenerateDump = false;
  return InitSDK(param);
}

// 後始末に失敗した場合は、それまでの結果より優先して失敗として返す
bool Cleanup(const char* mode) {
  SDKError err = CleanUPSDK();
  if (err != SDKERR_SUCCESS) {
    PrintResult(mode, "failed", "cleanup", SdkErrorName(err));
    return false;
  }
  Progress("CleanUPSDK: SDKERR_SUCCESS");
  return true;
}

int RunInit() {
  SDKError err = Init();
  if (err != SDKERR_SUCCESS) {
    PrintResult("init", "failed", "init", SdkErrorName(err));
    return kExitOther;
  }
  Progress("InitSDK: SDKERR_SUCCESS");
  if (!Cleanup("init")) return kExitOther;
  PrintResult("init", "succeeded", nullptr, nullptr);
  return kExitSuccess;
}

int RunAuth(int timeout_seconds) {
  std::string jwt;
  std::getline(std::cin, jwt);
  if (jwt.empty()) {
    PrintResult("auth", "failed", "init", "NO_JWT_ON_STDIN");
    return kExitUsage;
  }

  SDKError err = Init();
  if (err != SDKERR_SUCCESS) {
    PrintResult("auth", "failed", "init", SdkErrorName(err));
    return kExitOther;
  }
  Progress("InitSDK: SDKERR_SUCCESS");

  IAuthService* auth = nullptr;
  err = CreateAuthService(&auth);
  if (err != SDKERR_SUCCESS || auth == nullptr) {
    PrintResult("auth", "failed", "auth", SdkErrorName(err));
    Cleanup("auth");
    return kExitOther;
  }

  AuthState state;
  state.loop = g_main_loop_new(nullptr, FALSE);
  AuthEvent event(&state);
  auth->SetEvent(&event);

  AuthContext context;
  context.jwt_token = jwt.c_str();
  err = auth->SDKAuth(context);
  int exit_code = kExitOther;
  if (err != SDKERR_SUCCESS) {
    PrintResult("auth", "failed", "auth", SdkErrorName(err));
  } else {
    Progress("SDKAuth: 送信しました。結果を待ちます");
    g_timeout_add_seconds(static_cast<guint>(timeout_seconds), OnTimeout, &state);
    g_main_loop_run(state.loop);
    if (state.timed_out) {
      PrintResult("auth", "timeout", "auth", nullptr);
      exit_code = kExitTimedOut;
    } else if (state.result == AUTHRET_SUCCESS) {
      exit_code = kExitSuccess;
    } else if (state.result == AUTHRET_OVERTIME) {
      // SDK 自身が時間切れと報告した場合も、時間切れとして区別する
      PrintResult("auth", "timeout", "auth", AuthResultName(state.result));
      exit_code = kExitTimedOut;
    } else {
      PrintResult("auth", "failed", "auth", AuthResultName(state.result));
      exit_code = kExitAuthFailed;
    }
  }

  // JWT をメモリ上でも早めに消す
  jwt.assign(jwt.size(), '\0');
  auth->SetEvent(nullptr);
  DestroyAuthService(auth);
  g_main_loop_unref(state.loop);
  if (!Cleanup("auth")) return kExitOther;
  if (exit_code == kExitSuccess) PrintResult("auth", "succeeded", nullptr, nullptr);
  return exit_code;
}

}  // namespace

int main(int argc, char** argv) {
  const std::string mode = argc >= 2 ? argv[1] : "";
  if (mode == "init" && argc == 2) return RunInit();
  if (mode == "auth" && argc == 3) {
    char* end = nullptr;
    const long seconds = std::strtol(argv[2], &end, 10);
    if (end != argv[2] && *end == '\0' && seconds >= 1 && seconds <= 600) {
      return RunAuth(static_cast<int>(seconds));
    }
  }
  std::cerr << "使い方: wacha-zoom-auth-probe init | auth <1〜600 秒>" << std::endl;
  return kExitUsage;
}
