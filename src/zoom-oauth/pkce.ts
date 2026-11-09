// PKCE（RFC 7636, S256）の code_verifier・code_challenge と、CSRF 対策の state を作る。

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
}

export function challengeFor(_verifier: string): string {
  throw new Error('未実装');
}

export function createPkce(): Pkce {
  throw new Error('未実装');
}

export function createState(): string {
  throw new Error('未実装');
}
