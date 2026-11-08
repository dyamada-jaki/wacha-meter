# 0001. Zoom SDK の試作は Docker 上の小さな C++ で動かし、設定・JWT・判定・プロセス管理は TypeScript でテストする

- 状態: 採用
- 日時: 2026-11-09 00:00 JST
- 関連: Issue #1 / 採用 PR #2 / [Issue レポート](../issue-reports/issue-1.md)

## 背景
Issue #1 で、Zoom Meeting SDK（Linux ARM64）を手元の Mac 上の ARM64 Linux で初期化・認証する試作を作った。SDK は C++ のライブラリで、Linux でしか動かない。認証情報と JWT を外に出さないこと、SDK 本体を Git とイメージに入れないことが求められた（CLAUDE.md「守ること」9）。区切り1（会議に入って音声を取る）の続きの Issue も、同じ形で SDK を動かす。

## 決定
- SDK を呼ぶ部分は、OrbStack / Docker 上の linux/arm64 Ubuntu 24.04 で動く小さな C++ の検証プログラムにする（`prototypes/zoom/`）。結果は決まった形の結果行で返し、SDK の生の出力に頼らない
- 設定の確認、JWT（HS256）の作成、結果の判定と終了コード、Docker の起動・時間切れ・後片付けは TypeScript（`src/zoom-auth/`）に置き、Vitest でテストする
- SDK 本体とビルド結果は Git 管理外の `.local/` に置き、読み取り専用でコンテナに渡す
- 認証情報は Git 管理外の env 形式のファイル（`.local/zoom-credentials.env`）か、環境変数で渡す。JWT は標準入力でコンテナに渡し、引数・環境変数・ログに出さない。コンテナに渡す環境変数は、許可した名前だけにする

## 理由
- 二重実装（PR #2 / PR #3）で、どちらの計画も「SDK は C++、周りは TypeScript」「JWT は標準入力」に分けた
- PR #2 の分け方で、認証の成功・失敗・時間切れの区別と、中断・後片付けを偽の Docker でテストでき、相互レビューで見つかった中断時の不具合も TypeScript 側のテストで直せた
- 実 SDK での確認は、実際の Docker と SDK で行い、モックで代用しない（`docs/testing.md`）

## 選ばなかった案
- 認証情報を JSON 形式のファイルで読む（PR #3）: env 形式なら、Node.js の `--env-file` と環境変数のどちらでも渡せるため
- C++ の状態処理を SDK の偽物と組み合わせ、Vitest からコンパイルしてテストする（PR #3）: SDK もコンパイラも無い CI での扱いが重くなるため。C++ 側は薄く保ち、判定は TypeScript でテストする

## 影響
- 会議への参加・音声の取得も、同じ検証プログラムに機能を足す形で進められる。結果行の形を変えるときは、C++ と TypeScript の両方とテストをそろえる（決まりごとが2か所に分かれている点は、後で整理する候補）
- SDK の版を替えるときは `prototypes/zoom/scripts/` の準備スクリプトと既定の場所を直す（→ [0002](0002-zoom-sdkは7.2.1.5860のarm64を使う.md)）
- 見直すきっかけ: SDK を Docker 以外（別のマシンやクラウド）で動かすことになったとき
