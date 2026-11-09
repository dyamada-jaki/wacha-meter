import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';

export const TOTAL_TIMEOUT_MS = 300_000;
export const TOKEN_TIMEOUT_MS = 30_000;
export const BROWSER_TIMEOUT_MS = 10_000;

export type OAuthResult = {
  readonly kind: 'success' | 'failure' | 'denied' | 'timeout' | 'interrupted';
  readonly errorCode?: string;
};

export interface OAuthOptions {
  readonly clientId: string;
  readonly openBrowser: (url: string, signal: AbortSignal) => Promise<void>;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly tokenTimeoutMs?: number;
  readonly browserTimeoutMs?: number;
}

function errorResult(error: unknown, callback = false): OAuthResult {
  // description・HTTP本文・URLなどは返さない。表示するのは承認された文字種のコードだけ。
  const errorCode = typeof error === 'string' && /^[a-z0-9_]+$/.test(error) ? error : undefined;
  return {
    kind: callback && errorCode === 'access_denied' ? 'denied' : 'failure',
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

function matchesState(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 外部への入口はブラウザとfetchだけ。認可コード・トークンを公開結果へ返さない。 */
export async function runOAuth(options: OAuthOptions): Promise<OAuthResult> {
  if (options.signal?.aborted) return { kind: 'interrupted' };
  const controller = new AbortController();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  let redirectUri = '';
  let claimed = false;
  let settled = false;
  let resolveResult!: (result: OAuthResult) => void;
  const result = new Promise<OAuthResult>((resolve) => { resolveResult = resolve; });
  const finish = (outcome: OAuthResult) => {
    if (settled) return;
    settled = true;
    controller.abort();
    resolveResult(outcome);
  };
  const interrupt = () => finish({ kind: 'interrupted' });
  options.signal?.addEventListener('abort', interrupt, { once: true });
  const totalTimer = setTimeout(() => finish({ kind: 'timeout' }), options.timeoutMs ?? TOTAL_TIMEOUT_MS);
  let browserTimer: ReturnType<typeof setTimeout> | undefined;
  let tokenTimer: ReturnType<typeof setTimeout> | undefined;

  const exchange = async (code: string) => {
    if (settled) return;
    tokenTimer = setTimeout(() => finish({ kind: 'timeout' }), options.tokenTimeoutMs ?? TOKEN_TIMEOUT_MS);
    try {
      const response = await (options.fetch ?? fetch)('https://zoom.us/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: options.clientId,
          code, redirect_uri: redirectUri, code_verifier: verifier }),
        signal: controller.signal,
        // リダイレクト先へ認可コード/verifierを送らない。
        redirect: 'error',
      });
      const data: unknown = await response.json();
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        finish({ kind: 'failure' });
      } else if (!response.ok || 'error' in data) {
        finish(errorResult('error' in data ? data.error : undefined));
      } else if ('access_token' in data && typeof data.access_token === 'string' && data.access_token.trim() !== '' &&
        'token_type' in data && typeof data.token_type === 'string' && data.token_type.toLowerCase() === 'bearer') {
        finish({ kind: 'success' });
      } else {
        finish({ kind: 'failure' });
      }
    } catch {
      finish({ kind: 'failure' });
    } finally {
      clearTimeout(tokenTimer);
    }
  };

  function reply(response: ServerResponse, status: number, message: string, done?: () => void) {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
      'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'", connection: 'close' });
    response.end(message, done);
  }

  const server = createServer((request, response) => {
    let url: URL;
    try { url = new URL(request.url ?? '', redirectUri); }
    catch { reply(response, 400, '不正な応答です。'); finish({ kind: 'failure' }); return; }
    if (url.pathname !== '/callback') { reply(response, 404, '見つかりません。'); return; }
    if (claimed || settled) { reply(response, 409, 'この認可は終了しています。'); return; }
    claimed = true;
    // callbackを受けた時点で新規接続を止める。応答を送り終えてから判定/交換へ進む。
    server.close();
    const params = url.searchParams;
    const valid = request.method === 'GET' && request.headers.host === new URL(redirectUri).host &&
      request.url?.startsWith('/callback?') && url.origin === new URL(redirectUri).origin &&
      params.getAll('state').length === 1 && matchesState(params.get('state')!, state);
    const codes = params.getAll('code');
    const errors = params.getAll('error');
    if (!valid || !((codes.length === 1 && codes[0] !== '' && errors.length === 0) ||
      (errors.length === 1 && errors[0] !== '' && codes.length === 0))) {
      reply(response, 400, '認可応答を確認できませんでした。ターミナルを確認してください。', () => finish({ kind: 'failure' }));
    } else if (errors.length === 1) {
      reply(response, 400, '認可は完了しませんでした。ターミナルを確認してください。', () => finish(errorResult(errors[0], true)));
    } else {
      reply(response, 200, '認可応答を受け取りました。このタブを閉じ、ターミナルで結果を確認してください。', () => { void exchange(codes[0]!); });
    }
  });
  // HTTPパーサーのエラーにも、生のリクエストやエラーオブジェクトは出さない。
  server.on('clientError', (_error, socket) => { socket.destroy(); finish({ kind: 'failure' }); });
  server.on('error', () => finish({ kind: 'failure' }));
  try {
    server.listen({ host: '127.0.0.1', port: 0, signal: controller.signal }, () => {
      if (settled) return;
      const address = server.address();
      if (address === null || typeof address === 'string') { finish({ kind: 'failure' }); return; }
      redirectUri = `http://127.0.0.1:${address.port}/callback`;
      const auth = new URL('https://zoom.us/oauth/authorize');
      auth.search = new URLSearchParams({ response_type: 'code', client_id: options.clientId, redirect_uri: redirectUri,
        state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
      browserTimer = setTimeout(() => finish({ kind: 'timeout' }), options.browserTimeoutMs ?? BROWSER_TIMEOUT_MS);
      // openBrowserの完了はOSへの起動依頼の完了。人間の許可はcallbackで別に待つ。
      void Promise.resolve().then(() => {
        if (!settled) return options.openBrowser(auth.href, controller.signal);
      }).catch(() => finish({ kind: 'failure' })).finally(() => clearTimeout(browserTimer));
    });
    return await result;
  } catch {
    finish({ kind: 'failure' });
    return await result;
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(browserTimer);
    clearTimeout(tokenTimer);
    options.signal?.removeEventListener('abort', interrupt);
    // 認可完了/失敗/中断のどの場合も、未完了のHTTP接続を残さない。
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}
