import { describe, expect, it } from 'vitest';
import { summarizeTokenResponse } from '../../src/zoom-oauth/token.js';

const ok = { access_token: 'secret-token', token_type: 'bearer', refresh_token: 'r', expires_in: 3599, scope: 'user:read:token' };

describe('summarizeTokenResponse', () => {
  it('成功の応答から、表示してよい情報だけを取り出す（トークンの値は含めない）', () => {
    const summary = summarizeTokenResponse(ok);
    expect(summary).toEqual({ tokenType: 'bearer', expiresIn: 3599, scope: 'user:read:token' });
    expect(JSON.stringify(summary)).not.toContain('secret-token');
  });

  it('token_type の大文字・小文字は問わない。scope が無くてもよい', () => {
    expect(summarizeTokenResponse({ ...ok, token_type: 'Bearer', scope: undefined })).toEqual({
      tokenType: 'Bearer',
      expiresIn: 3599,
    });
  });

  it.each([
    ['access_token が無い', { ...ok, access_token: undefined }],
    ['access_token が空', { ...ok, access_token: '' }],
    ['token_type が bearer でない', { ...ok, token_type: 'mac' }],
    ['expires_in が 0', { ...ok, expires_in: 0 }],
    ['expires_in が文字列', { ...ok, expires_in: '3599' }],
    ['オブジェクトでない', 'text'],
    ['null', null],
  ])('%s なら成功にしない', (_label, body) => {
    expect(summarizeTokenResponse(body)).toBeUndefined();
  });
});
