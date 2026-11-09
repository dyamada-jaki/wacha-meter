import { describe, expect, it } from 'vitest';
import { classifyCallback } from '../../src/zoom-oauth/callback.js';

const STATE = 'expected-state';
const q = (query: Record<string, string>) => new URLSearchParams(query);

describe('classifyCallback', () => {
  it('state が一致し code があれば、認可コードとして受け取る', () => {
    expect(classifyCallback(q({ code: 'c1', state: STATE }), STATE)).toEqual({ kind: 'code', code: 'c1' });
  });

  it('code があっても state が違えば不正な応答（成功にしない）', () => {
    expect(classifyCallback(q({ code: 'c1', state: 'other' }), STATE)).toEqual({
      kind: 'invalid',
      reason: 'state_mismatch',
    });
  });

  it('state が無ければ不正な応答', () => {
    expect(classifyCallback(q({ code: 'c1' }), STATE)).toEqual({ kind: 'invalid', reason: 'state_missing' });
  });

  it('error=access_denied は認可拒否', () => {
    expect(classifyCallback(q({ error: 'access_denied', state: STATE }), STATE)).toEqual({ kind: 'denied' });
  });

  it('state が違う拒否の応答は、拒否ではなく不正な応答', () => {
    expect(classifyCallback(q({ error: 'access_denied', state: 'other' }), STATE)).toEqual({
      kind: 'invalid',
      reason: 'state_mismatch',
    });
  });

  it('その他の error は不正な応答。error の値は英数字と _ のときだけ残す', () => {
    expect(classifyCallback(q({ error: 'invalid_request', state: STATE }), STATE)).toEqual({
      kind: 'invalid',
      reason: 'provider_error',
      errorCode: 'invalid_request',
    });
    expect(classifyCallback(q({ error: '<script>', state: STATE }), STATE)).toEqual({
      kind: 'invalid',
      reason: 'provider_error',
    });
  });

  it('code も error も無ければ不正な応答', () => {
    expect(classifyCallback(q({ state: STATE }), STATE)).toEqual({ kind: 'invalid', reason: 'code_missing' });
    expect(classifyCallback(q({ code: '', state: STATE }), STATE)).toEqual({ kind: 'invalid', reason: 'code_missing' });
  });
});
