# <プロジェクト名> — エージェント向けガイド

<何を作るかを1〜2行で書く。>
**仕様はすべて [docs/spec.md](docs/spec.md) にある。作業の前に必ず読むこと。**

> このファイルと `AGENTS.md`（Codex 用）は同じ内容に保つ。直したら両方をそろえる。

> **準備がまだなら、まず準備する。** このファイルに `<…>` が残っているあいだは、準備が済んでいない。最初の依頼が何であっても（「セットアップして」「〇〇を作りたい」など）、ほかの作業より先に [`.claude/skills/setup-project/SKILL.md`](.claude/skills/setup-project/SKILL.md) の手順で進める。制作の環境だけを整えて終えず、最後に `bash .claude/skills/dual-implement/scripts/dev-team.sh doctor` を通す。

## 作るもの（既定: Web アプリ）
このテンプレートの既定は **Web アプリ（Node・Vite・React・TypeScript・Vitest）**。
別の種類（スライド・文書など）にするときは、この節と下の「開発設定」の表、`docs/testing.md` を書き換える。やり方は [profiles/README.md](profiles/README.md)。
スキルは「開発設定」の表から値を読み、表に無い項目や「なし」の項目の手順を飛ばす。

- 技術スタック: Vite + React + TypeScript（strict）。テストは Vitest（+ React Testing Library）
- 実行環境: <例: 開発も本番も Docker コンテナで動かす>

## コマンド
- `npm run dev` — 開発サーバー
- `npm run test` — テスト
- `npm run typecheck` — 型チェック
- `npm run lint` — Lint
- `npm run build` — ビルド

## ディレクトリ構成
```
src/           <作るものに合わせて書く>
docs/
  spec.md      仕様（正）
  workflow.md  開発の進め方
  testing.md   テスト（確かめ方）とレビューの方針
  next-issues.md  現在地と次に切る Issue（PO だけが書く）
  decisions/   技術判断の記録（ADR）
  issue-reports/  Issue ごとの記録
```

## 開発設定（スキルが参照する値）
`.claude/skills/` のスキルは、プロジェクト固有の値をここから読む。値を変えるときはここだけを直す。使わない項目は「なし」と書く。

| 項目 | 値 |
|---|---|
| リポジトリ | `<owner>/<repo>`（既定ブランチ `main`） |
| 確認コマンド | `npm run test` / `npm run typecheck` / `npm run lint` / `npm run build` |
| テスト先行 | する（機能追加・振る舞いの変更では、テストを先に書いて失敗を確かめてから作る。→ testing.md 1章） |
| E2E | なし（導入したらコマンドを書く） |
| ミューテーション | なし（導入したらコマンドと対象を書く） |
| 開発サーバー | `npm run dev`（Docker を使うなら `docker compose up -d`。worktree ごとに `.env` の `HOST_PORT` と `COMPOSE_PROJECT_NAME` で分ける） |
| ポート | main: `5173` / 実装（Claude Code）: `5181` / 実装（Codex）: `5182` / 品質レビュー: `5183`・`5184` |
| 画面確認の幅 | スマホ縦 `375px`（Orca のブラウザで端末を指定）と PC 幅 |
| マージ方式 | squash（`finish-issue/scripts/finish.sh` で固定） |
| 仕様・方針 | `docs/spec.md` / `docs/testing.md` / `docs/workflow.md` |
| 技術判断 | `docs/decisions/`（ADR。計画の前に関係するものを読む。書くのは finish-issue で人間が採用したときだけ） |
| 記録 | `docs/next-issues.md`（現在地。PO だけが書く）/ `docs/issue-reports/`（Issue レポート。開発チームから PO への申し送りもここに書く） |
| 席 | PO（Claude Code か Codex。開いたら `dev-team.sh po-register` で登録）/ 開発チーム（Issue ごとに開いて閉じる。`dev-team.sh claim` で登録）/ 開発者（dual-implement のワーカー）。役割は workflow.md「3つの席」 |
| 着手のラベル | `開発可`（着手してよい。付けるのは PO か人間だけ）/ `着手中`（開発チームが動いている。同時に1つまで） |
| 起動係 | Orca の定期実行 `開発チーム起動`。`.claude/skills/dual-implement/scripts/dev-team.sh` で確認と起動を行う |
| PO の差し戻し | 2回まで。3回目は人間に判断を仰ぐ |

## 守ること
1. <設計の決まりを書く。例: 計算は `src/domain/` の純粋関数に書き、画面の部品の中に書かない>
2. **機能追加・振る舞いの変更では、テストを先に書いてから作る**（「開発設定」のテスト先行が「する」のとき）。計画・実装・レビューでは [docs/testing.md](docs/testing.md) に従う（期待結果を仕様から決める、対象の振る舞いによる失敗を確かめてから作る、振る舞いを変えない整理は変更前後の成功を確かめる、モックは必要な境界だけ）
3. 画面があるなら、「開発設定」の画面確認の幅を基準に作る
4. 画面の文言・文書は <日本語>
5. 依存パッケージを増やすときは、PR 本文に理由を書く
6. **1つの PR は1つの Issue だけを扱う**。PR 本文に `Closes #番号` を書く
7. Issue の「スコープ外」に書かれたことはやらない。必要だと思ったら PR 本文で提案する
8. spec.md や Issue に書かれていないルールを推測で作らない。不明点は計画の段階で質問するか、PR 本文に「確認したいこと」として書く。採用の ADR（`docs/decisions/`）と違う作り方をするときも、計画の段階でそう書いて理由を示す
9. 公開してはいけない情報（認証情報、環境変数の秘密の値、<プロジェクト固有の非公開の資料>）を、コード・Issue・PR・ドキュメントに書かない

## Issue の実装手順
`.claude/skills/implement-issue/SKILL.md`（Codex 用の `.agents/skills/implement-issue` は、このフォルダへのシンボリックリンク）に従う。Claude Code では `/implement-issue 番号`、Codex では「implement-issue スキルで Issue 番号」。

## 完了の定義
- Issue の受け入れ条件をすべて満たす
- 「開発設定」の確認コマンドがすべて通る。E2E・ミューテーションは、導入済みで対象となる場合に通す
- PR 本文に「何をしたか」「どう確認したか」「確認したいこと」を書く

## 用語
| 日本語 | コード上の名前 |
|---|---|
| <用語> | <名前> |
