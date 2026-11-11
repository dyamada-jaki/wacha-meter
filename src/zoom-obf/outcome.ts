// OBF 取得確認コマンドの結果の種類・利用者向けの文言・終了コード。
// 文言には Client ID・認可コード・アクセストークン・OBF トークン・API の応答本文を含めない。

import type { OAuthOutcome } from '../zoom-oauth/outcome.js';
import type { TokenSummary } from '../zoom-oauth/token.js';
import type { ObfResult } from './obf.js';

export type ObfFailureReason = 'http_error' | 'malformed' | 'network_error' | 'timeout' | 'error';

export type ObfOutcome =
  | Exclude<OAuthOutcome, { readonly kind: 'succeeded' }>
  | { readonly kind: 'obf_succeeded'; readonly token: TokenSummary }
  | {
      readonly kind: 'obf_failed';
      readonly token: TokenSummary;
      readonly reason: ObfFailureReason;
      readonly status?: number;
      readonly code?: number;
    };

/** OAuth の流れの結果（後続処理として OBF を要求したもの）を、OBF 確認の結果にする */
export function toObfOutcome(_outcome: OAuthOutcome<ObfResult>): ObfOutcome {
  throw new Error('未実装');
}

export function obfExitCodeFor(_outcome: ObfOutcome): number {
  throw new Error('未実装');
}

export function describeObfOutcome(_outcome: ObfOutcome): string {
  throw new Error('未実装');
}
