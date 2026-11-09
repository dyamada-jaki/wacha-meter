// Zoom アカウント連携（OAuth）の確認コマンド。
// 引数と Public Client ID を確かめ、OAuth の流れを1回行い、結果と終了コードを返す。
// 会議への参加・OBF の取得・トークンの保存は行わない。

import { describeOutcome, EXIT_CODES, exitCodeFor, type OAuthOutcome } from './outcome.js';

/** OAuth の Public Client ID。SDK 用の ZOOM_SDK_CLIENT_ID とは別に持つ */
export const PUBLIC_CLIENT_ID_VARIABLE = 'ZOOM_OAUTH_CLIENT_ID';
export const PUBLIC_CLIENT_ID_FILE = '.local/zoom-oauth.env';
export const DEFAULT_TIMEOUT_SECONDS = 180;
export const MIN_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 600;

export interface OAuthRequest {
  readonly clientId: string;
  readonly timeoutSeconds: number;
}

export interface CliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runFlow: (request: OAuthRequest) => Promise<OAuthOutcome>;
  readonly write: (line: string) => void;
}

const USAGE = [
  '使い方:',
  `  npm run zoom:oauth [-- --timeout 秒]  ブラウザで Zoom のアプリ許可を行い、トークン取得を確かめる（待機は既定 ${DEFAULT_TIMEOUT_SECONDS} 秒、${MIN_TIMEOUT_SECONDS}〜${MAX_TIMEOUT_SECONDS}）`,
].join('\n');

type ParsedArgs =
  | { readonly ok: true; readonly timeoutSeconds: number }
  | { readonly ok: false; readonly message: string };

function parseArgs(argv: readonly string[]): ParsedArgs {
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--timeout') {
      const value = argv[++i] ?? '';
      if (!/^[0-9]+$/.test(value) || Number(value) < MIN_TIMEOUT_SECONDS || Number(value) > MAX_TIMEOUT_SECONDS) {
        return {
          ok: false,
          message: `--timeout は ${MIN_TIMEOUT_SECONDS}〜${MAX_TIMEOUT_SECONDS} の整数（秒）で指定してください。`,
        };
      }
      timeoutSeconds = Number(value);
    } else {
      return { ok: false, message: `使えない引数です: ${arg ?? ''}` };
    }
  }
  return { ok: true, timeoutSeconds };
}

type ClientIdResult = { readonly ok: true; readonly clientId: string } | { readonly ok: false; readonly message: string };

/** Public Client ID を読む。エラー文には値を含めない */
function readPublicClientId(env: Readonly<Record<string, string | undefined>>): ClientIdResult {
  const value = env[PUBLIC_CLIENT_ID_VARIABLE];
  if (value === undefined || value.trim() === '') {
    return { ok: false, message: `${PUBLIC_CLIENT_ID_VARIABLE} が設定されていません。` };
  }
  if (/\s/.test(value)) {
    return {
      ok: false,
      message: `${PUBLIC_CLIENT_ID_VARIABLE} に空白または改行が含まれています。値をそのまま貼り付けたか確認してください。`,
    };
  }
  return { ok: true, clientId: value };
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
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
  deps.write(describeOutcome(outcome));
  return exitCodeFor(outcome);
}
