# Zoom 接続試作の準備

目的は、今の Mac 上で「わちゃメーター」が独立した参加者として入室し、主催者の許可を受けて音声を取得すること。Issue #1 の試作は **SDK の初期化・認証・後始末だけ**。会議参加・音声取得・録音は実装していない。SDK の用途方針・外部会議の条件は採用保留のまま。

## SDK の受領と引き継ぎ

2026-11-07: ユーザーが `zoom-meeting-sdk-linux_arm64-7.1.5.4434.tar.xz` を取得。Downloads に保存されている。アーカイブ内の `libmeetingsdk.so` が 64 ビット ELF / AArch64（e_machine=183）で、初期化・認証・音声関連のヘッダーを含むことを確認した。SDK のリンク・初期化・認証はまだ行っていない。

SHA-256: `384d2e522b0d3e2650bb5e6f5201e1e5e5d88151a5f8808a2b8832c97c4fcb19`（受領したファイルを識別するための値。提供元の署名検証ではない）。SDK 本体は Git 管理外に置く。

開発チームの最初の作業は [Issue #1](https://github.com/dyamada-jaki/wacha-meter/issues/1)。実装者の確認結果は下記。実認証成功はユーザーがローカル設定した後に確認する。

## Issue #1 のビルドと実行

Mac の Node.js 24、Docker / OrbStack の linux/arm64 を使う。自動テストには Mac の Command Line Tools または Ubuntu の C++17 コンパイラ（`c++`）も必要。`c++ --version` が失敗する環境では準備してから実行する。テストはコンパイラ不在を失敗にし、黙って省略しない。CI も同じテストを実行し、SDK は配置しない。

リポジトリのルートから実行する。SDK は Git 管理外の `.local/` に展開する。SDK・認証情報を `prototypes/zoom/` に置かない。このディレクトリだけを Docker のビルドコンテキストにする。

```sh
mkdir -p .local/zoom-sdk-7.1.5.4434 .local/zoom-build
shasum -a 256 "$HOME/Downloads/zoom-meeting-sdk-linux_arm64-7.1.5.4434.tar.xz"
# 上記の SHA-256 と一致することを確かめてから展開する。
tar -xf "$HOME/Downloads/zoom-meeting-sdk-linux_arm64-7.1.5.4434.tar.xz" -C .local/zoom-sdk-7.1.5.4434
docker build --platform linux/arm64 -t wacha-meter-issue-1-codex:local prototypes/zoom
docker run --rm --name wacha-issue-1-codex-build --platform linux/arm64 \
  --mount "type=bind,source=$PWD/prototypes/zoom,target=/source,readonly" \
  --mount "type=bind,source=$PWD/.local/zoom-sdk-7.1.5.4434,target=/opt/zoom-sdk,readonly" \
  --mount "type=bind,source=$PWD/.local/zoom-build,target=/build" \
  wacha-meter-issue-1-codex:local \
  bash -c 'cmake -S /source -B /build -DSDK_ROOT=/opt/zoom-sdk && cmake --build /build -j2'
npm ci
npm run build
node dist/zoom/cli.js --init-only
```

`--init-only` はネットワークを無効にしたコンテナで実行し、認証要求を送らない。成功時は「SDK の初期化に成功しました。」「SDK の後始末に成功しました。」「初期化の確認を終了しました。」を表示し、0 で終了する。

### ユーザーが認証情報を設定した後の確認

1. 開発用 General App の Features → Embed で Meeting SDK を有効にし、開発用 Client ID / Client Secret を手元で確認する。[公式の資格情報手順](https://developers.zoom.us/docs/meeting-sdk/get-credentials/)を参照する。
2. 次のコマンドで空の設定を作り、手元のエディターで2つの値を入力して保存する。既存の設定がある場合は作り直さない。チャット・Issue・PR・スクリーンショットに値を貼らない。

```sh
# 初回のみ。既存ファイルを上書きしない。
(umask 077; set -C; printf '%s\n' '{"clientId":"","clientSecret":""}' > .local/zoom-credentials.json)
chmod 600 .local/zoom-credentials.json
```

3. 次を **1回** 実行する。引数に渡すのはファイルのパスだけ。別の場所に置く場合も Git 管理外にする。

```sh
node dist/zoom/cli.js --credentials .local/zoom-credentials.json
```

`--sdk <展開先>` で既定以外の SDK ディレクトリを指定できる。バイナリは `.local/zoom-build/zoom-probe` を使う。未設定・不存在・不正 JSON・空欄の場合はコンテナを起動せず「認証情報を設定してください。」と終了コード2を返す。構造上正しいが無効な値は SDK の認証失敗として非0になる。

JWT は [公式の認証仕様](https://developers.zoom.us/docs/meeting-sdk/auth/)に従い、Node 標準 crypto の HS256 でメモリー内に生成する。`appKey`、`iat`（現在時刻−30秒）、`exp` / `tokenExp`（現在時刻＋1800秒）だけを入れる。Client Secret と JWT は引数・Docker 環境変数・ファイルへ渡さず、JWT のみを標準入力へ送る。自動再試行はしない。回数制限らしい応答・終了コード9が出たら再実行せず、その状態だけを報告する。

### 終了状態と後始末

| 終了コード | 意味 |
|---|---|
| 0 | 認証成功、または明示した初期化のみの確認成功 |
| 2 | 認証情報の未設定・不正な設定 |
| 3 | SDK 初期化失敗 |
| 4 | SDK 認証 API の拒否、または認証失敗 callback |
| 5 | SDK の認証タイムアウト、30秒の認証待機期限、または45秒の全体監視期限 |
| 6 | SDK 後始末またはコンテナ削除の確認失敗 |
| 7 | SIGINT / SIGTERM による中断 |
| 8 | 実行環境・引数・SDK の応答形式を確認できない |
| 9 | 認証回数制限（SDK の TOO_FREQUENT_CALL / LIMIT_EXCEEDED_EXCEPTION） |

30秒の認証待機は C++ の単調時計で管理し、GLib イベントを処理する。認証 callback の外で DestroyAuthService / CleanUPSDK を呼び、後始末失敗を成功にしない。初期化や SDK API 自体が停止した場合は起動側の45秒監視で止める。中断・監視期限では SIGTERM を送り、2秒の猶予後に強制停止する。最後に自分の一意な名前のコンテナを削除し、この操作にも2秒の監視を設ける（通常の上限は45＋2＋2秒）。Docker 自体が応答しないなど削除を確認できない場合はコード6となり、手元で残存確認が必要。

SDK のログ・クラッシュダンプは無効、Docker のログ保存も無効。実行時は read-only root / SDK と `/tmp`・`/home/probe` の tmpfs を使い、SDK の書込みをホストへ保存しない。SDK の stdout / stderr を公開出力へ転送せず、固定ステータスだけを解釈する。SDK を直接実行して秘密を含む生ログを収集しない。実行コンテナの名前は `wacha-issue-1-codex-<UUID>`、イメージは `wacha-meter-issue-1-codex:local`。他ワーカーの資源は削除しない。

## Issue #1 の確認記録（Codex）

2026-11-07 JST、Mac ARM64 / macOS 27.0.1、OrbStack、Ubuntu 24.04 aarch64、GCC 13.3.0、GLib 2.80.0、Node.js 24.14.0、SDK 7.1.5.4434 で確認。

- 実 SDK の動的リンク成功。`ldd` に不足なし。ネットワーク無効の初期化・CleanUPSDK 成功、終了コード0。
- 認証情報を指定しない実行は固定エラーとコード2。
- 乱数のダミー ID / Secret による実 SDK 認証要求は **合計2回**（実装途中1回と最終コミット確認1回）。各起動の要求は1回で自動再試行なし。ともに認証失敗のコード4、SDK 初期化・後始末成功、起動したコンテナの残存なし。回数制限は観測していない。人間が許可したこのワーカーの上限は3回で、残りを使う必要はない。
- テスト先行コミット `c27117a` の状態で17件の失敗を確認。例: C++ 成功ケースの期待 `0 1 1 0 1` に対し未実装の `8 0 0 0 0`、設定エラーは期待する固定文言に対し「未実装」。依存を入れる前の `vitest: command not found` は Red の証拠に含めない。
- 自動テスト20件は設定/JWT、実 C++ 状態処理＋SDK 境界 fake、実起動プロセス＋Docker 境界 fixture。実 SDK の成功とは区別する。失敗 callback / API 拒否 / SDK timeout / callback 不達 / 回数制限 / 中断（初期化前・認証待機中）/ cleanup 失敗、秘密の非露出と監視期限を検証する。コンパイラ不在なら失敗する。`.local/` は SDK・CMake の生成物を置くため Lint 対象外とし、管理するソースだけを検査する。
- **未確認**: 有効な開発用資格情報による実認証成功、実 SDK での認証 timeout / 回数制限 / 認証待機中の中断。ユーザーがローカル設定した後に、人間がレビュー時に確認する。fake の成功で代用しない。
- E2E・ミューテーションは未導入、画面なしで画面確認は対象外。実会議への参加・音声取得・録音・用途採用の判断は行っていない。

## 用意した環境

Apple Silicon に合わせて、既存の OrbStack / Docker 上の ARM64 Linux を使う。Ubuntu 24.04 と C++ / CMake、および公式サンプルを参考にした音声・描画関連の依存を含む。SDK 本体や秘密情報はイメージに入れない。

```sh
docker build --platform linux/arm64 -t wacha-meter-issue-1-codex:local prototypes/zoom
docker run --rm --name wacha-issue-1-codex-env --platform linux/arm64 wacha-meter-issue-1-codex:local uname -m
```

上の uname はビルド環境だけの確認。実 SDK の結果は「Issue #1 の確認記録」で区別する。Rosetta / x86_64 エミュレーションは使わない。

2026-11-07 の実機確認結果: Docker イメージのビルド成功、実行環境と C++ コンパイラーが aarch64、GLib / libcurl を使う小さな C++ プログラムのコンパイル・実行成功、PulseAudio の起動と仮想出力デバイスの作成成功。Mac のマイクや会議音声は取得していない。

## SDK 入手手順（今回の取得は完了）

SDK の入手にはログインと開発用アプリ1件の登録が必要。こちらのブラウザ接続は利用できないため、この操作はユーザーが行う。

1. [Zoom App Marketplace](https://marketplace.zoom.us/) にログインする。無料アカウントから始める。
2. Developers / Build App から General App を作成する。作成する名前は「わちゃメーター（開発用）」。
3. Features → Embed で Meeting SDK を有効にする。
4. Linux の **ARM64（aarch64）** 向け Meeting SDK をダウンロードする。x86_64 版や Video SDK は選ばない。
5. ダウンロードしたファイルはそのまま Downloads に置き、ファイル名をエージェントへ伝える。ARM64 が見つからなければ、表示された選択肢を伝える。

Client Secret をチャットに貼らない。認証情報は上記の手順で Git 管理外のローカルファイルに設定する。契約や規約への同意が表示された場合はユーザー本人が内容を確認する。

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
