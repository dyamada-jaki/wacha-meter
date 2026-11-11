// OAuth 確認コマンドの結果の種類・利用者向けの文言・終了コード。
// 文言には Client ID・認可 URL・認可コード・トークンを含めない。

import type { TokenSummary, UseResult } from './token.js';

export type OAuthOutcome<U = never> =
  | { readonly kind: 'succeeded'; readonly token: TokenSummary; readonly used?: UseResult<U> }
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

export function exitCodeFor<U>(outcome: OAuthOutcome<U>): number {
  switch (outcome.kind) {
    case 'succeeded':
      return EXIT_CODES.success;
    case 'denied':
      return EXIT_CODES.denied;
    case 'timed_out':
      return EXIT_CODES.timedOut;
    case 'interrupted':
      return EXIT_CODES.interrupted;
    case 'invalid_response':
    case 'token_failed':
    case 'browser_failed':
      return EXIT_CODES.other;
  }
}

const INVALID_LABELS = {
  state_missing: '応答に state がありません',
  state_mismatch: '応答の state が一致しません',
  code_missing: '応答に認可コードがありません',
  provider_error: 'Zoom がエラーを返しました',
  token_malformed: 'トークン API の応答が想定の形ではありません',
} as const;

const TOKEN_FAILED_LABELS = {
  http_error: 'トークン API がエラーを返しました',
  network_error: 'トークン API に接続できませんでした',
  timeout: 'トークン API の応答が上限時間内にありませんでした',
} as const;

export function describeOutcome<U>(outcome: OAuthOutcome<U>): string {
  switch (outcome.kind) {
    case 'succeeded': {
      const scope = outcome.token.scope === undefined ? '' : `・スコープ ${outcome.token.scope}`;
      return `OAuth トークンを取得しました（種類 ${outcome.token.tokenType}・有効期間 ${outcome.token.expiresIn} 秒${scope}）。トークンは保存せず、終了時に破棄します。`;
    }
    case 'denied':
      return 'Zoom でアプリの許可が拒否されました（access_denied）。トークンは取得していません。';
    case 'invalid_response': {
      const code = outcome.errorCode === undefined ? '' : `: ${outcome.errorCode}`;
      return `認可の応答が不正です（${INVALID_LABELS[outcome.reason]}${code}）。成功とは扱いません。`;
    }
    case 'token_failed': {
      const detail = [
        outcome.status === undefined ? undefined : `HTTP ${outcome.status}`,
        outcome.errorCode,
      ].filter((v) => v !== undefined);
      const suffix = detail.length === 0 ? '' : `: ${detail.join(' ')}`;
      return `トークンを取得できませんでした（${TOKEN_FAILED_LABELS[outcome.reason]}${suffix}）。成功とは扱いません。`;
    }
    case 'timed_out':
      return '認可の応答が上限時間内に届きませんでした（時間切れ）。成功とは扱いません。';
    case 'browser_failed':
      return 'ブラウザで Zoom の認可画面を開けませんでした。成功とは扱いません。';
    case 'interrupted':
      return '中断しました。トークンは取得していません。';
  }
}
