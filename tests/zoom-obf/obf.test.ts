import { describe, expect, it } from 'vitest';
import { isObfTokenResponse } from '../../src/zoom-obf/obf.js';
import { describeObfOutcome, obfExitCodeFor, toObfOutcome } from '../../src/zoom-obf/outcome.js';

const SUMMARY = { tokenType: 'bearer', expiresIn: 3599, scope: 'user:read:token' } as const;

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
