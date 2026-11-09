// OAuth 確認コマンドの結果の種類・利用者向けの文言・終了コード。

import type { TokenSummary } from './token.js';

export type OAuthOutcome =
  | { readonly kind: 'succeeded'; readonly token: TokenSummary }
  | { readonly kind: 'denied' }
  | {
      readonly kind: 'invalid_response';
      readonly reason: 'state_missing' | 'state_mismatch' | 'code_missing' | 'provider_error' | 'token_malformed';
      readonly errorCode?: string;
    }
  | {
      readonly kind: 'token_failed';
      readonly reason: 'http_error' | 'network_error' | 'timeout';
      readonly status?: number;
      readonly errorCode?: string;
    }
  | { readonly kind: 'timed_out' }
  | { readonly kind: 'browser_failed' }
  | { readonly kind: 'interrupted' };

export const EXIT_CODES = {
  success: 0,
  other: 1,
  config: 2,
  denied: 3,
  timedOut: 4,
  interrupted: 130,
} as const;

export function exitCodeFor(_outcome: OAuthOutcome): number {
  throw new Error('未実装');
}

export function describeOutcome(_outcome: OAuthOutcome): string {
  throw new Error('未実装');
}
