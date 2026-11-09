import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { runOAuth, type OAuthOptions } from '../../src/zoom-oauth/session.js';

const PUBLIC_ID = 'test-public-id';
const CODE = 'test-authorization-code';
const ACCESS = 'test-access-token';
const REFRESH = 'test-refresh-token';
const success = () => Response.json({ access_token: ACCESS, refresh_token: REFRESH, token_type: 'bearer' });
const controllers: AbortController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.abort(); });

function callback(auth: URL, params: Record<string, string> = {}) {
  const url = new URL(auth.searchParams.get('redirect_uri')!);
  url.search = new URLSearchParams({ state: auth.searchParams.get('state')!, code: CODE, ...params }).toString();
  return url;
}

function fixture(overrides: Partial<OAuthOptions> = {}) {
  const controller = new AbortController();
  controllers.push(controller);
  let authorization: URL | undefined;
  let body = '';
  let requestUrl = '';
  let init: RequestInit | undefined;
  let exchanges = 0;
  let browserResponse = '';
  const options: OAuthOptions = {
    clientId: PUBLIC_ID,
    timeoutMs: 2000,
    signal: controller.signal,
    openBrowser: async (url) => {
      authorization = new URL(url);
      browserResponse = await (await fetch(callback(authorization))).text();
    },
    fetch: async (url, request) => {
      exchanges++;
      requestUrl = String(url);
      body = String(request?.body);
      init = request;
      return success();
    },
    ...overrides,
  };
  return { options, controller, auth: () => authorization, exchanges: () => exchanges,
    request: () => ({ url: requestUrl, body: new URLSearchParams(body), init }), response: () => browserResponse };
}

