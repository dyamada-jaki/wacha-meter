# Zoom 接続試作の準備

目的は、今の Mac 上で「わちゃメーター」が独立した参加者として入室し、主催者の許可を受けて音声を取得すること。現在はビルド環境と SDK を用意した段階。会議参加プログラムは未実装。

## SDK の受領と引き継ぎ

2026-11-07: ユーザーが `zoom-meeting-sdk-linux_arm64-7.1.5.4434.tar.xz` を取得。Downloads に保存されている。アーカイブ内の `libmeetingsdk.so` が 64 ビット ELF / AArch64（e_machine=183）で、初期化・認証・音声関連のヘッダーを含むことを確認した。SDK のリンク・初期化・認証はまだ行っていない。

SHA-256: `384d2e522b0d3e2650bb5e6f5201e1e5e5d88151a5f8808a2b8832c97c4fcb19`（受領したファイルを識別するための値。提供元の署名検証ではない）。SDK 本体は Git 管理外に置く。

開発チームの最初の作業は [Issue #1](https://github.com/dyamada-jaki/wacha-meter/issues/1)。準備の main 反映後に着手条件を確認する。PO が担当したのは環境準備とファイル確認までで、初期化・認証プログラムは開発チームが実装する。

## 用意した環境

Apple Silicon に合わせて、既存の OrbStack / Docker 上の ARM64 Linux を使う。Ubuntu 24.04 と C++ / CMake、および公式サンプルを参考にした音声・描画関連の依存を含む。SDK 本体や秘密情報はイメージに入れない。

```sh
docker build --platform linux/arm64 -t wacha-meter-zoom-dev:local prototypes/zoom
docker run --rm --platform linux/arm64 wacha-meter-zoom-dev:local uname -m
```

上の確認はビルド環境の確認であり、Zoom SDK のビルド・動作確認ではない。SDK 入手後、実際のライブラリ依存と API の版を確かめて接続プログラムを作る。Rosetta / x86_64 エミュレーションは使わない。

2026-11-07 の実機確認結果: Docker イメージのビルド成功、実行環境と C++ コンパイラーが aarch64、GLib / libcurl を使う小さな C++ プログラムのコンパイル・実行成功、PulseAudio の起動と仮想出力デバイスの作成成功。Mac のマイクや会議音声は取得していない。

## SDK 入手手順（今回の取得は完了）

SDK の入手にはログインと開発用アプリ1件の登録が必要。こちらのブラウザ接続は利用できないため、この操作はユーザーが行う。

1. [Zoom App Marketplace](https://marketplace.zoom.us/) にログインする。無料アカウントから始める。
2. Developers / Build App から General App を作成する。作成する名前は「わちゃメーター（開発用）」。
3. Features → Embed で Meeting SDK を有効にする。
4. Linux の **ARM64（aarch64）** 向け Meeting SDK をダウンロードする。x86_64 版や Video SDK は選ばない。
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
