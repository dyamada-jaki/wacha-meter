import { afterEach, describe, expect, it, vi } from 'vitest';
import { isObfTokenResponse, requestObfToken, ZOOM_OBF_URL } from '../../src/zoom-obf/obf.js';
import { describeObfOutcome, obfExitCodeFor, toObfOutcome } from '../../src/zoom-obf/outcome.js';

const SUMMARY = { tokenType: 'bearer', expiresIn: 3599, scope: 'user:read:token' } as const;
const ACCESS = 'obf-unit-access-token-R4';
const OBF = 'obf-unit-obf-token-N2';
const MESSAGE = 'obf-unit-message-L8';

afterEach(() => vi.unstubAllGlobals());

/** fetch だけを差し替える（Zoom への通信の境界）。本文の受け取り方は text で決める */
function stubFetch(status: number, text: () => Promise<string>) {
  const fetch = vi.fn(async () => ({ status, text }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function obfInput(options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  return {
    url: ZOOM_OBF_URL,
    accessToken: ACCESS,
    timeoutMs: options.timeoutMs ?? 1000,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

describe('ZOOM_OBF_URL', () => {
  it('本人の OBF を求める Users API で、クエリは type=onbehalf だけ（会議番号なし）', () => {
    expect(ZOOM_OBF_URL).toBe('https://api.zoom.us/v2/users/me/token?type=onbehalf');
  });
});

describe('requestObfToken: 表示してよい code の範囲（整数 0〜999999）', () => {
  it.each([0, 999_999])('code %s は結果に残し、失敗の表示に出す', async (code) => {
    stubFetch(400, async () => JSON.stringify({ code, message: MESSAGE }));
    const result = await requestObfToken(obfInput());
    expect(result).toEqual({ kind: 'http_error', status: 400, code });
    const text = describeObfOutcome(toObfOutcome({ kind: 'succeeded', token: SUMMARY, used: { kind: 'returned', value: result } }));
    expect(text).toContain(`HTTP 400 code ${code}`);
    expect(text).not.toContain(MESSAGE);
  });

  it.each([-1, 1_000_000, 1.5, '124', null])('code %j は結果に残さず、表示しない', async (code) => {
    stubFetch(400, async () => JSON.stringify({ code, message: MESSAGE }));
    const result = await requestObfToken(obfInput());
    expect(result).toEqual({ kind: 'http_error', status: 400 });
    const text = describeObfOutcome(toObfOutcome({ kind: 'succeeded', token: SUMMARY, used: { kind: 'returned', value: result } }));
    expect(text).not.toContain('code');
    expect(text).not.toContain(MESSAGE);
  });
});

describe('requestObfToken: 本文を受け取った後の中断・期限', () => {
  it('本文を受け取るのと同時に利用者が中断したら、成功ではなく中断', async () => {
    const controller = new AbortController();
    stubFetch(200, async () => {
      controller.abort();
      return JSON.stringify({ token: OBF });
    });
    const result = await requestObfToken(obfInput({ signal: controller.signal }));
    expect(result).toEqual({ kind: 'aborted' });
    const outcome = toObfOutcome({ kind: 'succeeded', token: SUMMARY, used: { kind: 'returned', value: result } });
    expect(describeObfOutcome(outcome)).not.toContain('OBF トークンを取得しました');
    expect(obfExitCodeFor(outcome)).toBe(130);
  });

  it('本文を受け取り終えたのが期限の後なら、成功ではなく時間切れ', async () => {
    // 差し替えた本文の読み取りは signal を見ないので、期限を過ぎても本文を返す
    stubFetch(200, async () => {
      await new Promise((r) => setTimeout(r, 60));
      return JSON.stringify({ token: OBF });
    });
    expect(await requestObfToken(obfInput({ timeoutMs: 10 }))).toEqual({ kind: 'timeout' });
  });
});

describe('isObfTokenResponse: 成功の形は token が空でない文字列のときだけ', () => {
  it('{ token: "..." } は成功の形', () => {
    expect(isObfTokenResponse({ token: 'x' })).toBe(true);
  });

  it.each([
    ['token が空', { token: '' }],
    ['token が無い', {}],
    ['token が数値', { token: 1 }],
    ['token が null', { token: null }],
    ['文字列', 'token'],
    ['null', null],
    ['undefined', undefined],
    ['配列', ['token']],
  ])('%s なら成功の形ではない', (_label, body) => {
    expect(isObfTokenResponse(body)).toBe(false);
  });
});

describe('toObfOutcome: OAuth の結果から OBF 確認の結果へ', () => {
  it('OBF が ok のときだけ OBF 成功', () => {
    const o = toObfOutcome({ kind: 'succeeded', token: SUMMARY, used: { kind: 'returned', value: { kind: 'ok' } } });
    expect(o).toEqual({ kind: 'obf_succeeded', token: SUMMARY });
    expect(obfExitCodeFor(o)).toBe(0);
  });

  it('OBF の要求が例外で終わったら OBF 失敗（その他）で、成功にしない', () => {
    const o = toObfOutcome({ kind: 'succeeded', token: SUMMARY, used: { kind: 'threw' } });
    expect(o).toEqual({ kind: 'obf_failed', token: SUMMARY, reason: 'error' });
    expect(obfExitCodeFor(o)).toBe(1);
    expect(describeObfOutcome(o)).not.toContain('OBF トークンを取得しました');
  });

  it('OAuth だけ成功して OBF を要求していなければ OBF 失敗', () => {
    const o = toObfOutcome({ kind: 'succeeded', token: SUMMARY });
    expect(o).toEqual({ kind: 'obf_failed', token: SUMMARY, reason: 'error' });
    expect(obfExitCodeFor(o)).toBe(1);
  });

  it('OBF 要求中の中断は中断（130）', () => {
    const o = toObfOutcome({ kind: 'succeeded', token: SUMMARY, used: { kind: 'returned', value: { kind: 'aborted' } } });
    expect(o).toEqual({ kind: 'interrupted' });
    expect(obfExitCodeFor(o)).toBe(130);
  });

  it('OAuth の失敗はそのまま（拒否 3・時間切れ 4・ブラウザ失敗 1）', () => {
    expect(obfExitCodeFor(toObfOutcome({ kind: 'denied' }))).toBe(3);
    expect(obfExitCodeFor(toObfOutcome({ kind: 'timed_out' }))).toBe(4);
    expect(obfExitCodeFor(toObfOutcome({ kind: 'browser_failed' }))).toBe(1);
  });
});

describe('describeObfOutcome', () => {
  it('中断の文言は、OAuth の段階で取得済みでも食い違わないように「OBF トークンは取得していない」と伝える', () => {
    const text = describeObfOutcome({ kind: 'interrupted' });
    expect(text).toContain('中断しました');
    expect(text).toContain('OBF トークンは取得していません');
    expect(text).toContain('保存');
  });

  it('成功の文言は、会議に参加していないことと、トークンを保存しないことを伝える', () => {
    const text = describeObfOutcome({ kind: 'obf_succeeded', token: SUMMARY });
    expect(text).toContain('OBF トークンを取得しました');
    expect(text).toContain('会議には参加していません');
    expect(text).toContain('保存せず');
  });

  it('HTTP 失敗の文言は、会議番号を足して再実行せず PO に戻すよう案内する', () => {
    const text = describeObfOutcome({ kind: 'obf_failed', token: SUMMARY, reason: 'http_error', status: 400, code: 300 });
    expect(text).toContain('会議番号が必要な応答の場合は PO に戻してください');
    expect(text).toContain('会議番号を追加して再実行しないでください');
  });

  it.each(['malformed', 'network_error', 'timeout', 'error'] as const)('HTTP 失敗でない %s には会議番号の案内を付けない', (reason) => {
    expect(describeObfOutcome({ kind: 'obf_failed', token: SUMMARY, reason })).not.toContain('会議番号');
  });

  it('OBF 失敗の文言は、OAuth は成功したが OBF は取得できず、成功とは扱わないことを伝える', () => {
    const text = describeObfOutcome({ kind: 'obf_failed', token: SUMMARY, reason: 'http_error', status: 404, code: 1001 });
    expect(text).toContain('OAuth');
    expect(text).toContain('HTTP 404');
    expect(text).toContain('1001');
    expect(text).toContain('成功とは扱いません');
    expect(text).not.toContain('OBF トークンを取得しました');
  });

  it.each([
    ['malformed', '想定の形'],
    ['network_error', '接続'],
    ['timeout', '上限時間'],
  ] as const)('%s の文言', (reason, phrase) => {
    const text = describeObfOutcome({ kind: 'obf_failed', token: SUMMARY, reason });
    expect(text).toContain(phrase);
    expect(text).toContain('成功とは扱いません');
  });
});