async function expectClosed(url: string) {
  await expect(fetch(url)).rejects.toThrow();
  // 待受の閉鎖に加えて、同じポートを実際に再利用できる。
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(new URL(url).port), '127.0.0.1', resolve);
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('OAuth: 実loopback と外部API境界の結合', () => {
  it('Public ID・S256・stateで認可し、同じredirectとverifierで一度だけ交換する', async () => {
    const f = fixture();
    expect(await runOAuth(f.options)).toEqual({ kind: 'success' });
    const auth = f.auth()!;
    expect(auth.origin + auth.pathname).toBe('https://zoom.us/oauth/authorize');
    expect(auth.searchParams.get('client_id')).toBe(PUBLIC_ID);
    expect(auth.searchParams.get('response_type')).toBe('code');
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const redirect = new URL(auth.searchParams.get('redirect_uri')!);
    expect(redirect.hostname).toBe('127.0.0.1');
    expect(redirect.pathname).toBe('/callback');
    expect(Number(redirect.port)).toBeGreaterThan(0);
    const request = f.request();
    expect(request.url).toBe('https://zoom.us/oauth/token');
    expect(request.init?.method).toBe('POST');
    expect(new Headers(request.init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(new Headers(request.init?.headers).has('authorization')).toBe(false);
    expect(request.init?.redirect).toBe('error');
    expect(request.body.get('grant_type')).toBe('authorization_code');
    expect(request.body.get('client_id')).toBe(PUBLIC_ID);
    expect(request.body.get('redirect_uri')).toBe(redirect.href);
    expect(request.body.get('code')).toBe(CODE);
    const verifier = request.body.get('code_verifier')!;
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(auth.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect([...request.body.keys()].sort()).toEqual(['client_id', 'code', 'code_verifier', 'grant_type', 'redirect_uri']);
    expect(f.exchanges()).toBe(1);
    for (const secret of [PUBLIC_ID, CODE, ACCESS, REFRESH, verifier, auth.searchParams.get('state')!]) {
      expect(f.response()).not.toContain(secret);
    }
    await expectClosed(redirect.href);
  });

  it('実行ごとにstateとverifierを新しくする', async () => {
    const a = fixture(); const b = fixture();
    expect((await runOAuth(a.options)).kind).toBe('success');
    expect((await runOAuth(b.options)).kind).toBe('success');
    expect(a.auth()!.searchParams.get('state')).not.toBe(b.auth()!.searchParams.get('state'));
    expect(a.request().body.get('code_verifier')).not.toBe(b.request().body.get('code_verifier'));
  });

  it.each(['wrong-state', 'missing-state', 'duplicate-state', 'missing-code', 'empty-code', 'duplicate-code', 'both', 'post', 'host'])(
    '不正callback（%s）は交換せず失敗して閉じる', async (variant) => {
      let redirect = '';
      const f = fixture({ openBrowser: async (value) => {
        const auth = new URL(value);
        const url = callback(auth);
        redirect = url.origin;
        if (variant === 'wrong-state') url.searchParams.set('state', 'wrong');
        if (variant === 'missing-state') url.searchParams.delete('state');
        if (variant === 'duplicate-state') url.searchParams.append('state', url.searchParams.get('state')!);
        if (variant === 'missing-code') url.searchParams.delete('code');
        if (variant === 'empty-code') url.searchParams.set('code', '');
        if (variant === 'duplicate-code') url.searchParams.append('code', CODE);
        if (variant === 'both') url.searchParams.set('error', 'access_denied');
        await fetch(url, { ...(variant === 'post' ? { method: 'POST' } : {}),
          ...(variant === 'host' ? { headers: { host: 'evil.example' } } : {}) });
      } });
      expect(await runOAuth(f.options)).toEqual({ kind: 'failure' });
      expect(redirect).not.toBe('');
      expect(f.exchanges()).toBe(0);
      await expectClosed(redirect);
    },
  );

  it.each([
    ['access_denied', { kind: 'denied', errorCode: 'access_denied' }],
    ['invalid_request', { kind: 'failure', errorCode: 'invalid_request' }],
    ['secret https://example.com', { kind: 'failure' }],
  ])('callbackのerror=%sを安全に分類する', async (error, expected) => {
    const f = fixture({ openBrowser: async (value) => {
      const url = callback(new URL(value));
      url.searchParams.delete('code');
      url.searchParams.set('error', error);
      url.searchParams.set('error_description', ACCESS);
      const response = await fetch(url);
      expect(await response.text()).not.toContain(ACCESS);
    } });
    expect(await runOAuth(f.options)).toEqual(expected);
    expect(f.exchanges()).toBe(0);
  });

  it('重複errorを不正として扱い、拒否と誤分類しない', async () => {
    const f = fixture({ openBrowser: async (value) => {
      const url = callback(new URL(value));
      url.searchParams.delete('code');
      url.searchParams.append('error', 'access_denied');
      url.searchParams.append('error', 'access_denied');
      await fetch(url);
    } });
    expect(await runOAuth(f.options)).toEqual({ kind: 'failure' });
  });

  it.each([
    ['http', () => Response.json({ error: 'invalid_client', error_description: ACCESS }, { status: 400 }), { kind: 'failure', errorCode: 'invalid_client' }],
    ['grant', () => Response.json({ error: 'invalid_grant' }, { status: 400 }), { kind: 'failure', errorCode: 'invalid_grant' }],
    ['unsafe', () => Response.json({ error: 'secret with spaces', error_description: ACCESS }, { status: 400 }), { kind: 'failure' }],
    ['html', () => new Response(ACCESS, { status: 502 }), { kind: 'failure' }],
    ['json', () => new Response('{invalid-json'), { kind: 'failure' }],
    ['missing', () => Response.json({ token_type: 'bearer' }), { kind: 'failure' }],
    ['empty', () => Response.json({ access_token: '', token_type: 'bearer' }), { kind: 'failure' }],
    ['type', () => Response.json({ access_token: ACCESS, token_type: 'wrong' }), { kind: 'failure' }],
    ['null', () => Response.json(null), { kind: 'failure' }],
    ['error-on-200', () => Response.json({ access_token: ACCESS, token_type: 'bearer', error: 'invalid_grant' }), { kind: 'failure', errorCode: 'invalid_grant' }],
  ] as const)('トークン応答（%s）を成功扱いしない', async (_name, respond, expected) => {
    let calls = 0;
    const f = fixture({ fetch: async () => { calls++; return respond(); } });
    expect(await runOAuth(f.options)).toEqual(expected);
    expect(calls).toBe(1);
  });

  it('外部APIが例外を返しても例外本文を結果へ出さず閉じる', async () => {
    const f = fixture({ fetch: async () => { throw new Error(ACCESS); } });
    expect(await runOAuth(f.options)).toEqual({ kind: 'failure' });
    await expectClosed(f.auth()!.searchParams.get('redirect_uri')!);
  });

  it('faviconは404で継続し、loopbackの別アドレスでは待ち受けない', async () => {
    const f = fixture({ openBrowser: async (value) => {
      const auth = new URL(value);
      const redirect = new URL(auth.searchParams.get('redirect_uri')!);
      const socket = connect({ host: '127.0.0.2', port: Number(redirect.port) });
      await new Promise<void>((resolve, reject) => {
        socket.once('error', () => resolve());
        socket.once('connect', () => { socket.destroy(); reject(new Error('loopback全体に公開された')); });
      });
      expect((await fetch(new URL('/favicon.ico', redirect))).status).toBe(404);
      await fetch(callback(auth));
    } });
    expect(await runOAuth(f.options)).toEqual({ kind: 'success' });
  });

  it('callback直後に待受を閉じ、トークン待ち中の再送で交換を増やさない', async () => {
    let redirect = '';
    let finishToken!: () => void;
    const tokenReady = new Promise<void>((resolve) => { finishToken = resolve; });
    const f = fixture({
      openBrowser: async (value) => {
        const auth = new URL(value);
        redirect = auth.searchParams.get('redirect_uri')!;
        await fetch(callback(auth));
        await expectClosed(redirect);
        finishToken();
      },
      fetch: async () => { await tokenReady; return success(); },
    });
    expect(await runOAuth(f.options)).toEqual({ kind: 'success' });
    expect(redirect).not.toBe('');
  });

  it.each(['wait', 'browser', 'token'] as const)('%s中の全体期限は非成功、待受と要求を閉じる', async (phase) => {
    let redirect = '';
    let aborted = false;
    const f = fixture({ timeoutMs: 60,
      openBrowser: async (value, signal) => {
        const auth = new URL(value);
        redirect = auth.searchParams.get('redirect_uri')!;
        if (phase === 'token') await fetch(callback(auth));
        if (phase === 'browser') await new Promise<void>((resolve) => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
      },
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => { aborted = true; reject(new Error(ACCESS)); }, { once: true });
      }),
    });
    expect(await runOAuth(f.options)).toEqual({ kind: 'timeout' });
    expect(redirect).not.toBe('');
    if (phase !== 'wait') expect(aborted).toBe(true);
    await expectClosed(redirect);
  });

  it.each(['wait', 'browser', 'token'] as const)('%s中の中断は非成功、待受と要求を閉じる', async (phase) => {
    let redirect = '';
    let aborted = false;
    const f = fixture({
      openBrowser: async (value, signal) => {
        const auth = new URL(value);
        redirect = auth.searchParams.get('redirect_uri')!;
        if (phase === 'token') await fetch(callback(auth));
        if (phase === 'browser') signal.addEventListener('abort', () => { aborted = true; }, { once: true });
        f.controller.abort();
      },
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => { aborted = true; reject(new Error(ACCESS)); }, { once: true });
      }),
    });
    expect(await runOAuth(f.options)).toEqual({ kind: 'interrupted' });
    if (phase !== 'wait') expect(aborted).toBe(true);
    await expectClosed(redirect);
  });

  it('開始前の中断ではブラウザを開かない', async () => {
    const f = fixture(); f.controller.abort();
    expect(await runOAuth(f.options)).toEqual({ kind: 'interrupted' });
    expect(f.auth()).toBeUndefined();
  });

  it('ブラウザ起動失敗ではURLや例外を出さず待受を閉じる', async () => {
    let redirect = '';
    const f = fixture({ openBrowser: async (value) => {
      redirect = new URL(value).searchParams.get('redirect_uri')!;
      throw new Error(value);
    } });
    expect(await runOAuth(f.options)).toEqual({ kind: 'failure' });
    expect(redirect).not.toBe('');
    await expectClosed(redirect);
  });

  it('ブラウザ起動10秒相当/トークン30秒相当の個別期限でも停止する', async () => {
    const browser = fixture({ browserTimeoutMs: 20, openBrowser: async () => new Promise(() => {}) });
    expect(await runOAuth(browser.options)).toEqual({ kind: 'timeout' });
    const token = fixture({ tokenTimeoutMs: 20, fetch: async () => new Promise(() => {}) });
    expect(await runOAuth(token.options)).toEqual({ kind: 'timeout' });
    await expectClosed(token.auth()!.searchParams.get('redirect_uri')!);
  });
});
