// わちゃメーターの Zoom SDK 初期化・認証の検証コマンド。
//   init: SDK の初期化と後始末だけを行う（認証情報は不要）
//   auth: 認証情報から JWT を作り、SDK 認証の結果を確かめる
// 会議への参加・音声取得・録音は行わない。

import { readCredentials } from './config.js';
import { createSdkJwt } from './jwt.js';
import { describeOutcome, EXIT_CODES, exitCodeFor, type ProbeMode, type ProbeOutcome } from './outcome.js';

export interface ProbeRequest {
  readonly mode: ProbeMode;
  /** auth のときだけ。標準入力で検証プログラムへ渡す */
  readonly jwt?: string;
  readonly authTimeoutSeconds: number;
  readonly offline: boolean;
}

export interface CliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 現在時刻（UNIX 秒） */
  readonly now: () => number;
  readonly runProbe: (request: ProbeRequest) => Promise<ProbeOutcome>;
  readonly write: (line: string) => void;
}

export const DEFAULT_AUTH_TIMEOUT_SECONDS = 30;

const MAX_AUTH_TIMEOUT_SECONDS = 600;

const USAGE = [
  '使い方:',
  '  init                         SDK の初期化と後始末だけを確かめる（認証情報は不要）',
  `  auth [--timeout 秒] [--offline]  SDK の認証を確かめる（既定 ${DEFAULT_AUTH_TIMEOUT_SECONDS} 秒、1〜${MAX_AUTH_TIMEOUT_SECONDS}）`,
].join('\n');

type ParsedArgs =
  | { readonly ok: true; readonly mode: ProbeMode; readonly authTimeoutSeconds: number; readonly offline: boolean }
  | { readonly ok: false; readonly message: string };

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [mode, ...rest] = argv;
  if (mode !== 'init' && mode !== 'auth') {
    return { ok: false, message: 'init か auth を指定してください。' };
  }
  let authTimeoutSeconds = DEFAULT_AUTH_TIMEOUT_SECONDS;
  let offline = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (mode === 'auth' && arg === '--offline') {
      offline = true;
    } else if (mode === 'auth' && arg === '--timeout') {
      const value = rest[++i] ?? '';
      if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > MAX_AUTH_TIMEOUT_SECONDS) {
        return { ok: false, message: `--timeout は 1〜${MAX_AUTH_TIMEOUT_SECONDS} の整数（秒）で指定してください。` };
      }
      authTimeoutSeconds = Number(value);
    } else {
      return { ok: false, message: `使えない引数です: ${arg ?? ''}` };
    }
  }
  return { ok: true, mode, authTimeoutSeconds, offline };
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const args = parseArgs(argv);
  if (!args.ok) {
    deps.write(args.message);
    deps.write(USAGE);
    return EXIT_CODES.config;
  }

  let jwt: string | undefined;
  if (args.mode === 'auth') {
    const credentials = readCredentials(deps.env);
    if (!credentials.ok) {
      for (const error of credentials.errors) deps.write(error.message);
      deps.write(
        '認証情報を .local/zoom-credentials.env に設定してください（手順は prototypes/zoom/README.md）。検証プログラムは起動していません。',
      );
      return EXIT_CODES.config;
    }
    jwt = createSdkJwt({ ...credentials.credentials, issuedAt: deps.now() });
  }

  const outcome = await deps.runProbe({
    mode: args.mode,
    ...(jwt === undefined ? {} : { jwt }),
    authTimeoutSeconds: args.authTimeoutSeconds,
    offline: args.offline,
  });
  deps.write(describeOutcome(outcome));
  return exitCodeFor(outcome);
}
