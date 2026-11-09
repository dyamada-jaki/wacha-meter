# Zoom 接続試作の準備

目的は、今の Mac 上で「わちゃメーター」が独立した参加者として入室し、主催者の許可を受けて音声を取得すること。現在は SDK の初期化・認証を確かめる検証プログラム（[Issue #1](https://github.com/dyamada-jaki/wacha-meter/issues/1)）と、本人の Zoom アカウントで OAuth を許可してトークン取得を確かめるコマンド（[Issue #4](https://github.com/dyamada-jaki/wacha-meter/issues/4)）まで。会議参加プログラムは未実装。

## SDK の受領と引き継ぎ

### 7.2.1.5860（現在使う版）

2026-11-08: ユーザーが Zoom App Marketplace の「Linux-all」バンドル `zoom-meeting-sdk-linux-7.2.1.5860.tar.xz`（`version.txt` は v7.2.1.5860）を取得し、Downloads に保存した。7.1.5.4434 の arm64 単独のアーカイブと違い、`zoom-sdk-linux-7.2.1.5860/` の下に `arm64/` と `x86_64/` が分かれている。`arm64/` だけを使う。

SHA-256: `ddf8daffb053a7bd4702ac9f6f7de2ab6cb58a537eb3448df18a499ac7e62750`（受領したファイルを識別するための値。提供元の署名検証ではない）。`prepare-sdk.sh` がこの値を照合し、`arm64/` の中身だけを `.local/zoom-sdk/7.2.1.5860/` の直下に展開する（`libmeetingsdk.so` が 64 ビット ELF / AArch64 であること、リンク先が絶対パス、または `..` を含むシンボリックリンクが無いことを確かめてから置く。`..` を含まない相対のリンク先は置き場所のフォルダより下にしか行けないので、リンクが連鎖しても展開先の外には出られない。この SDK の `arm64/` のリンクは `libglib2/lib/` 内の12個で、どれも `..` を含まない。失敗したときは展開先を作らず、今回作った親フォルダだけを消す）。アーカイブ内のスクリプトは実行しない。

7.1.5.4434 から替えた理由:

- 実測（2026-11-08）: 7.1.5.4434 では、本物の認証情報で `SDKAuth` が SDKERR_SUCCESS を返したあと、120 秒待っても `onAuthenticationReturn` が呼ばれなかった（ダミーの認証情報では `AUTHRET_JWTTOKENWRONG` がすぐ返った）
- 出典（Zoom 開発者フォーラム「[Linux arm64 Meeting SDK 7.1.0 / 7.1.5: SDKAuth never calls back](https://devforum.zoom.us/t/linux-arm64-meeting-sdk-7-1-0-7-1-5-sdkauth-never-calls-back-7-0-5-arm64-and-7-1-5-x86-64-work/146972)」）: 同じ症状が Linux arm64 の 7.1.0 / 7.1.5.4434 だけで起き、7.2.1.5860 の arm64 で解消したとの報告。7.2.1 の変更履歴には「ARM64 Linux で GLib と組み合わせたときの hang」の修正が挙がっている。この不具合が上の症状の原因だというのはフォーラムの報告に基づく推測で、SDK の内部までは確かめていない
- 実測（2026-11-08）: 7.2.1.5860 では、同じ本物の認証情報で認証が成功した（下の確認結果）

7.2.1.5860 で増えた・変わった点（今回の検証プログラムに関係するもの）:

- `arm64/libglib2/` に GLib 2.72.4 が同梱されている。`libmeetingsdk.so` の RUNPATH は `$$ORIGIN` などビルド環境のパスで、コンテナでは効かない。検証プログラムは今までどおり Ubuntu 24.04 のシステムの GLib にリンクしており、それで初期化・認証が成功した。同梱の GLib は使っていない
- `IZoomSDKRendererDelegate` に純粋仮想関数 `onShareCursorDataReceived` が増えた（`h/rawdata/rawdata_renderer_interface.h`）。検証プログラムはこのインターフェースを使わないので影響はない。音声・映像の受信を作るときに実装が必要
- ヘッダーの増減: `meeting_backstage_interface.h`・`meeting_remote_ctrl_interface.h`・`rawdata/rawdata_video_mixer_interface.h` が増え、`meeting_smart_summary_interface.h` がなくなった。`zoom_sdk_def.h` に `SDKERR_SEND_TOO_MUCH_DATA_IN_SINGLE_TIME` などが増えた
- `libmeetingsdk.so` の依存（NEEDED）は libglib-2.0・libstdc++・libc など。必要な glibc は 2.35 まで

### 7.1.5.4434（以前の版）

2026-11-07: ユーザーが `zoom-meeting-sdk-linux_arm64-7.1.5.4434.tar.xz` を取得。Downloads に保存されている。アーカイブ内の `libmeetingsdk.so` が 64 ビット ELF / AArch64（e_machine=183）で、初期化・認証・音声関連のヘッダーを含むことを確認した。この受領時点では SDK のリンク・初期化・認証は未実施だった。その後、初期化は成功したが実認証のコールバックが返らず、7.2.1.5860 に切り替えた。

SHA-256: `384d2e522b0d3e2650bb5e6f5201e1e5e5d88151a5f8808a2b8832c97c4fcb19`（以前の受領ファイルの記録）。現在は [ADR 0002](../../docs/decisions/0002-zoom-sdkは7.2.1.5860のarm64を使う.md) に従い、7.2.1.5860 の arm64 を使う。

[Issue #1](https://github.com/dyamada-jaki/wacha-meter/issues/1) は完了し、初期化・認証プログラムを PR #2 で main へ取り込み済み。main の `.local/` に SDK 7.2.1 の展開物と検証プログラムのビルド結果を保持している（Git 管理外）。検証と後片付けの記録は [Issue レポート](../../docs/issue-reports/issue-1.md)。

## 用意した環境

Apple Silicon に合わせて、既存の OrbStack / Docker 上の ARM64 Linux を使う。Ubuntu 24.04 と C++ / CMake、および公式サンプルを参考にした音声・描画関連の依存を含む。SDK 本体や秘密情報はイメージに入れない。

```sh
docker build --platform linux/arm64 -t wacha-meter-zoom-dev:local prototypes/zoom
docker run --rm --platform linux/arm64 wacha-meter-zoom-dev:local uname -m
```

上の確認はビルド環境の確認であり、Zoom SDK のビルド・動作確認ではない。SDK を使った初期化・認証の確認は後述の検証プログラムで行う。Rosetta / x86_64 エミュレーションは使わない。

2026-11-07 の実機確認結果: Docker イメージのビルド成功、実行環境と C++ コンパイラーが aarch64、GLib / libcurl を使う小さな C++ プログラムのコンパイル・実行成功、PulseAudio の起動と仮想出力デバイスの作成成功。Mac のマイクや会議音声は取得していない。

## SDK の初期化・認証の確認（Issue #1）

会議への参加・音声取得・録音は行わない。SDK の初期化と認証の結果だけを確かめて終了する。

### 仕組み

| 部品 | 場所 | 役割 |
|---|---|---|
| 検証プログラム（C++） | `auth-probe/` | `init`: InitSDK → CleanUPSDK。`auth <秒>`: 標準入力の JWT で SDKAuth し、結果か時間切れを待って後始末する。結果は `WACHA_PROBE_RESULT {json}` の1行 |
| 検証コマンド（TypeScript） | `src/zoom-auth/` | 認証情報の確認、JWT（HS256）の作成、Docker の起動、ホスト側の上限での停止、結果の判定と終了コード |
| SDK 本体・ビルド結果・認証情報 | `.local/`（Git 管理外） | リポジトリ・イメージには入れない |

- JWT は Docker の標準入力で渡す。引数・環境変数には載せない。docker コマンドには Docker の接続に必要な環境変数（PATH・HOME・DOCKER_* など）だけを渡し、`ZOOM_SDK_CLIENT_SECRET` は渡さない
- SDK のログ・クラッシュダンプは無効。コンテナは `--rm` で毎回消し、終了後に同名のコンテナが残っていないことを確かめて表示する。残っていれば `docker rm -f` し、もう一度確かめる。削除できない・確かめられないときは成功（終了コード 0）にしない
- 中断: `--init` で PID 1 に init を置く。Ctrl+C（SIGINT）・SIGTERM を受けたら、自分のコンテナを `docker kill` して残りを確かめ・削除してから、130 / 143 で終了する
- Docker がコンテナや検証プログラムを起動できなかったとき（結果行がなく終了コード 125 / 126 / 127）は、`docker:` で始まる行と、init（tini）が検証プログラムを実行できなかった行だけを表示する。それ以外の標準エラーは出さない
- 待ち時間: SDK 側は既定 30 秒（`--timeout` で 1〜600 秒）。ホスト側はその 15 秒後に `docker kill` し、さらに 5 秒で止まらなければ docker コマンドを強制終了する。`docker kill` は 5 秒、後始末の `docker ps` / `rm` はそれぞれ 10 秒を上限とし、Docker が応答しなくても有限時間で終わる。`init` のホスト側の上限は 45 秒
- 終了コード: 0 成功 / 1 その他（SDK の初期化・呼び出し・後始末の失敗、結果を読めない）/ 2 設定・使い方の誤り（検証プログラムは起動しない）/ 3 認証失敗 / 4 時間切れ（SDK から結果が返らず検証プログラムの待ち時間を超えた／SDK が `AUTHRET_OVERTIME` を返した／ホスト側の上限）
- JWT の有効期間は 1 時間。公式資料の最小は 30 分（1800 秒）だが、短い JWT は `SDKAuth` の呼び出し時点で拒否された（いずれも `--offline`、ダミーの認証情報、各1回の実測）
  - 7.1.5.4434（2026-11-07）: exp − iat = 1800 秒を `SDKERR_INTERNAL_ERROR` で拒否。1801 秒・3600 秒は受け付けた
  - 7.2.1.5860（2026-11-08）: 1800 秒・1801 秒を `SDKERR_INVALID_PARAMETER` で拒否。1802・1805・1830・1900・2400・3600 秒は受け付けた
  - iat はホストで作り、1〜2 秒後にコンテナで渡す。SDK は自身の時計で「残りの有効期間が 1800 秒以上か」を確かめているとみられる（推測）。境界が 1 秒ずれたのが版の違いか起動の遅れかは区別していない

### 手順

```sh
# 1. SDK の arm64 部分を Git 管理外へ展開（SHA-256 と AArch64 の ELF を確かめる）
prototypes/zoom/scripts/prepare-sdk.sh ~/Downloads/zoom-meeting-sdk-linux-7.2.1.5860.tar.xz

# 2. ビルド環境のイメージ（SDK・秘密は入らない）
docker build --platform linux/arm64 -t wacha-meter-zoom-dev:local prototypes/zoom

# 3. 検証プログラムをコンテナ内でビルド（結果は .local/zoom-auth-probe/build/）
prototypes/zoom/scripts/build-probe.sh

# 4. 初期化と後始末だけを確認（認証情報は不要）
npm run zoom:init

# 5. 認証の確認（認証情報の設定後）
npm run zoom:auth
npm run zoom:auth -- --timeout 10      # SDK 側の待ち時間を変える
npm run zoom:auth -- --offline         # ネットワークを切って時間切れを確かめる（Zoom へ要求は届かない）
```

イメージ名などは環境変数で変えられる: `WACHA_ZOOM_IMAGE`（既定 `wacha-meter-zoom-dev:local`）、`WACHA_ZOOM_CONTAINER_PREFIX`（既定 `wacha-meter-zoom-auth`）、`WACHA_ZOOM_SDK_DIR`、`WACHA_ZOOM_PROBE_BUILD_DIR`。

### 認証情報の設定（ユーザーが行う）

1. Zoom App Marketplace の General App「わちゃメーター（開発用）」で、Meeting SDK の開発用 Client ID と Client Secret を確認する
2. リポジトリ直下に `.local/zoom-credentials.env` を作り、次の2行を書く（`.local/` は .gitignore 済み。チャット・Issue・PR には貼らない）

   ```
   ZOOM_SDK_CLIENT_ID=<Client ID>
   ZOOM_SDK_CLIENT_SECRET=<Client Secret>
   ```

3. `chmod 600 .local/zoom-credentials.env` で自分だけが読めるようにする
4. `npm run zoom:auth` を1回実行し、終了コードと表示（成功／`AUTHRET_*` の失敗）を確かめる。自動の再試行はしないので、失敗したら設定を見直してから実行する

未設定・空・空白や改行を含む値は、検証プログラムを起動せずに終了コード 2 で知らせる（値は表示しない）。

### 確認結果（7.2.1.5860、2026-11-08、Issue #1）

環境: macOS（Apple Silicon）、OrbStack の linux/arm64、Ubuntu 24.04 イメージ（システムの GLib 2.80）、Node.js 24.14.0、Meeting SDK 7.2.1.5860（Linux-all の arm64）。対象コミットは `b015f2b`（以降のコミットはコメント・文書だけの変更）、調査用の変更なし。

| 確認 | 結果 |
|---|---|
| 準備スクリプトでの展開 | SHA-256 一致、`arm64/` の中身だけを展開、`libmeetingsdk.so` は 64 ビット ELF / AArch64 |
| 実 SDK へのリンク | 成功（`libmeetingsdk.so` とシステムの GLib にリンク） |
| `zoom:init` | InitSDK・CleanUPSDK とも SDKERR_SUCCESS、終了コード 0 |
| ダミーの ID/Secret（乱数）で `zoom:auth`（Zoom への送信 1 回） | `AUTHRET_JWTTOKENWRONG`、終了コード 3、約 2 秒で終了 |
| **本物の認証情報で `zoom:auth`（Zoom への送信 1 回）** | **成功**（「SDK の認証に成功しました（会議には参加していません）」）、終了コード 0、約 1 秒で終了 |
| 実行後のコンテナ | すべての実行で残っていない |

会議への参加・音声の取得・録音はしていない。

### 確認結果（7.1.5.4434、2026-11-07〜08、Issue #1）

環境: macOS（Apple Silicon）、OrbStack の linux/arm64、Ubuntu 24.04 イメージ、Node.js 24.14.0、Meeting SDK 7.1.5.4434。

| 確認 | 結果 |
|---|---|
| 実 SDK へのリンク | 成功（`libmeetingsdk.so` とシステムの GLib にリンク） |
| `npm run zoom:init` | InitSDK・CleanUPSDK とも SDKERR_SUCCESS、終了コード 0 |
| 認証情報なしで `zoom:auth` | 終了コード 2。検証プログラムは起動しない |
| ダミーの ID/Secret（乱数）で `zoom:auth` | `AUTHRET_JWTTOKENWRONG`、終了コード 3（Zoom への認証要求） |
| `--offline --timeout 5` | SDK から結果が返らず、検証プログラムの待ち時間切れ（コードなし）、終了コード 4、約 8 秒で終了 |
| 応答しない検証プログラム（偽物）で `--timeout 1` | ホスト側の時間切れで docker kill、終了コード 4、約 17 秒で終了 |
| 実行後のコンテナ | すべての実行で残っていない |
| 中断（PR #2 のレビュー対応、`auth --offline --timeout 600` の実行中） | プロセスグループへの SIGINT・Node だけへの SIGINT で終了コード 130、Node だけへの SIGTERM で 143。いずれも約 0.2 秒で終了し、コンテナは残っていない |
| 実行権限のない検証プログラム（`init`） | 「Docker がコンテナを起動できませんでした（終了コード 126）」と tini の `exec ... failed: Permission denied` の行を表示、終了コード 1 |
| 実認証 | 成功しなかった。本物の認証情報では、SDKAuth は SDKERR_SUCCESS を返すが、120 秒待っても `onAuthenticationReturn` が呼ばれない（2026-11-08。SDK からの `AUTHRET_OVERTIME` ではない）。Zoom（zoom.us）への HTTPS のやり取りは完了しており、DNS・TLS・時刻・書き込み先に問題は見つかっていない。上記のフォーラムの報告を受けて 7.2.1.5860 に替えた |

SDK の初期化・認証の成功は、ボット用途の採用や外部会議への参加の承認を意味しない（[初期調査](../../docs/research/feasibility.md)）。

## Zoom アカウント連携（OAuth）の確認（Issue #4）

本人の Zoom アカウントで、この試作（General App の開発用設定）を許可し、OAuth トークンを取得できるかだけを確かめる。会議への参加・OBF トークンの取得・音声取得は行わない。Docker・SDK は使わず、Mac 上の Node.js だけで動く（ブラウザと戻り先の待受が Mac 側にあるため）。SDK の初期化・認証（上の節）とは別の設定・別のコマンドで、互いの設定を読まない。

### 仕組み

| 項目 | 内容 |
|---|---|
| 方式 | Public Client OAuth（Client Secret なし）+ PKCE（S256）+ `state`。公式資料: [OAuth（PKCE・loopback）](https://developers.zoom.us/docs/integrations/oauth/)（2026-11-09 確認） |
| 戻り先 | `http://127.0.0.1:<一時ポート>/callback`。`127.0.0.1` だけで待ち受ける。Zoom は loopback の戻り先のポートを照合しないため、登録済みの `http://127.0.0.1/callback` と一致する |
| 待機 | 既定 180 秒（`--timeout` で 30〜600 秒）。Ctrl+C で中断できる。応答・時間切れ・中断・失敗のどれでも、待受を閉じてから終わる |
| トークン | `https://zoom.us/oauth/token` に認可コードと `code_verifier` を送る。成功の判定は HTTP 200 で、`access_token` があり、`token_type` が bearer、`expires_in` が正の数のとき。表示するのは種類・有効期間・スコープだけ。トークンはプロセスのメモリだけで扱い、保存・自動更新はしない。`refresh_token` は使わずに捨てる |
| 表示しないもの | Public Client ID、認可 URL（Client ID を含む）、認可コード、`state`、`code_verifier`、トークン。ブラウザに返す画面も固定の文言だけ |

終了コード: 0 成功 / 1 不正な応答（`state` の不一致・欠落、認可コードなし、想定外のトークン応答）・トークン取得失敗・ブラウザを開けない / 2 設定・引数の誤り（ブラウザは開かない）/ 3 認可の拒否 / 4 時間切れ / 130・143 中断（Ctrl+C・SIGTERM）。

### Public Client ID の設定（ユーザーが行う）

SDK 用の `ZOOM_SDK_CLIENT_ID` / `ZOOM_SDK_CLIENT_SECRET`（`.local/zoom-credentials.env`）とは別のファイル・別の変数名にする。既存の `.local/zoom-credentials.env` は編集しない。Zoom の画面で同じ値に見えても、別々に書く。

1. Zoom App Marketplace の General App「わちゃメーター（開発用）」で、Basic Information → App Credentials を開き、「Use Public Client OAuth」が ON であること、Redirect URL for OAuth と OAuth Allow List が `http://127.0.0.1/callback`、スコープに `user:read:token` があることを確かめる
2. 同じ欄の Public Client ID をコピーする（Client Secret は使わないので、どこにも書かない）
3. エディタで、リポジトリ直下に `.local/zoom-oauth.env` を作り、次の1行を書く（`.local/` は .gitignore 済み。シェルの履歴・チャット・Issue・PR には貼らない）

   ```
   ZOOM_OAUTH_CLIENT_ID=<Public Client ID>
   ```

4. `chmod 600 .local/zoom-oauth.env` で自分だけが読めるようにする

未設定・空・空白や改行を含む値は、ブラウザを開かずに終了コード 2 で知らせる（値は表示しない）。

### 本物の認可の確かめ方（ユーザーが行う）

1. `npm run zoom:oauth` を実行する（2段階認証などで時間がかかるなら `npm run zoom:oauth -- --timeout 300`）
2. 開いたブラウザで Zoom にログインし、アプリの許可画面で許可する
3. ブラウザに「応答を受け取りました」と出たら画面を閉じ、ターミナルの最後の1行と終了コード（`echo $?`）を確かめる
4. 開発チーム・PO には、最後の1行と終了コードだけを伝える（ブラウザのアドレス欄・画面の値は貼らない）

- 成功の確認は最大3回まで。3回とも失敗したら、それ以上は試さずに表示と終了コードを伝えて相談する
- 許可画面に拒否の選択肢があれば、任意で1回拒否し、終了コード 3 になることも確かめられる
- 中断は Ctrl+C（終了コード 130。待受を閉じて終わる）
- 本物の認可でトークン API が `invalid_client` を返した場合、まず Client ID の送り方を疑う。公式資料には「Public Client ID を Base64 で送る」との記述がある一方、例は平文の `client_id` を使っており、この試作は平文で送っている

### 自動テストとの分担

`tests/zoom-oauth/` は、Zoom の認可画面（ブラウザ操作）とトークン API だけを偽物にし、一時サーバー・HTTP・PKCE の計算は実物で確かめる（CI でも動く）。本物の Zoom でのログイン・許可・トークン取得は、上の手順で人間が確かめ、自動テストとは別に記録する。

## SDK 入手手順（今回の取得は完了）

SDK の入手にはログインと開発用アプリ1件の登録が必要。こちらのブラウザ接続は利用できないため、この操作はユーザーが行う。

1. [Zoom App Marketplace](https://marketplace.zoom.us/) にログインする。無料アカウントから始める。
2. Developers / Build App から General App を作成する。作成する名前は「わちゃメーター（開発用）」。
3. Features → Embed で Meeting SDK を有効にする。
4. Linux の Meeting SDK をダウンロードする。7.2.1.5860 では arm64 と x86_64 をまとめた「Linux-all」バンドルを選ぶ（中の `arm64/` だけを使う）。Video SDK は選ばない。
5. ダウンロードしたファイルはそのまま Downloads に置き、ファイル名をエージェントへ伝える。ARM64 が見つからなければ、表示された選択肢を伝える。

まだ Client Secret をチャットに貼る必要はない。認証情報は、接続プログラムの構成を決めてから Git 管理外のローカルファイルに設定する。契約や規約への同意が表示された場合はユーザー本人が内容を確認する。

画面の表記はアカウント権限などで異なる場合がある。課金への誘導や登録制限が出たら、その時点の表示に基づいて次の手順を決める。

## SDK 取得後に確かめる順番

1. ARM64 ライブラリか、必要なヘッダー・共有ライブラリがあるかを調べる。
2. ローカルで SDK の初期化・認証まで進める。認証情報やトークンはログへ出さない。
3. 外部会議用の認証・ベータテスト条件を整える。開発用の認証情報を作っただけで外部会議へ入れるとは扱わない。
4. 主催者が協力するテスト会議に独立した参加者として入り、待機室と入室成功を区別する。
5. 主催者の録音許可後に音声データの受信を確認する。初回は採点・文字起こしを行わない。
6. 退出し、会議接続が残らないことを確認する。

SDK の用途に関する公式資料の不整合は [初期調査](../../docs/research/feasibility.md) のとおり未解決。個別問い合わせを準備の開始条件にはしないが、SDK 入手やビルド成功を外部会議向け利用の承認と混同しない。

## 参照

- [公式 SDK 入手手順](https://developers.zoom.us/docs/meeting-sdk/linux/get-started/download/)
- [アプリ作成と SDK 有効化](https://developers.zoom.us/docs/meeting-sdk/get-credentials/)
- [公式 raw recording サンプル](https://github.com/zoom/meetingsdk-linux-raw-recording-sample)
- [外部会議のベータテスト手順](https://godevelopers.zoom.us/docs/distribute/sharing-private-and-beta-apps/)

公式サンプルの実装は参考用。現行 SDK との互換性や外部会議への参加を保証するものではない。
