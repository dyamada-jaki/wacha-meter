# 初期準備の確認記録

2026-11-07。ユーザーが準備内容の main 反映と Issue #1 の開発チームへの引き渡しを承認。反映結果は docs/next-issues.md に記録する。

## 変更内容

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

## 検証結果

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

最初の機能 Issue で CI と開発設定の `test:setup` を通常の `npm run test` に切り替える。通常のコマンドはテスト0件を成功にしない。

## 開発プロセス

`dev-team.sh doctor`: ○12項目、×1項目、△なし。残る×は起動係が無効であることのみ。

GitHub の「開発可」「着手中」ラベルを作成し、squash を有効にした。この端末を PO 登録した。

Orca に `開発チーム起動（wacha-meter）` を無効で作成した。ID は `6ede30fc-0db9-4b31-bab1-18decf0b0005`。15分ごとに着手可能な Issue の有無を調べる設定で、現在は起動しない。他プロジェクトの定期実行は変更していない。

## 残件

- 準備ファイルは f0544d7 で main にコミット・push 済み。Issue #1 の開発チームを手動起動し、指示の受信とターン開始を確認した。
- 今回は開発チームを手動起動する。定期実行の有効化は今回の承認対象に含めず、無効のままにする。
- Linux ARM64 SDK 7.1.5.4434 はユーザーが取得済み。バイナリ形式とヘッダーの存在を確認した。SDK の初期化・認証は Issue #1 で開発チームが検証する。実認証にはローカルでの認証情報設定が必要。チャット共有や課金契約は要求していない。
- `npm audit` は開発用の依存関係に moderate 10件を報告。根は minimatch の globparts amplification（GHSA-g3hv-75wg-m249）。通常の `npm audit fix` では解消せず、強制修正は ESLint などの互換性を変えるため適用していない。実行時依存は0件だが、Lint ツール側の既知の問題として保持し、修正版への更新を追跡する。
