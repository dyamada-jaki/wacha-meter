// Mac上のOAuth認可からOBF取得までを1回だけ行う。値を引数・環境変数・ファイルに出さない。
import { execFile } from 'node:child_process';
import { ZOOM_AUTHORIZE_URL } from '../zoom-oauth/authorize.js';
import { ZOOM_TOKEN_URL } from '../zoom-oauth/token.js';
import { runObfCli } from './cli.js';
import { runObfFlow } from './flow.js';
import { ZOOM_OBF_URL } from './token.js';

const API_TIMEOUT_MS = 15_000;
const OPEN_TIMEOUT_MS = 10_000;
const INTERRUPT_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;
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

function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('open', [url], { timeout: OPEN_TIMEOUT_MS }, (error) => error === null ? resolve() : reject(error));
  });
}

try {
  const code = await runObfCli(process.argv.slice(2), {
    env: process.env,
    runFlow: ({ clientId, timeoutSeconds }) => runObfFlow({
      clientId, timeoutMs: timeoutSeconds * 1000,
      authorizeUrl: ZOOM_AUTHORIZE_URL, tokenUrl: ZOOM_TOKEN_URL, obfUrl: ZOOM_OBF_URL,
      tokenTimeoutMs: API_TIMEOUT_MS, obfTimeoutMs: API_TIMEOUT_MS,
      openBrowser, signal: abort.signal, log: (line) => console.error(line),
    }),
    write: (line) => console.log(line),
  });
  process.exitCode = interruptedBy === undefined ? code : INTERRUPT_EXIT_CODES[interruptedBy];
} catch {
  console.error('OAuth / OBF の確認コマンドが失敗しました。');
  process.exitCode = interruptedBy === undefined ? 1 : INTERRUPT_EXIT_CODES[interruptedBy];
}
