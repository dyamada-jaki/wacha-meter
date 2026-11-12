# わちゃメーター — エージェント向けガイド

オンライン会議に参加して「わちゃわちゃ」を観測し、終了時にスコアを参加者へ知らせるアプリ。
現在は実現方法の調査・開発環境の準備段階。接続方式とスコア定義は未決。
仕様の正本は [docs/spec.md](docs/spec.md)。作業に関係する箇所を読んでから始める。

> このファイルと `AGENTS.md`（Codex 用）は同じ内容に保つ。直したら両方をそろえる。

> **準備がまだなら、まず準備する。** このファイルの、コードの書式（`…`）の外に `<…>` が残っているあいだは、準備が済んでいない（`dev-team.sh doctor` と同じ判定。開発サーバーのコマンドの `<ポート>` のような、コードの書式の中の `<…>` は埋めなくてよい）。最初の依頼が何であっても（「セットアップして」「〇〇を作りたい」など）、ほかの作業より先に [`.claude/skills/setup-project/SKILL.md`](.claude/skills/setup-project/SKILL.md) の手順で進める。制作の環境だけを整えて終えず、最後に `bash .claude/skills/dual-implement/scripts/dev-team.sh doctor` を通す。

## 作るもの
オンライン会議の観測・採点アプリ。無料を基本とし、Zoom の有料アカウントは候補に含めてよい。その他の追加課金を前提にしない。他者主催の会議も対象とする。SDK の用途・審査条件が未確認なので方式は採用保留。手元の PC で動く会議ボットとローカル解析を、[初期調査](docs/research/feasibility.md) に基づいて検討する。

- 準備済みの共通基盤: Node.js 24 + TypeScript（strict）+ Vitest + ESLint
- 実行環境: 共通コードはローカルの Node.js。CI は Ubuntu + Node.js。接続試作は今の Mac の OrbStack / Docker 上の ARM64 Ubuntu 24.04。SDK 本体は Git 管理外の `.local/` に展開して使う（prototypes/zoom/README.md）
- React・Vite・課金 API はまだ導入していない。会議 SDK は試作（prototypes/zoom）でのみ使い、src/ のアプリには組み込んでいない。C++ / Docker のビルド準備は prototypes/zoom/Dockerfile に置く。Linux ARM64 SDK 7.2.1.5860（Linux-all バンドルの arm64）の初期化・認証の検証プログラムは prototypes/zoom/auth-probe（Issue #1）

## コマンド
- `npm ci` — 開発依存をインストール
- `npm run test` — テスト（Vitest）。テスト0件では失敗する
- `npm run typecheck` — 型チェック
- `npm run lint` — Lint
- `npm run build` — TypeScript のビルド
- `npm run zoom:init` / `npm run zoom:auth` — Zoom SDK の初期化・認証の手元確認（Docker と Git 管理外の SDK が必要。CI では実行しない。prototypes/zoom/README.md）
- `npm run zoom:oauth` — Zoom アカウント連携（OAuth・PKCE）の手元確認。ブラウザで本人がログイン・許可する（Git 管理外の `.local/zoom-oauth.env` が必要。CI では実行しない。prototypes/zoom/README.md）
- `npm run zoom:obf` — OAuth に続けて本人の OBF トークン取得の手元確認（会議番号なし・会議には参加しない）。設定は `zoom:oauth` と同じ `.local/zoom-oauth.env`。CI では実行しない。prototypes/zoom/README.md

