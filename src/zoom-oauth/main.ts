// OAuth 確認コマンドの入口。実際のブラウザ（macOS の open）と Zoom につなぐ。
// 例: npm run zoom:oauth -- --timeout 300
// 認可 URL は Client ID を含むため表示せず、open の引数として渡すだけにする。

import { execFile } from 'node:child_process';
import { ZOOM_AUTHORIZE_URL } from './authorize.js';
import { runCli } from './cli.js';
import { runOAuthFlow } from './flow.js';
import { EXIT_CODES } from './outcome.js';
import { ZOOM_TOKEN_URL } from './token.js';

/** トークン要求の上限 */
const TOKEN_TIMEOUT_MS = 15_000;
/** open コマンドの上限 */
const OPEN_TIMEOUT_MS = 10_000;

const INTERRUPT_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('open', [url], { timeout: OPEN_TIMEOUT_MS }, (error) => (error === null ? resolve() : reject(error)));
  });
}

// 中断（Ctrl+C の SIGINT、停止の SIGTERM）は最初の1回だけ受け、待受を閉じてから 130 / 143 で終わる
const abort = new AbortController();
let interruptedBy: keyof typeof INTERRUPT_EXIT_CODES | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (interruptedBy !== undefined) return;
    interruptedBy = signal;
    console.error(`中断を受けました（${signal}）。待受を閉じて終了します。`);
    abort.abort();
  });
}

try {
  const code = await runCli(process.argv.slice(2), {
    env: process.env,
    runFlow: ({ clientId, timeoutSeconds }) =>
      runOAuthFlow({
        clientId,
        authorizeUrl: ZOOM_AUTHORIZE_URL,
        tokenUrl: ZOOM_TOKEN_URL,
        timeoutMs: timeoutSeconds * 1000,
        tokenTimeoutMs: TOKEN_TIMEOUT_MS,
        openBrowser,
        signal: abort.signal,
        log: (line) => console.error(line),
      }),
    write: (line) => console.log(line),
  });
  process.exitCode = interruptedBy === undefined ? code : INTERRUPT_EXIT_CODES[interruptedBy];
} catch {
  // 例外の内容は値を含みうるので出さない
  console.error('OAuth の確認コマンドが失敗しました。');
  process.exitCode = EXIT_CODES.other;
}
