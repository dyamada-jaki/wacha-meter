import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSdkJwt } from '../../src/zoom-auth/jwt.js';

const clientId = 'test-client-id-123';
const clientSecret = 'test-client-secret-xyz';
const issuedAt = 1_800_000_000;

function decodePart(part: string | undefined): unknown {
  return JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8'));
}

describe('createSdkJwt', () => {
  let token = '';
  let parts: string[] = [];
  beforeAll(() => {
    token = createSdkJwt({ clientId, clientSecret, issuedAt });
    parts = token.split('.');
  });

  it('ヘッダー・ペイロード・署名の3部を base64url で並べる', () => {
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('ヘッダーは HS256 の JWT', () => {
    expect(decodePart(parts[0])).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('ペイロードは appKey と、発行時刻から 1800 秒後の exp / tokenExp を持つ', () => {
    expect(decodePart(parts[1])).toEqual({
      appKey: clientId,
      iat: issuedAt,
      exp: issuedAt + 1800,
      tokenExp: issuedAt + 1800,
    });
  });

  it('署名は Secret による HMAC-SHA256（テスト側で独立に計算して比べる）', () => {
    const expected = createHmac('sha256', clientSecret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');
    expect(parts[2]).toBe(expected);
  });

  it('別の Secret では署名が変わり、トークンに Secret そのものは含まれない', () => {
    const other = createSdkJwt({ clientId, clientSecret: 'another-secret', issuedAt });
    expect(other.split('.')[2]).not.toBe(parts[2]);
    expect(token).not.toContain(clientSecret);
    expect(Buffer.from(token.replaceAll('.', ''), 'base64url').toString('latin1')).not.toContain(clientSecret);
  });
});
