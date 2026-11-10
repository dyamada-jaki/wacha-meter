import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { challengeFor, createPkce, createState } from '../../src/zoom-oauth/pkce.js';

describe('PKCE（S256）', () => {
  it('RFC 7636 付録 B の例と同じ code_challenge になる', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('code_verifier は 43〜128 文字の unreserved 文字で、challenge はその SHA-256 の base64url', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('毎回別の code_verifier と state を作る', () => {
    expect(createPkce().verifier).not.toBe(createPkce().verifier);
    const state = createState();
    expect(state).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(createState()).not.toBe(state);
  });
});