## ディレクトリ構成
```
src/           TypeScript のコード（zoom-auth/: SDK 初期化・認証の検証コマンド、zoom-oauth/: アカウント連携の OAuth 確認コマンド、zoom-obf/: OAuth に続く OBF 取得の確認コマンド）
tests/         Vitest のテスト
prototypes/zoom/  Zoom 接続試作の環境・手順と C++ の検証プログラム（auth-probe/）
docs/
  spec.md      仕様（正）
  research/    調査結果と提案（採用決定とは区別）
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
| リポジトリ | `dyamada-jaki/wacha-meter`（既定ブランチ `main`） |
| 確認コマンド | `npm run test` / `npm run typecheck` / `npm run lint` / `npm run build` |
| テスト先行 | する（機能追加・振る舞いの変更では、テストを先に書いて失敗を確かめてから作る。→ testing.md 1章） |
| E2E | なし（導入したらコマンドを書く） |
| ミューテーション | なし（導入したらコマンドと対象を書く） |
| 開発サーバー | なし（接続方式の選定後に導入） |
| ポート | なし（サーバー導入時に worktree ごとの値を決める） |
| 画面確認の幅 | なし（画面導入時に決める） |
| マージ方式 | squash（`finish-issue/scripts/finish.sh` で固定） |
| 仕様・方針 | `docs/spec.md` / `docs/testing.md` / `docs/workflow.md` |
| 技術判断 | `docs/decisions/`（ADR。計画の前に関係するものを読む。書くのは finish-issue で人間が採用したときだけ） |
| 記録 | `docs/next-issues.md`（現在地。PO だけが書く）/ `docs/issue-reports/`（Issue レポート。開発チームから PO への申し送りもここに書く） |
| 席 | PO（Claude Code か Codex。開いたら `dev-team.sh po-register` で登録）/ 開発チーム（Issue ごとに開いて閉じる。`dev-team.sh claim` で登録）/ 開発者（dual-implement のワーカー）。役割は workflow.md「3つの席」 |
| 着手のラベル | `開発可`（着手してよい。付けるのは PO か人間だけ）/ `着手中`（開発チームが動いている。同時に1つまで） |
| 起動係 | Orca の定期実行 `開発チーム起動`。`.claude/skills/dual-implement/scripts/dev-team.sh` で確認と起動を行う |
| PO の差し戻し | 2回まで。3回目は人間に判断を仰ぐ |

## PO の席でのやり方
PO（人間と仕様を話し合い、Issue を書く席。→ [docs/workflow.md](docs/workflow.md)「3つの席」）として動くときは、次のとおりにする。
- PO が書くのは `docs/spec.md`・`docs/next-issues.md`・Issue とラベル・PR への受け入れコメント。作るもの（コード、スライドや文書の本文、試作の環境）は Issue にして、開発チームに作らせる
- 人間と話して1つの Issue にできるだけのことが決まったら、その場で Issue の案（目的・受け入れ条件・スコープ外）を見せ、登録して「開発可」を付けてよいかを聞く。中身のたたき台を会話で示すのは、人間が決めるのに必要な分だけにする
- 資料・規約・料金などの調べものは PO が行う。動かして確かめる調査（試作・環境づくり・計測など）は Issue にする
- 準備（setup-project）の手順にある制作の環境づくりは、準備の一部として PO の端末で行う

## 守ること
1. 接続方式・採点ルールは未決。調査の提案を確定仕様として実装しない。計算と会議サービスへの接続を分け、採用した仕様からテストを書く
2. **機能追加・振る舞いの変更では、テストを先に書いてから作る**（「開発設定」のテスト先行が「する」のとき）。計画・実装・レビューでは [docs/testing.md](docs/testing.md) に従う（期待結果を仕様から決める、対象の振る舞いによる失敗を確かめてから作る、振る舞いを変えない整理は変更前後の成功を確かめる、モックは必要な境界だけ）
3. 画面があるなら、「開発設定」の画面確認の幅を基準に作る
4. 画面の文言・文書は日本語
5. 依存パッケージを増やすときは、PR 本文に理由を書く
6. **1つの PR は1つの Issue だけを扱う**。PR 本文に `Closes #番号` を書く
7. Issue の「スコープ外」に書かれたことはやらない。必要だと思ったら PR 本文で提案する
8. spec.md や Issue に書かれていないルールを推測で作らない。不明点は計画の段階で質問するか、PR 本文に「確認したいこと」として書く。採用の ADR（`docs/decisions/`）と違う作り方をするときも、計画の段階でそう書いて理由を示す
9. 公開してはいけない情報（認証情報、環境変数の秘密の値、実会議の音声・映像・文字起こし・参加者情報・参加 URL やパスコード）を、コード・Issue・PR・ドキュメントに書かない

## Issue の実装手順
`.claude/skills/implement-issue/SKILL.md`（Codex 用の `.agents/skills/implement-issue` は、このフォルダへのシンボリックリンク）に従う。Claude Code では `/implement-issue 番号`、Codex では「implement-issue スキルで Issue 番号」。

## 完了の定義
開発者が「Issue の作業は終わった」と判断する基準は [docs/definition-of-done.md](docs/definition-of-done.md)。PR を作るときに1項目ずつ確かめる。

## 用語
| 日本語 | コード上の名前 |
|---|---|
| わちゃメーター | wacha-meter |
| わちゃわちゃ | 定義・コード名ともに未決 |
