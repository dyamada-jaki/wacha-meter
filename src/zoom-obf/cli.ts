import {
  DEFAULT_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, PUBLIC_CLIENT_ID_FILE,
  parseArgs, readPublicClientId, type OAuthRequest,
} from '../zoom-oauth/cli.js';
import { describeOutcome, exitCodeFor } from '../zoom-oauth/outcome.js';
import type { ObfOutcome } from './flow.js';

export interface ObfCliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runFlow: (request: OAuthRequest) => Promise<ObfOutcome>;
  readonly write: (line: string) => void;
}

export function describeObfOutcome(outcome: ObfOutcome): string {
  switch (outcome.kind) {
    case 'succeeded':
      return 'OBF トークンを取得しました。値は保存せず、終了時に破棄します。会議への参加資格・入室成功を確認したものではありません。';
    case 'http_error': {
      const code = outcome.code === undefined ? '' : ` code ${outcome.code}`;
      return `OBF の取得に失敗しました（HTTP ${outcome.status}${code}）。会議番号が必要な応答の場合は PO に戻してください。会議番号を追加して再実行しないでください。`;
    }
    case 'malformed':
      return 'OBF API の応答が想定の形ではありません。成功とは扱いません。';
    case 'network_error':
      return 'OBF API に接続できませんでした。成功とは扱いません。';
    case 'timeout':
      return 'OBF API の応答が上限時間内にありませんでした。成功とは扱いません。';
    case 'interrupted':
      return 'OBF の確認を中断しました。成功とは扱いません。';
    case 'oauth_failed': {
      // OAuthの段階・失敗区分は保ち、providerの自由なコードは新コマンドでは出さない。
      const { errorCode: _code, ...safe } = { errorCode: undefined, ...outcome.outcome };
      void _code;
      return `OBF は取得していません。${describeOutcome(safe)}`;
    }
  }
}

function exitCode(outcome: ObfOutcome): number {
  if (outcome.kind === 'succeeded') return 0;
  if (outcome.kind === 'interrupted') return 130;
  if (outcome.kind === 'oauth_failed') return exitCodeFor(outcome.outcome);
  return 1;
}

export async function runObfCli(argv: readonly string[], deps: ObfCliDeps): Promise<number> {
  const args = parseArgs(argv);
  if (!args.ok) {
    deps.write('引数が不正です。入力値は表示しません。');
    deps.write(`使い方: npm run zoom:obf [-- --timeout 秒]（認可待機: 既定 ${DEFAULT_TIMEOUT_SECONDS} 秒、${MIN_TIMEOUT_SECONDS}〜${MAX_TIMEOUT_SECONDS} 秒）。`);
    return 2;
  }
  const clientId = readPublicClientId(deps.env);
  if (!clientId.ok) {
    deps.write(clientId.message);
    deps.write(`Public Client ID を ${PUBLIC_CLIENT_ID_FILE} に設定してください（prototypes/zoom/README.md）。ブラウザは開いていません。`);
    return 2;
  }
  try {
    const outcome = await deps.runFlow({ clientId: clientId.clientId, timeoutSeconds: args.timeoutSeconds });
    deps.write(describeObfOutcome(outcome));
    return exitCode(outcome);
  } catch {
    deps.write('OAuth / OBF の確認に失敗しました。値は表示しません。');
    return 1;
  }
}
