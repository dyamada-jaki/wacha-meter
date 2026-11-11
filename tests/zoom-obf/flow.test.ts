// 実物のCLI・OAuth・PKCE・loopback・fetchを結合する。Zoomの認可とAPIだけローカルfake。
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { runObfFlow, type ObfOutcome } from '../../src/zoom-obf/flow.js';
import { runObfCli } from '../../src/zoom-obf/cli.js';
import { runOAuthFlow } from '../../src/zoom-oauth/flow.js';
import {
  connectionRefused, createFakeBrowser, startFakeTokenApi,
  FAKE_ACCESS_TOKEN, FAKE_REFRESH_TOKEN, FAKE_CODE, FAKE_CLIENT_ID, FAKE_BAD_TARGET_SECRET,
  type BrowserBehavior, type TokenBehavior,
} from '../zoom-oauth/fake-zoom.js';

const OBF = 'fake-obf-secret-R6';
const MESSAGE = 'fake-message-secret-G1';
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

interface Options {
  browser?: BrowserBehavior;
  oauthToken?: TokenBehavior;
  status?: number;
  body?: unknown;
  mode?: 'headers_only' | 'no_response' | 'disconnect' | 'redirect';
  signal?: AbortSignal;
  timeoutMs?: number;
  tokenTimeoutMs?: number;
  obfTimeoutMs?: number;
  onObfRequest?: () => void;
}

