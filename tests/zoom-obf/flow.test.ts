// OAuth → OBF の流れの結合テスト（Issue #8）。一時サーバー・HTTP・fetch・PKCE は実物、
// Zoom（ブラウザ操作・トークン API・Users API）だけ 127.0.0.1 の偽物。
import { afterEach, describe, expect, it } from 'vitest';
import { runObfFlow } from '../../src/zoom-obf/flow.js';
import { describeObfOutcome, obfExitCodeFor, type ObfOutcome } from '../../src/zoom-obf/outcome.js';
import {
  connectionRefused,
  createFakeBrowser,
  FAKE_ACCESS_TOKEN,
  FAKE_BAD_TARGET_SECRET,
  FAKE_CLIENT_ID,
  FAKE_CODE,
  FAKE_OBF_TOKEN,
  FAKE_REFRESH_TOKEN,
  OBF_PATH,
  startFakeTokenApi,
  startFakeUsersApi,
  unusedUrl,
  type BrowserBehavior,
  type FakeTokenApi,
  type FakeUsersApi,
  type ObfBehavior,
  type TokenBehavior,
} from '../zoom-oauth/fake-zoom.js';

let tokenApi: FakeTokenApi | undefined;
let usersApi: FakeUsersApi | undefined;
afterEach(async () => {
  await tokenApi?.close();
  await usersApi?.close();
  tokenApi = undefined;
  usersApi = undefined;
});

