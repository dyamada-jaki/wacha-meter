// PKCE（RFC 7636, S256）の code_verifier・code_challenge と、CSRF 対策の state を作る。

import { createHash, randomBytes } from 'node:crypto';

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
}

/** code_challenge = BASE64URL(SHA-256(ASCII(code_verifier))) */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** 32 バイトの乱数を base64url にした 43 文字の verifier（unreserved 文字だけ） */
export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: challengeFor(verifier) };
}

export function createState(): string {
  return randomBytes(16).toString('base64url');
}
