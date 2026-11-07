import { describe, expect, it } from 'vitest';
import { readCredentials } from '../../src/zoom-auth/config.js';

const ID = 'test-client-id-123';
const SECRET = 'test-client-secret-xyz';

function errorsOf(env: Record<string, string | undefined>) {
  const result = readCredentials(env);
  if (result.ok) throw new Error('エラーになるはずが成功した');
  return result.errors;
}

describe('readCredentials', () => {
  it('ID と Secret がそろっていれば、その値を返す', () => {
    expect(readCredentials({ ZOOM_SDK_CLIENT_ID: ID, ZOOM_SDK_CLIENT_SECRET: SECRET })).toEqual({
      ok: true,
      credentials: { clientId: ID, clientSecret: SECRET },
    });
  });

  it('どちらも未設定なら、両方を missing として返す', () => {
    const errors = errorsOf({});
    expect(errors.map((e) => [e.variable, e.kind])).toEqual([
      ['ZOOM_SDK_CLIENT_ID', 'missing'],
      ['ZOOM_SDK_CLIENT_SECRET', 'missing'],
    ]);
  });

  it('Secret だけ未設定なら、Secret だけを missing として返す（ID の値はメッセージに出さない）', () => {
    const errors = errorsOf({ ZOOM_SDK_CLIENT_ID: ID });
    expect(errors.map((e) => [e.variable, e.kind])).toEqual([['ZOOM_SDK_CLIENT_SECRET', 'missing']]);
    expect(errors[0]?.message).not.toContain(ID);
  });

  it('空文字と空白だけの値は missing として扱う', () => {
    const errors = errorsOf({ ZOOM_SDK_CLIENT_ID: '', ZOOM_SDK_CLIENT_SECRET: '   ' });
    expect(errors.map((e) => [e.variable, e.kind])).toEqual([
      ['ZOOM_SDK_CLIENT_ID', 'missing'],
      ['ZOOM_SDK_CLIENT_SECRET', 'missing'],
    ]);
  });

  it.each([
    ['末尾の改行', `${SECRET}\n`],
    ['前の空白', ` ${SECRET}`],
    ['途中の空白', 'abc def'],
  ])('%s を含む値は invalid として扱い、値をメッセージに出さない', (_label, value) => {
    const errors = errorsOf({ ZOOM_SDK_CLIENT_ID: ID, ZOOM_SDK_CLIENT_SECRET: value });
    expect(errors.map((e) => [e.variable, e.kind])).toEqual([['ZOOM_SDK_CLIENT_SECRET', 'invalid']]);
    expect(errors[0]?.message).not.toContain(value.trim());
    expect(errors[0]?.message).toContain('ZOOM_SDK_CLIENT_SECRET');
  });
});
