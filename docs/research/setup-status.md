# 初期準備の確認記録

2026-11-07。ユーザーが準備内容の main 反映と Issue #1 の開発チームへの引き渡しを承認。反映結果は docs/next-issues.md に記録する。

## 現在地（2026-11-09 更新）

Issue #1 は完了し、PR #2 を main（`0dd6388`）へ取り込み済み。SDK は **7.2.1.5860（Linux-all の arm64）** を使う。本物の認証情報での認証成功・終了コード0・コンテナの後始末を確認した（2026-11-08 16:02:50 JST、`b015f2b`、許可を受けたワーカーが実行）。会議への参加・音声取得は未実施。

通常の `npm run test` は111件成功、型チェック・Lint・ビルドも成功。main `3ffb2c3` の [CI](https://github.com/dyamada-jaki/wacha-meter/actions/runs/42492740354) が成功している。試作の構成と SDK の選択は [ADR 0001](../decisions/0001-zoom-sdk試作はDocker上のC++とTypeScriptに分ける.md)・[ADR 0002](../decisions/0002-zoom-sdkは7.2.1.5860のarm64を使う.md) に記録済み。検証・後片付けの正本は [Issue #1 レポート](../issue-reports/issue-1.md)。

以下の初期準備の内容・検証表は 2026-11-07 時点の記録として残す。

## 初期準備の変更内容

- CLAUDE.md / AGENTS.md: わちゃメーターの構想、Node.js / TypeScript の共通基盤、未決の接続方式、機密情報の扱いを記載。同一内容を確認済み。
- docs/spec.md: ユーザーの構想と未決事項。
- docs/research/feasibility.md: 公式資料を根拠に会議ボット API・Meeting SDK・RTMS を比較。
- docs/testing.md: 会議観測・集計・実会議での確認に合わせて更新。
- docs/next-issues.md: 現在地と、前提未決の Issue 候補。
- README.md: プロジェクト概要と開発コマンド。
- package.json / package-lock.json / .nvmrc / tsconfig*.json / eslint.config.js / src/index.ts: 型チェック・テスト・Lint・ビルドの共通基盤。src/index.ts は空のモジュールで、機能は未実装。
- .github/workflows/ci.yml: 同じ検証コマンドを Ubuntu で実行する定義。GitHub 上の実行は push 後。
- .gitignore: ローカルの環境変数ファイル・会議録音・非公開データの置き場を除外。

## 開発依存の追加理由

| パッケージ | 目的 |
|---|---|
| typescript | strict の型チェックと JavaScript へのビルド |
| @types/node | Node.js の型定義 |
| vitest | 仕様決定後のテスト先行開発 |
| eslint / @eslint/js / typescript-eslint | JavaScript / TypeScript の Lint |

実行時依存はない。

## 初期準備の検証結果

| 確認 | 結果 |
|---|---|
| npm run test:setup | 成功。ただしテスト0件。アプリの動作検証ではない |
| npm run typecheck | 成功 |
| npm run lint | 成功 |
| npm run build | 成功 |
| git diff --check | 成功 |
| CLAUDE.md / AGENTS.md 同期 | 成功 |
| ARM64 Linux の試作用 Docker イメージ | ビルド・起動成功。Ubuntu 24.04、aarch64 |
| C++ / GLib / libcurl | 小さな確認用プログラムのコンパイル・実行成功 |
| PulseAudio | 起動と仮想出力デバイス作成成功。マイク・会議音声は未取得 |
| GitHub CI | 初期準備 f0544d7 の [run 42380342483](https://github.com/dyamada-jaki/wacha-meter/actions/runs/42380342483) が成功 |
| Zoom / Recall.ai / RTMS 接続 | 未実施 |
| スコアの妥当性 | 未検証 |

Issue #1 で CI と開発設定の `test:setup` を通常の `npm run test` に切替済み。通常のコマンドはテスト0件を成功にしない。

## 開発プロセス

`dev-team.sh doctor`: ○12項目、×1項目、△なし。残る×は起動係が無効であることのみ。

GitHub の「開発可」「着手中」ラベルを作成し、squash を有効にした。この端末を PO 登録した。

Orca に `開発チーム起動（wacha-meter）` を無効で作成した。ID は `6ede30fc-0db9-4b31-bab1-18decf0b0005`。15分ごとに着手可能な Issue の有無を調べる設定で、現在は起動しない。他プロジェクトの定期実行は変更していない。

## 引き継ぎと残件（2026-11-09 更新）

- 初期準備と Issue #1 の実装・完了レポートは main へ反映済み。開発チームの後片付けも完了。
- 起動係の定期実行は無効のまま。有効化は未承認。
- SDK 7.1.5.4434 は実認証のコールバックが返らず、7.2.1.5860 に切り替えて検証済み。今後は 7.2.1.5860 の arm64 を使う。SDK・認証情報・ビルド結果は main の `.local/` に保持（Git 管理外）。
- 次は外部会議の参加条件と主催者・参加者の協力を確認し、入室・許可を受けた音声取得・退出の検証を具体化する。候補と未決事項は [現在地と次に切る Issue](../next-issues.md)。
- 初期準備時の `npm audit` は開発依存に moderate 10件を報告した。根は minimatch の globparts amplification（GHSA-g3hv-75wg-m249）。当時の通常更新では解消せず、互換性を変える強制修正は適用していない。この文書更新では再監査していない。
