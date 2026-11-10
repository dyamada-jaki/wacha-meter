# 0003. Zoom アカウント連携（OAuth）は Docker の外の Mac の Node.js で動かし、設定は部品ごとの `.local/*.env` に分ける

- 状態: 採用
- 日時: 2026-11-10 19:38 JST
- 関連: Issue #4 / 採用 PR #5 / [Issue レポート](../issue-reports/issue-4.md)

## 背景
Issue #4 で、本人の Zoom アカウントを Public Client OAuth（PKCE S256・state・`127.0.0.1` の loopback）で試作に連携するコマンド（`npm run zoom:oauth`）を作った。Issue #1 では SDK を Docker 上の C++ で動かすと決めている（[0001](0001-zoom-sdk試作はDocker上のC++とTypeScriptに分ける.md)）。SDK を呼ばない部品をどこで動かすか、SDK の認証情報と OAuth の設定をどう分けるかを決める必要があった。

## 決定
- SDK を呼ばない部品（OAuth の認可・トークン取得）は、Docker を使わず Mac の Node.js で動かす（`src/zoom-oauth/`）。ブラウザの起動と戻り先の待受は Mac 側で行う
- 設定は部品ごとに Git 管理外の `.local/*.env` に分け、各コマンドは自分のファイルだけを読む（SDK は `.local/zoom-credentials.env`、OAuth は `.local/zoom-oauth.env`。`node --env-file-if-exists`）
- 次の Issue の計画で守ること: 新しい部品でも、SDK を呼ぶものだけを Docker に置く。Mac 側で得た値（トークンなど）を Docker の SDK へ渡すときは、[0001](0001-zoom-sdk試作はDocker上のC++とTypeScriptに分ける.md) と同じく引数・環境変数・ログに載せない渡し方を計画に書く

## 理由
- 二重実装（PR #5 / PR #6）の両計画が、同じ選び方をした
- ブラウザと `127.0.0.1` の待受が Mac 側にあるため、Docker の中で動かすとポートの転送やブラウザの起動が必要になり、loopback の約束（`127.0.0.1` だけで待ち受ける）を保ちにくい
- 部品ごとに設定を分けると、SDK の Client Secret と OAuth の Public Client ID を取り違えたり、要らない秘密を別の部品へ渡したりしにくい

## 選ばなかった案
- OAuth も Docker の中で動かす: 上のとおり、ブラウザと loopback の扱いが重くなるため
- 設定を1つの `.local/*.env` にまとめる: 各コマンドが要らない秘密まで読み込むため

## 影響
- OAuth の手元確認は Docker なしで動き、テストも Node.js だけで書ける
- 会議ボットで OAuth のトークンを SDK に渡すときは、Mac と Docker のあいだの受け渡しを新しく設計する必要がある
- 見直すきっかけ: 会議ボットを Mac 以外（別のマシンやクラウド）で動かすことになったとき、または OAuth の確認を CI で行う必要が出たとき
