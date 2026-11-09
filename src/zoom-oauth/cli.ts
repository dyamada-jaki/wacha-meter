import { runOAuth, type OAuthOptions } from './session.js';

export interface CliDeps extends Omit<OAuthOptions, 'clientId'> {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly write: (line: string) => void;
}

const USAGE = '使い方: npm run zoom:oauth（全体300秒、Ctrl+Cで中断）。設定手順: prototypes/zoom/OAUTH.md';

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') { deps.write(USAGE); return 0; }
  if (argv.length !== 0) { deps.write(USAGE); return 2; }
  const clientId = deps.env.ZOOM_OAUTH_PUBLIC_CLIENT_ID;
  if (!clientId || /\s/.test(clientId)) {
    deps.write('ZOOM_OAUTH_PUBLIC_CLIENT_ID を .local/zoom-oauth.env に設定してください。SDK の Client ID / Secret とは別です。');
    return 2;
  }
  deps.write('ブラウザで本人がログインし、アプリの許可を確認してください。全体の期限は300秒、Ctrl+Cで中断できます。');
  const outcome = await runOAuth({ ...deps, clientId });
  const messages = {
    success: 'OAuth トークン取得に成功しました。トークンは保存せず終了します。',
    failure: 'OAuth の確認に失敗しました。設定と手順を確認してください。',
    denied: 'OAuth の認可が拒否されました。',
    timeout: 'OAuth の確認が時間切れになりました。',
    interrupted: 'OAuth の確認を中断しました。',
  };
  deps.write(messages[outcome.kind] + (outcome.errorCode === undefined ? '' : ` エラー: ${outcome.errorCode}`));
  return { success: 0, failure: 1, denied: 3, timeout: 4, interrupted: 130 }[outcome.kind];
}
