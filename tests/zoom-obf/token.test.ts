// Zoom の通信境界だけを差し替え、本文の期限・中断・値の検証を実際の入口で確かめる。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestObfToken, ZOOM_OBF_URL } from '../../src/zoom-obf/token.js';

const ACCESS = 'dummy-access-secret-U9';
const OBF = 'dummy-obf-secret-H7';
const SECRET = 'dummy-response-secret-F2';
afterEach(() => vi.unstubAllGlobals());

function input(signal?: AbortSignal, timeoutMs = 1000) {
  return { url: ZOOM_OBF_URL, accessToken: ACCESS, timeoutMs, ...(signal === undefined ? {} : { signal }) };
}

function respond(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

// 実fetchでも同じAbortSignalが本文受信まで適用されることはflow.test.tsの実HTTPで補完する。
function stalledBody() {
  let started!: () => void;
  const reading = new Promise<void>((resolve) => (started = resolve));
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => ({
    status: 200,
    text: () => new Promise<string>((_resolve, reject) => {
      const signal = init.signal!;
      const fail = () => reject(new Error(SECRET));
      if (signal.aborted) fail();
      else signal.addEventListener('abort', fail, { once: true });
      started();
    }),
  })));
  return reading;
}

describe('OBF 要求の契約', () => {
  it('GET・Bearer・会議番号なしで要求し、200の空でないtokenだけを成功にし値を返さない', async () => {
    const fetch = respond(200, { token: OBF, message: SECRET, access_token: ACCESS });
    const result = await requestObfToken(input());
    expect(result).toEqual({ kind: 'succeeded' });
    expect(JSON.stringify(result)).not.toContain(OBF);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.zoom.us/v2/users/me/token?type=onbehalf');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${ACCESS}`);
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe('error');
  });

  it.each([
    ['欠落', {}], ['空', { token: '' }], ['null', { token: null }],
    ['数値', { token: 7 }], ['配列', [{ token: OBF }]], ['文字列', OBF], ['null本文', null],
  ])('HTTP200でもtokenが%sなら不正応答', async (_label, body) => {
    respond(200, body);
    expect(await requestObfToken(input())).toEqual({ kind: 'malformed' });
  });

  it.each([201, 400, 401, 403, 429, 500])('HTTP%sはtokenがあっても失敗、数値codeのみ返す', async (status) => {
    respond(status, { token: OBF, code: 124, message: SECRET, reason: ACCESS });
    expect(await requestObfToken(input())).toEqual({ kind: 'http_error', status, code: 124 });
  });

  it('HTTP204は成功にしない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    expect(await requestObfToken(input())).toEqual({ kind: 'http_error', status: 204 });
  });

  it.each([0, 999999])('codeの境界 %s は表示用の結果に残す', async (code) => {
    respond(400, { code, message: SECRET });
    expect(await requestObfToken(input())).toEqual({ kind: 'http_error', status: 400, code });
  });

  it.each(['124', SECRET, -1, 1000000, 1.5, null, {}, []])('安全範囲の整数でないcode %j は捨てる', async (code) => {
    respond(400, { code, message: SECRET });
    expect(await requestObfToken(input())).toEqual({ kind: 'http_error', status: 400 });
  });

  it('不正JSONの200は不正応答', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`not-json:${SECRET}`)));
    expect(await requestObfToken(input())).toEqual({ kind: 'malformed' });
  });

  it('不正JSONでもHTTP失敗の状態を保ち本文は出さない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SECRET, { status: 403 })));
    expect(await requestObfToken(input())).toEqual({ kind: 'http_error', status: 403 });
  });

  it('通信例外の内容は返さない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`${ACCESS} ${OBF} ${SECRET}`); }));
    expect(await requestObfToken(input())).toEqual({ kind: 'network_error' });
  });

  it('開始前に中断済みなら外部要求をしない', async () => {
    const fetch = respond(200, { token: OBF });
    expect(await requestObfToken(input(AbortSignal.abort()))).toEqual({ kind: 'interrupted' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('本文待ちも期限で終わり、値を返さない', async () => {
    const reading = stalledBody();
    const pending = requestObfToken(input(undefined, 30));
    // 未実装でもハングしないように、結果の検証だけを待つ。
    void reading;
    expect(await pending).toEqual({ kind: 'timeout' });
  });

  it('本文待ちの中断を成功にしない', async () => {
    const controller = new AbortController();
    stalledBody();
    const pending = requestObfToken(input(controller.signal));
    controller.abort();
    expect(await pending).toEqual({ kind: 'interrupted' });
  });

  it('応答完了と同時の中断でも成功を返さない', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, text: async () => {
      controller.abort();
      return JSON.stringify({ token: OBF });
    } })));
    expect(await requestObfToken(input(controller.signal))).toEqual({ kind: 'interrupted' });
  });
});
