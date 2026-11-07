# 取り出し元

このテンプレートは、別のプロジェクトで実際に回しているプロセスから取り出したもの。プロセスの改善は取り出し元で先に起き、ここへ移す。

| 項目 | 値 |
|---|---|
| 取り出し元 | `dyamada-jaki/overstrata-board` |
| コミット | `7f4d10158b38d9eb1b26e88d18782ba57fb4e1c7`（2026-10-27） |
| 対象 | `.claude/skills/`・`.agents/skills/`・`docs/workflow.md`・`docs/testing.md`・`docs/decisions/`（README と雛形）・`docs/issue-reports/README.md`・`CLAUDE.md`・README のプロセスの図 |

## 次に取り出すとき
1. 取り出し元で `git log <上のコミット>..main -- .claude/skills docs/workflow.md docs/testing.md docs/decisions/README.md docs/decisions/0000-template.md docs/issue-reports/README.md CLAUDE.md` を見る
2. プロセスの変更だけを選んで、ここへ移す。経緯の注記（「#番号 で…ため」）は、規則を残して理由を一般的な言葉に置き換える
3. 作るもの固有の値は、CLAUDE.md の「開発設定」と profiles に寄せる
4. 上の表のコミットを更新する

## テンプレートだけにあるもの
次のものは取り出し元に無く、テンプレートで足した。取り出し元から移すときに、差があっても消したり上書きしたりしない。
- `.claude/skills/setup-project/`（準備スキル）と `.agents/skills/setup-project`（そのリンク）
- `dev-team.sh doctor`（準備の点検）と、`dev-team.test.sh` の doctor のテスト
- CLAUDE.md・AGENTS.md の「準備がまだなら、まず準備する。」の案内
- README の「始め方」、`docs/workflow.md` の「最初に1回だけやる準備」の準備スキルを使う書き方と、起動係の名前に付けるリポジトリ名
