# Mac で Zoom アカウント連携を確かめる（Issue #4）

このコマンドは、本人の OAuth 許可からトークン取得までを確かめる試作です。会議には接続しません。SDK の初期化・JWT 認証（`zoom:init` / `zoom:auth`）とは別の認可です。

**本物の OAuth は未確認です。** 自動テストの成功だけでは Issue #4 完了とは扱いません。PR 作成後のレビュー時に、人間が以下のログイン・許可を行い、結果を開発チームへ伝えます。

## Public Client ID の設定（人間が行う）

Node.js 24 を使い、リポジトリのルートで `npm ci` を実行してください。OAuth コマンドには Docker や SDK の展開は不要です。Mac の既定ブラウザを `open` コマンドで起動します。

既存 General App の**開発用**設定を使います。ユーザー報告では、Public Client OAuth は ON、Redirect URL for OAuth と OAuth Allow List はともに `http://127.0.0.1/callback`、スコープは `user:read:token` に設定済みです。実際の認可はまだ試していません。

1. Zoom App Marketplace で既存 General App を開き、Basic Information → App Credentials の開発用 **Public Client ID** を確認します。SDK 用 Client ID / Secret、通常の OAuth 用 Client ID / Secret とは区別してください。
2. この worktree の `.local/zoom-oauth.env` をローカルのエディターで作ります。設定する行は `ZOOM_OAUTH_PUBLIC_CLIENT_ID=ここにPublicClientIDを設定` です。右辺の説明を実際の値に置き換えます。空白・改行を値に含めないでください。シェルへ値を直接入力して履歴に残す必要はありません。
3. 次のコマンドで読み書きを本人だけにします。

   ```sh
   chmod 600 .local/zoom-oauth.env
   ```

`.local/` は Git 管理外です。このコマンドはこのファイルと同名の環境変数から設定を読み、環境変数がある場合はそちらが優先されます。SDK 用の `.local/zoom-credentials.env` と `ZOOM_SDK_CLIENT_ID` / `ZOOM_SDK_CLIENT_SECRET` を編集・転用しないでください。開発サーバー用の `.env` は不要です。値やファイル内容をチャット・Issue・PRへ貼らないでください。

## 本物の認可（初回1回、自動再試行なし）

このワーカーの実認可試行は **0回**です。レビューで人間が確認する最初の試行は **1回**とし、失敗したら停止して結果の分類だけを記録します。設定修正後の追加試行は人間が判断します。

```sh
git rev-parse HEAD
npm run zoom:oauth
echo $?
```

1. 開いた既定ブラウザで、本人が Zoom にログインします。
2. アプリと要求された権限を確認し、本人が許可します。この操作をエージェントは代行しません。
3. ブラウザに認可応答を受け取った旨が表示されます。これはトークン取得成功の表示ではありません。ターミナルの「OAuth トークン取得に成功しました」と終了コード `0` を確認してください。
4. コマンド終了後に待受は閉じます。ローカルの戻り先を再読込しても接続できなくなることを確認します。再読込ではトークンを再取得しません。アドレスバーや開発者ツールの内容は共有せず、タブを閉じてください。

待機はコマンドの OAuth 処理開始から**全体300秒**です（ビルド時間は含みません）。その範囲内でブラウザ起動は最大**10秒**、トークン要求と応答読み取りは最大**30秒**です。期限は延長しません。ブラウザを閉じても CLI は止まらないので、取りやめるときはターミナルで **Ctrl+C**（SIGINT）。SIGTERM でも中断します。待受・未完了の接続・トークン要求・起動処理を終了します。ブラウザ自体のタブは人間が閉じます。

| 終了コード | 意味 |
|---|---|
| 0 | トークン取得成功（`--help` の案内表示も0） |
| 1 | 起動・認可応答・トークン取得などの失敗 |
| 2 | Public Client ID の未設定・不正、使い方の誤り |
| 3 | 本人による認可拒否（`access_denied`） |
| 4 | 全体・ブラウザ起動・トークン要求の時間切れ |
| 130 / 143 | SIGINT / SIGTERM で中断 |

Zoom が `error` を返した場合は、英小文字・数字・アンダースコア（`[a-z0-9_]`）だけで構成されたコード（例: `invalid_client` / `invalid_grant` / `access_denied`）だけを表示します。説明文・HTTP本文・URL・ID・認可コード・トークンを表示しません。`open` が失敗しても認可 URL を表示しません。失敗理由の詳細を得るために生レスポンスをログへ追加しないでください。

人間/開発チームが PR または Issue #4 に**日時・対象 SHA・結果種別・終了コード・試行回数**を記録します。実認可で確認できなかった場合は未確認のまま残します。スコープの実際の設定と本人への許可表示もこの場で確認します。

## 自動検証との分担

`npm run test` の `tests/zoom-oauth/` は実物の Node HTTP 待受・crypto・URL 検証・CLI/子プロセスを組み合わせ、Zoom の認可画面とトークン API だけを fake にします。テスト用の値で PKCE、state、不正応答、拒否、期限、中断、エラーの表示制限、待受と子プロセスの終了を確かめます。CIで本人のログイン・許可や実際のネットワークに依存しないためです。テストは本物の Zoom へ送信しません。

実サービスとの接続・Public Client ID の受理・本人の許可・本物のトークン取得は、上記の Mac での人間の1回の確認に分けます。E2E・ミューテーションは未導入で、今回追加していません。アプリ画面の確認は対象外です。

## 処理と今回の範囲

一時サーバーは `127.0.0.1:0` にバインドし、割り当てられたポートの `/callback` を使います。毎回ランダムな state と PKCE verifier を生成し、S256 challenge を送ります。callback では state、code/error の欠落・重複・矛盾を検証します。callback 受信時に新規の待受を止め、有効な code のみを1回交換します。成功・失敗・中断・期限で接続を片付けます。

トークン要求は HTTPS の form body に Public Client ID、code、同じ redirect_uri、verifier を載せ、Client Secret / Basic 認証は使いません。リダイレクト追従・再試行もしません。取得した access/refresh token はメモリでの応答検証だけに使い、公開結果に返さず、ファイルへ保存せず、プロセス終了で破棄します。永続保存・自動更新、OBF取得、会議参加・退出、音声、採点、外部配布、申請送信は今回の範囲外です。

[ADR 0001](../../docs/decisions/0001-zoom-sdk試作はDocker上のC++とTypeScriptに分ける.md) の SDK/C++ と周辺/TypeScript の分担を維持し、OAuth は SDK を呼ばない別コマンドにしています。[ADR 0002](../../docs/decisions/0002-zoom-sdkは7.2.1.5860のarm64を使う.md) の版・arm64・JWT3600秒は変更しません。今回の OAuth 成功は外部会議参加の方式採用や用途承認を意味しません。

## 公式資料と実認可で確かめる点

2026-11-09に [Zoom OAuth 公式資料](https://developers.zoom.us/docs/integrations/oauth/) の「Using Proof Key for Code Exchange (PKCE)」「Using a loopback redirect URI」を確認しました。loopback は登録した scheme・数値IP・path が一致すればポートだけが異なってよく、認可 URL と token 要求には同じ実ポートの redirect_uri を使います。

同資料の「Get your public client ID」には Base64 で送るという記述がある一方、PKCE/loopback の例とパラメーター表は通常の Public Client ID を使っており、記述が食い違っています。この試作は承認された計画に従って平文の ID を URL/form エンコードして送ります。本物の確認で `invalid_client` が出たら、SDK 用 ID との取り違え・開発用設定とともに、この記述の違いをまず確認します。未確認のまま Base64 版へ自動再試行しません。
