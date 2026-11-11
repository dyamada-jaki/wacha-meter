// OBF 取得確認コマンド。引数と Public Client ID を確かめ、OAuth → OBF の流れを1回行い、結果と終了コードを返す。
// 引数・設定の扱いは zoom:oauth と同じ（.local/zoom-oauth.env の ZOOM_OAUTH_CLIENT_ID）。
// 会議番号は受け付けない。会議への参加・トークンの保存は行わない。

import {
  DEFAULT_TIMEOUT_SECONDS,
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  parseArgs,
  PUBLIC_CLIENT_ID_FILE,
  readPublicClientId,
  type OAuthRequest,
} from '../zoom-oauth/cli.js';
import { EXIT_CODES } from '../zoom-oauth/outcome.js';
import { describeObfOutcome, obfExitCodeFor, type ObfOutcome } from './outcome.js';

export interface ObfCliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runFlow: (request: OAuthRequest) => Promise<ObfOutcome>;
  readonly write: (line: string) => void;
}

const USAGE = [
  '使い方:',
  `  npm run zoom:obf [-- --timeout 秒]  ブラウザで Zoom のアプリ許可を行い、続けて OBF トークンの取得を確かめる（会議番号なし。待機は既定 ${DEFAULT_TIMEOUT_SECONDS} 秒、${MIN_TIMEOUT_SECONDS}〜${MAX_TIMEOUT_SECONDS}）`,
].join('\n');

export async function runObfCli(argv: readonly string[], deps: ObfCliDeps): Promise<number> {
  const args = parseArgs(argv);
  if (!args.ok) {
    deps.write(args.message);
    deps.write(USAGE);
    return EXIT_CODES.config;
  }
  const clientId = readPublicClientId(deps.env);
  if (!clientId.ok) {
    deps.write(clientId.message);
    deps.write(
      `Public Client ID を ${PUBLIC_CLIENT_ID_FILE} に設定してください（手順は prototypes/zoom/README.md）。ブラウザは開いていません。`,
    );
    return EXIT_CODES.config;
  }
  const outcome = await deps.runFlow({ clientId: clientId.clientId, timeoutSeconds: args.timeoutSeconds });
  deps.write(describeObfOutcome(outcome));
  return obfExitCodeFor(outcome);
}