async function run(options: Options = {}) {
  const browser = createFakeBrowser(options.browser ?? 'approve');
  const oauth = await startFakeTokenApi(options.oauthToken ?? 'ok', browser.seen);
  closers.push(oauth.close);
  let address: { address: string; port: number } | undefined;
  const requests: { method?: string; url?: string; authorization?: string }[] = [];
  const callbackClosedAtRequest: boolean[] = [];
  let redirectRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/redirect-target') {
      redirectRequests++;
      res.end(JSON.stringify({ token: OBF }));
      return;
    }
    requests.push({
      ...(req.method === undefined ? {} : { method: req.method }),
      ...(req.url === undefined ? {} : { url: req.url }),
      ...(req.headers.authorization === undefined ? {} : { authorization: req.headers.authorization }),
    });
    void (async () => {
      callbackClosedAtRequest.push(address !== undefined && await connectionRefused(address.port));
      options.onObfRequest?.();
      if (options.mode === 'disconnect') return req.socket.destroy();
      if (options.mode === 'no_response') return;
      if (options.mode === 'redirect') {
        res.writeHead(302, { location: '/redirect-target' });
        res.end();
        return;
      }
      res.writeHead(options.status ?? 200, { 'content-type': 'application/json' });
      if (options.mode === 'headers_only') return res.flushHeaders();
      // Bearer不一致は拒否する。OAuthの要約だけで成功になる実装を検出する。
      if (req.headers.authorization !== `Bearer ${FAKE_ACCESS_TOKEN}`) return end(res, { token: '' });
      end(res, options.body === undefined ? { token: OBF, message: MESSAGE } : options.body);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const port = (server.address() as AddressInfo).port;
  const logs: string[] = [];
  let outcome: ObfOutcome | undefined;
  const code = await runObfCli([], {
    env: { ZOOM_OAUTH_CLIENT_ID: FAKE_CLIENT_ID },
    runFlow: async ({ clientId }) => {
      outcome = await runObfFlow({
        clientId,
        authorizeUrl: 'https://zoom.example/oauth/authorize',
        tokenUrl: oauth.url,
        obfUrl: `http://127.0.0.1:${port}/v2/users/me/token?type=onbehalf`,
        timeoutMs: options.timeoutMs ?? 2000,
        tokenTimeoutMs: options.tokenTimeoutMs ?? 2000,
        obfTimeoutMs: options.obfTimeoutMs ?? 2000,
        openBrowser: browser.open,
        log: (line) => logs.push(line),
        onListening: (a) => (address = a),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      return outcome;
    },
    write: (line) => logs.push(line),
  });
  await browser.settled();
  const closed = address === undefined || await connectionRefused(address.port);
  const output = [...logs, JSON.stringify(outcome), ...browser.responses().map((r) => r.body)].join('\n');
  for (const secret of [OBF, MESSAGE, FAKE_ACCESS_TOKEN, FAKE_REFRESH_TOKEN, FAKE_CODE, FAKE_CLIENT_ID, FAKE_BAD_TARGET_SECRET]) {
    expect(output).not.toContain(secret);
  }
  const verifier = oauth.requests()[0]?.form.get('code_verifier');
  if (verifier) expect(output).not.toContain(verifier);
  expect(closed).toBe(true);
  return { code, outcome, output, requests, callbackClosedAtRequest, redirectRequests, browser };
}

function end(res: ServerResponse, body: unknown) { res.end(JSON.stringify(body)); }

describe('OAuth → OBF → CLI の結合', () => {
  it('同一プロセスのアクセストークンでOBFを取り、値を返さず成功0、要求前に待受が閉じる', async () => {
    const result = await run();
    expect(result.outcome).toEqual({ kind: 'succeeded' });
    expect(result.code).toBe(0);
    expect(result.output).toContain('OBF トークンを取得しました');
    expect(result.requests).toEqual([{ method: 'GET', url: '/v2/users/me/token?type=onbehalf', authorization: `Bearer ${FAKE_ACCESS_TOKEN}` }]);
    expect(result.callbackClosedAtRequest).toEqual([true]);
  });

  it.each(['deny', 'wrong_state', 'no_state', 'no_code', 'provider_error', 'fail'] as const)(
    'OAuthが%sならOBFへ進まず非成功', async (browser) => {
      const result = await run({ browser });
      expect(result.code).toBe(browser === 'deny' ? 3 : 1);
      expect(result.requests).toEqual([]);
      expect(result.output).not.toContain('OBF トークンを取得しました');
    },
  );

  it.each(['http_400', 'no_access_token', 'wrong_token_type', 'not_json'] as const)(
    'OAuth交換が%sならOBFへ進まない', async (oauthToken) => {
      const result = await run({ oauthToken });
      expect(result.code).toBe(1);
      expect(result.requests).toEqual([]);
    },
  );

  it('OAuth交換の時間切れは1', async () => {
    const result = await run({ oauthToken: 'slow', tokenTimeoutMs: 50 });
    expect(result.code).toBe(1);
    expect(result.requests).toEqual([]);
  });

  it('callback待機だけの時間切れは4', async () => {
    const result = await run({ browser: 'never', timeoutMs: 50 });
    expect(result.code).toBe(4);
    expect(result.requests).toEqual([]);
  });

  it.each([400, 401, 403, 429, 500])('OAuth成功後でもOBF HTTP%sは1、数値codeとPOへの固定案内のみ', async (status) => {
    const result = await run({ status, body: { token: OBF, code: 124, message: `meeting_id required ${MESSAGE}`, reason: FAKE_ACCESS_TOKEN } });
    expect(result.code).toBe(1);
    expect(result.output).toContain(`HTTP ${status}`);
    expect(result.output).toContain('code 124');
    expect(result.output).toContain('PO');
    expect(result.output).not.toContain('OBF トークンを取得しました');
    expect(result.requests).toHaveLength(1);
  });

  it('HTTP200でもtokenが空なら非成功1', async () => {
    const result = await run({ body: { token: '', message: MESSAGE } });
    expect(result.code).toBe(1);
    expect(result.outcome).toEqual({ kind: 'malformed' });
  });

  it.each(['headers_only', 'no_response'] as const)('OBFの%sも15秒相当の期限で終わる（テストは50ms）、終了コード1', async (mode) => {
    const result = await run({ mode, obfTimeoutMs: 50 });
    expect(result.outcome).toEqual({ kind: 'timeout' });
    expect(result.code).toBe(1);
  });

  it('OBF通信切断は1', async () => {
    const result = await run({ mode: 'disconnect' });
    expect(result.code).toBe(1);
    expect(result.outcome).toEqual({ kind: 'network_error' });
  });

  it('OBFリダイレクトには追従しない', async () => {
    const result = await run({ mode: 'redirect' });
    expect(result.code).toBe(1);
    expect(result.redirectRequests).toBe(0);
  });

  it('開始前の中断は130、外部要求なし', async () => {
    const result = await run({ signal: AbortSignal.abort() });
    expect(result.code).toBe(130);
    expect(result.requests).toEqual([]);
  });

  it('callback待機中の中断は130、OBFへ進まない', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50);
    try {
      const result = await run({ browser: 'never', signal: controller.signal });
      expect(result.code).toBe(130);
      expect(result.requests).toEqual([]);
    } finally { clearTimeout(timer); }
  });

  it('OAuth交換中の中断は130、OBFへ進まない', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      const result = await run({ oauthToken: 'slow', signal: controller.signal });
      expect(result.code).toBe(130);
      expect(result.requests).toEqual([]);
    } finally { clearTimeout(timer); }
  });

  it('OBF本文待ちの中断は130', async () => {
    const controller = new AbortController();
    const result = await run({ mode: 'headers_only', signal: controller.signal, onObfRequest: () => controller.abort() });
    expect(result.code).toBe(130);
    expect(result.outcome).toEqual({ kind: 'interrupted' });
  });

  it('解析不能URLを400で処理した後もOBFまで成功し、入力を漏らさない（#4 R1回帰）', async () => {
    const result = await run({ browser: 'bad_target_then_approve' });
    expect(result.code).toBe(0);
    expect(result.browser.responses()[0]?.status).toBe(400);
  });
});

describe('既存OAuth要約とメモリ内の接続点', () => {
  it('検証済みtokenを一度だけ受け渡してもOAuth結果は従来どおり要約だけ', async () => {
    const browser = createFakeBrowser('approve');
    const api = await startFakeTokenApi('ok', browser.seen);
    closers.push(api.close);
    const tokens: string[] = [];
    const result = await runOAuthFlow({
      clientId: FAKE_CLIENT_ID, authorizeUrl: 'https://zoom.example/oauth/authorize', tokenUrl: api.url,
      timeoutMs: 2000, tokenTimeoutMs: 2000, openBrowser: browser.open, log: () => undefined,
      onAccessToken: async (token: string) => { tokens.push(token); },
    });
    await browser.settled();
    expect(tokens).toEqual([FAKE_ACCESS_TOKEN]);
    expect(result).toEqual({ kind: 'succeeded', token: { tokenType: 'bearer', expiresIn: 3599, scope: 'user:read:token' } });
    expect(JSON.stringify(result)).not.toContain(FAKE_ACCESS_TOKEN);
    expect(JSON.stringify(result)).not.toContain(FAKE_REFRESH_TOKEN);
  });
});
