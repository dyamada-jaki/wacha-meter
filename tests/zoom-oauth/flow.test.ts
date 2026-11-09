// OAuth の流れの結合テスト。一時サーバー・HTTP・fetch・PKCE は実物、Zoom（ブラウザ操作とトークン API）だけ偽物。
import { afterEach, describe, expect, it } from 'vitest';
import { runOAuthFlow } from '../../src/zoom-oauth/flow.js';
import { describeOutcome, exitCodeFor, type OAuthOutcome } from '../../src/zoom-oauth/outcome.js';
import {
  connectionRefused,
  createFakeBrowser,
  FAKE_ACCESS_TOKEN,
  FAKE_BAD_TARGET_SECRET,
  FAKE_CLIENT_ID,
  FAKE_CODE,
  FAKE_REFRESH_TOKEN,
  startFakeTokenApi,
  type BrowserBehavior,
  type FakeTokenApi,
  type TokenBehavior,
} from './fake-zoom.js';

let tokenApi: FakeTokenApi | undefined;
afterEach(async () => {
  await tokenApi?.close();
  tokenApi = undefined;
});

interface RunOptions {
  readonly browser?: BrowserBehavior;
  readonly token?: TokenBehavior;
  readonly timeoutMs?: number;
  readonly tokenTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

async function run(options: RunOptions = {}) {
  const browser = createFakeBrowser(options.browser ?? 'approve');
  tokenApi = await startFakeTokenApi(options.token ?? 'ok', browser.seen);
  const logs: string[] = [];
  let address: { address: string; port: number } | undefined;
  const outcome = await runOAuthFlow({
    clientId: FAKE_CLIENT_ID,
    authorizeUrl: 'https://zoom.example/oauth/authorize',
    tokenUrl: tokenApi.url,
    timeoutMs: options.timeoutMs ?? 5000,
    tokenTimeoutMs: options.tokenTimeoutMs ?? 5000,
    openBrowser: browser.open,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    log: (line) => logs.push(line),
    onListening: (a) => (address = a),
  });
  await browser.settled();
  if (address === undefined) throw new Error('待受が始まっていません');
  const closed = await connectionRefused(address.port);
  const output = [...logs, describeOutcome(outcome), ...browser.responses().map((r) => r.body)].join('\n');
  return { outcome, browser, address, closed, output, logs, requests: tokenApi.requests() };
}

/** どの経路でも、画面・ログ・ブラウザへの応答に秘密の値を出さない */
function expectNoSecrets(output: string, verifier?: string | null) {
  for (const secret of [FAKE_CLIENT_ID, FAKE_CODE, FAKE_ACCESS_TOKEN, FAKE_REFRESH_TOKEN, FAKE_BAD_TARGET_SECRET]) {
    expect(output).not.toContain(secret);
  }
  if (verifier) expect(output).not.toContain(verifier);
}

describe('runOAuthFlow: 成功', () => {
  it('許可されると、PKCE と同じ redirect_uri でトークンを取得し、表示してよい情報だけを返す', async () => {
    const r = await run();
    expect(r.outcome).toEqual({
      kind: 'succeeded',
      token: { tokenType: 'bearer', expiresIn: 3599, scope: 'user:read:token' },
    } satisfies OAuthOutcome);
    expect(exitCodeFor(r.outcome)).toBe(0);
    expect(describeOutcome(r.outcome)).toContain('user:read:token');
    expect(describeOutcome(r.outcome)).toContain('3599');
    // 偽トークン API は S256・redirect_uri・client_id・code が合うときだけ成功を返す（fake-zoom.ts）
    expect(r.requests).toHaveLength(1);
    expectNoSecrets(r.output, r.requests[0]?.form.get('code_verifier'));
  });

  it('認可 URL は公開クライアント・S256・state・127.0.0.1 の一時ポートの /callback を指す', async () => {
    const r = await run();
    const params = r.browser.seen()?.params;
    expect(params?.get('client_id')).toBe(FAKE_CLIENT_ID);
    expect(params?.get('code_challenge_method')).toBe('S256');
    expect(params?.get('state')).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(params?.get('redirect_uri')).toBe(`http://127.0.0.1:${r.address.port}/callback`);
    expect(r.address.address).toBe('127.0.0.1');
    expect(r.address.port).toBeGreaterThan(0);
  });

  it('待受は終了後に閉じている', async () => {
    const r = await run();
    expect(r.closed).toBe(true);
  });

  it('/callback 以外（favicon など）は 404 を返して待ち続け、その後の正しい応答で成功する', async () => {
    const r = await run({ browser: 'favicon_then_approve' });
    expect(r.outcome.kind).toBe('succeeded');
    expect(r.browser.responses()[0]?.status).toBe(404);
  });

  it('URL として解析できない request-target は 400 を返して待ち続け、値を出さずに、その後の正しい応答で成功する', async () => {
    const r = await run({ browser: 'bad_target_then_approve' });
    expect(r.browser.responses()[0]?.status).toBe(400);
    expect(r.outcome.kind).toBe('succeeded');
    expect(r.closed).toBe(true);
    expectNoSecrets(r.output);
  });
});

describe('runOAuthFlow: 失敗を成功と扱わない', () => {
  it('state が違う応答は不正な応答。認可コードをトークン API へ送らない', async () => {
    const r = await run({ browser: 'wrong_state' });
    expect(r.outcome).toEqual({ kind: 'invalid_response', reason: 'state_mismatch' });
    expect(exitCodeFor(r.outcome)).toBe(1);
    // 不正な応答の code を外へ送らないこと自体が契約なので、要求の有無を確かめる
    expect(r.requests).toHaveLength(0);
    expect(r.closed).toBe(true);
    expectNoSecrets(r.output);
  });

  it('state が無い応答も不正な応答で、トークン API へ送らない', async () => {
    const r = await run({ browser: 'no_state' });
    expect(r.outcome).toEqual({ kind: 'invalid_response', reason: 'state_missing' });
    expect(r.requests).toHaveLength(0);
  });

  it('認可拒否（access_denied）は拒否として終了コード 3', async () => {
    const r = await run({ browser: 'deny' });
    expect(r.outcome).toEqual({ kind: 'denied' });
    expect(exitCodeFor(r.outcome)).toBe(3);
    expect(r.requests).toHaveLength(0);
    expect(r.closed).toBe(true);
  });

  it('その他の error は不正な応答', async () => {
    const r = await run({ browser: 'provider_error' });
    expect(r.outcome).toEqual({ kind: 'invalid_response', reason: 'provider_error', errorCode: 'invalid_request' });
    expect(exitCodeFor(r.outcome)).toBe(1);
  });

  it('code が無い応答は不正な応答', async () => {
    const r = await run({ browser: 'no_code' });
    expect(r.outcome).toEqual({ kind: 'invalid_response', reason: 'code_missing' });
    expect(r.requests).toHaveLength(0);
  });

  it('トークン API が 400 ならトークン取得失敗（終了コード 1）。応答本文の値は出さない', async () => {
    const r = await run({ token: 'http_400' });
    expect(r.outcome).toEqual({ kind: 'token_failed', reason: 'http_error', status: 400, errorCode: 'invalid_grant' });
    expect(exitCodeFor(r.outcome)).toBe(1);
    expect(r.closed).toBe(true);
    expectNoSecrets(r.output);
  });

  it.each(['no_access_token', 'wrong_token_type', 'not_json'] as const)(
    'トークン API が 200 でも成功の形でなければ（%s）不正な応答',
    async (token) => {
      const r = await run({ token });
      expect(r.outcome).toEqual({ kind: 'invalid_response', reason: 'token_malformed' });
      expect(exitCodeFor(r.outcome)).toBe(1);
    },
  );

  it('トークン要求が上限を過ぎたらトークン取得失敗', async () => {
    const r = await run({ token: 'slow', tokenTimeoutMs: 200 });
    expect(r.outcome).toEqual({ kind: 'token_failed', reason: 'timeout' });
    expect(exitCodeFor(r.outcome)).toBe(1);
  });

  it('認可の応答が来ないまま上限を過ぎたら時間切れ（終了コード 4）で、待受を閉じる', async () => {
    const r = await run({ browser: 'never', timeoutMs: 300 });
    expect(r.outcome).toEqual({ kind: 'timed_out' });
    expect(exitCodeFor(r.outcome)).toBe(4);
    expect(r.closed).toBe(true);
    expect(r.requests).toHaveLength(0);
  });

  it('待機中に中断されたら中断として終わり、待受を閉じる', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const r = await run({ browser: 'never', signal: controller.signal });
    expect(r.outcome).toEqual({ kind: 'interrupted' });
    expect(r.closed).toBe(true);
    expect(r.requests).toHaveLength(0);
  });

  it('トークン要求中に中断されても中断として終わる', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const r = await run({ token: 'slow', signal: controller.signal });
    expect(r.outcome).toEqual({ kind: 'interrupted' });
  });

  it('ブラウザを開けなければ失敗（終了コード 1）で、待受を閉じる', async () => {
    const r = await run({ browser: 'fail' });
    expect(r.outcome).toEqual({ kind: 'browser_failed' });
    expect(exitCodeFor(r.outcome)).toBe(1);
    expect(r.closed).toBe(true);
  });
});