interface RunOptions {
  readonly browser?: BrowserBehavior;
  readonly token?: TokenBehavior;
  readonly obf?: ObfBehavior;
  /** 指定すると偽 Users API の代わりに、この URL へ要求する */
  readonly obfUrl?: string;
  readonly timeoutMs?: number;
  readonly obfTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

const SUMMARY = { tokenType: 'bearer', expiresIn: 3599, scope: 'user:read:token' } as const;

async function run(options: RunOptions = {}) {
  const browser = createFakeBrowser(options.browser ?? 'approve');
  tokenApi = await startFakeTokenApi(options.token ?? 'ok', browser.seen);
  usersApi = await startFakeUsersApi(options.obf ?? 'ok');
  const logs: string[] = [];
  let address: { address: string; port: number } | undefined;
  const outcome = await runObfFlow({
    clientId: FAKE_CLIENT_ID,
    authorizeUrl: 'https://zoom.example/oauth/authorize',
    tokenUrl: tokenApi.url,
    obfUrl: options.obfUrl ?? usersApi.url,
    timeoutMs: options.timeoutMs ?? 5000,
    tokenTimeoutMs: 5000,
    obfTimeoutMs: options.obfTimeoutMs ?? 5000,
    openBrowser: browser.open,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    log: (line) => logs.push(line),
    onListening: (a) => (address = a),
  });
  await browser.settled();
  if (address === undefined) throw new Error('待受が始まっていません');
  const closed = await connectionRefused(address.port);
  const tokenRequests = tokenApi.requests();
  const output = [
    ...logs,
    describeObfOutcome(outcome),
    JSON.stringify(outcome),
    ...browser.responses().map((r) => r.body),
  ].join('\n');
  return {
    outcome,
    exitCode: obfExitCodeFor(outcome),
    closed,
    output,
    logs,
    tokenRequests,
    obfRequests: usersApi.requests(),
    verifier: tokenRequests[0]?.form.get('code_verifier'),
  };
}

/** どの経路でも、画面・ログ・ブラウザへの応答・結果の値に秘密の値を出さない */
function expectNoSecrets(output: string, verifier?: string | null) {
  for (const secret of [
    FAKE_CLIENT_ID,
    FAKE_CODE,
    FAKE_ACCESS_TOKEN,
    FAKE_REFRESH_TOKEN,
    FAKE_OBF_TOKEN,
    FAKE_BAD_TARGET_SECRET,
  ]) {
    expect(output).not.toContain(secret);
  }
  if (verifier) expect(output).not.toContain(verifier);
}

const SUCCESS_TEXT = 'OBF トークンを取得しました';

describe('runObfFlow: 成功', () => {
  it('OAuth で得たアクセストークンを同じプロセスで使い、会議番号なしで OBF を取得できたら成功（終了コード 0）', async () => {
    const r = await run();
    expect(r.outcome).toEqual({ kind: 'obf_succeeded', token: SUMMARY } satisfies ObfOutcome);
    expect(r.exitCode).toBe(0);
    expect(describeObfOutcome(r.outcome)).toContain(SUCCESS_TEXT);
    // 偽 Users API は GET・type=onbehalf だけのクエリ・偽トークン API が発行した Bearer のときだけ OBF を返す
    expect(r.obfRequests).toEqual([
      { method: 'GET', url: OBF_PATH, authorization: `Bearer ${FAKE_ACCESS_TOKEN}` },
    ]);
    expect(r.closed).toBe(true);
    expectNoSecrets(r.output, r.verifier);
  });

  it('進行表示で、OAuth の成功と OBF の要求（会議番号なし）を分けて知らせる', async () => {
    const r = await run();
    const text = r.logs.join('\n');
    expect(text).toContain('OAuth トークンを取得しました');
    expect(text).toContain('会議番号なし');
  });
});

describe('runObfFlow: OAuth だけの成功や OBF の失敗を OBF 成功と扱わない', () => {
  it('期限切れ・無効なトークン（401）は OBF 失敗（終了コード 1）。状態と数値 code だけを表示し、message は出さない', async () => {
    const r = await run({ obf: 'http_401' });
    expect(r.outcome).toEqual({ kind: 'obf_failed', token: SUMMARY, reason: 'http_error', status: 401, code: 124 });
    expect(r.exitCode).toBe(1);
    const text = describeObfOutcome(r.outcome);
    expect(text).not.toContain(SUCCESS_TEXT);
    expect(text).toContain('OAuth');
    expect(text).toContain('HTTP 401');
    expect(text).toContain('124');
    expect(text).not.toContain('Invalid access token');
    expect(r.closed).toBe(true);
    expectNoSecrets(r.output, r.verifier);
  });

  it('権限不足（403）は OBF 失敗（終了コード 1）', async () => {
    const r = await run({ obf: 'http_403' });
    expect(r.outcome).toEqual({ kind: 'obf_failed', token: SUMMARY, reason: 'http_error', status: 403, code: 4711 });
    expect(r.exitCode).toBe(1);
    expectNoSecrets(r.output, r.verifier);
  });

  it('エラー本文の code が整数 0〜999999 でなければ、code を表示しない', async () => {
    const r = await run({ obf: 'http_400_bad_code' });
    expect(r.outcome).toEqual({ kind: 'obf_failed', token: SUMMARY, reason: 'http_error', status: 400 });
    expectNoSecrets(r.output, r.verifier);
  });

  it('200 以外の 2xx（201）は成功にしない', async () => {
    const r = await run({ obf: 'http_201' });
    expect(r.outcome).toEqual({ kind: 'obf_failed', token: SUMMARY, reason: 'http_error', status: 201 });
    expect(r.exitCode).toBe(1);
    expectNoSecrets(r.output, r.verifier);
  });

  it.each(['empty_token', 'no_token', 'number_token', 'not_json'] as const)(
    'HTTP 200 でも空でない文字列の token が無ければ（%s）不正な応答で終了コード 1',
    async (obf) => {
      const r = await run({ obf });
      expect(r.outcome).toEqual({ kind: 'obf_failed', token: SUMMARY, reason: 'malformed' });
      expect(r.exitCode).toBe(1);
      expect(describeObfOutcome(r.outcome)).not.toContain(SUCCESS_TEXT);
      expectNoSecrets(r.output, r.verifier);
    },
  );

  it('リダイレクトには従わず失敗にし、リダイレクト先へアクセストークンを送らない', async () => {
    const r = await run({ obf: 'redirect' });
    expect(r.outcome).toMatchObject({ kind: 'obf_failed', reason: 'network_error' });
    expect(r.exitCode).toBe(1);
    // Bearer を別の送り先へ渡さないこと自体が契約なので、要求の有無を確かめる
    expect(usersApi?.redirectedRequests()).toEqual([]);
    expectNoSecrets(r.output, r.verifier);
  });

  it('接続できなければ通信失敗（終了コード 1）', async () => {
    const r = await run({ obfUrl: await unusedUrl(OBF_PATH) });
    expect(r.outcome).toEqual({ kind: 'obf_failed', token: SUMMARY, reason: 'network_error' });
    expect(r.exitCode).toBe(1);
  });

  it('本文の途中で接続が切れたら通信失敗で、例外で落ちない', async () => {
    const r = await run({ obf: 'cut' });
    expect(r.outcome).toEqual({ kind: 'obf_failed', token: SUMMARY, reason: 'network_error' });
    expect(r.exitCode).toBe(1);
  });

  it('OBF 要求が上限を過ぎたら時間切れの失敗（終了コード 1。認可待ちの時間切れ 4 とは分ける）', async () => {
    const r = await run({ obf: 'slow', obfTimeoutMs: 200 });
    expect(r.outcome).toEqual({ kind: 'obf_failed', token: SUMMARY, reason: 'timeout' });
    expect(r.exitCode).toBe(1);
  });

  it('OBF 要求中に中断されたら中断（終了コード 130）', async () => {
    const controller = new AbortController();
    // 偽 Users API が OBF の要求を受け取ってから（応答は 2 秒待たせる）中断する。固定の時間に頼らない
    const watcher = setInterval(() => {
      if ((usersApi?.requests().length ?? 0) > 0) {
        clearInterval(watcher);
        controller.abort();
      }
    }, 10);
    const r = await run({ obf: 'slow', signal: controller.signal }).finally(() => clearInterval(watcher));
    expect(r.outcome).toEqual({ kind: 'interrupted' });
    expect(r.exitCode).toBe(130);
    expect(r.obfRequests).toHaveLength(1);
    expect(r.closed).toBe(true);
  });

  it('OAuth のトークン取得に失敗したら、OBF を要求しない', async () => {
    const r = await run({ token: 'http_400' });
    expect(r.outcome).toEqual({ kind: 'token_failed', reason: 'http_error', status: 400, errorCode: 'invalid_grant' });
    expect(r.exitCode).toBe(1);
    expect(r.obfRequests).toHaveLength(0);
    expectNoSecrets(r.output, r.verifier);
  });

  it('認可拒否は終了コード 3 で、OBF を要求しない', async () => {
    const r = await run({ browser: 'deny' });
    expect(r.outcome).toEqual({ kind: 'denied' });
    expect(r.exitCode).toBe(3);
    expect(r.obfRequests).toHaveLength(0);
  });

  it('認可の応答待ちの時間切れは終了コード 4 で、待受を閉じる', async () => {
    const r = await run({ browser: 'never', timeoutMs: 300 });
    expect(r.outcome).toEqual({ kind: 'timed_out' });
    expect(r.exitCode).toBe(4);
    expect(r.closed).toBe(true);
    expect(r.obfRequests).toHaveLength(0);
  });

  it('認可待ちの間の中断は終了コード 130 で、待受を閉じる', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const r = await run({ browser: 'never', signal: controller.signal });
    expect(r.outcome).toEqual({ kind: 'interrupted' });
    expect(r.exitCode).toBe(130);
    expect(r.closed).toBe(true);
  });

  it('state の不一致は不正な応答で、トークンも OBF も要求しない', async () => {
    const r = await run({ browser: 'wrong_state' });
    expect(r.outcome).toEqual({ kind: 'invalid_response', reason: 'state_mismatch' });
    expect(r.exitCode).toBe(1);
    expect(r.tokenRequests).toHaveLength(0);
    expect(r.obfRequests).toHaveLength(0);
  });

  it('URL として解析できない request-target は 400 を返して待ち続け、その後の許可で OBF まで成功する', async () => {
    const r = await run({ browser: 'bad_target_then_approve' });
    expect(r.outcome.kind).toBe('obf_succeeded');
    expect(r.closed).toBe(true);
    expectNoSecrets(r.output, r.verifier);
  });
});
