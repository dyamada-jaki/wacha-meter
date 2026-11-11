// OBF 取得確認コマンドの結果の種類・利用者向けの文言・終了コード。
// 文言には Client ID・認可コード・アクセストークン・OBF トークン・API の応答本文を含めない。

import { describeOutcome, EXIT_CODES, exitCodeFor, type OAuthOutcome } from '../zoom-oauth/outcome.js';
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
export function toObfOutcome(outcome: OAuthOutcome<ObfResult>): ObfOutcome {
  if (outcome.kind !== 'succeeded') return outcome;
  const { token, used } = outcome;
  // OBF を要求していない・要求が例外で終わったときは、OAuth だけの成功として失敗にする
  if (used === undefined || used.kind === 'threw') return { kind: 'obf_failed', token, reason: 'error' };
  const obf = used.value;
  switch (obf.kind) {
    case 'ok':
      return { kind: 'obf_succeeded', token };
    case 'aborted':
      return { kind: 'interrupted' };
    case 'http_error':
      return {
        kind: 'obf_failed',
        token,
        reason: 'http_error',
        status: obf.status,
        ...(obf.code === undefined ? {} : { code: obf.code }),
      };
    case 'malformed':
    case 'network_error':
    case 'timeout':
      return { kind: 'obf_failed', token, reason: obf.kind };
  }
}

export function obfExitCodeFor(outcome: ObfOutcome): number {
  switch (outcome.kind) {
    case 'obf_succeeded':
      return EXIT_CODES.success;
    case 'obf_failed':
      return EXIT_CODES.other;
    default:
      return exitCodeFor(outcome);
  }
}

const OBF_FAILED_LABELS = {
  http_error: 'Users API がエラーを返しました',
  malformed: 'Users API の応答が想定の形ではありません',
  network_error: 'Users API に接続できませんでした',
  timeout: 'Users API の応答が上限時間内にありませんでした',
  error: 'OBF の要求を完了できませんでした',
} as const;

export function describeObfOutcome(outcome: ObfOutcome): string {
  switch (outcome.kind) {
    case 'obf_succeeded':
      return 'OBF トークンを取得しました（HTTP 200、空でない文字列）。会議には参加していません。OAuth・OBF のトークンは保存せず、終了時に破棄します。';
    case 'obf_failed': {
      const detail = [
        outcome.status === undefined ? undefined : `HTTP ${outcome.status}`,
        outcome.code === undefined ? undefined : `code ${outcome.code}`,
      ].filter((v) => v !== undefined);
      const suffix = detail.length === 0 ? '' : `: ${detail.join(' ')}`;
      return `OAuth は成功しましたが、OBF トークンを取得できませんでした（${OBF_FAILED_LABELS[outcome.reason]}${suffix}）。成功とは扱いません。`;
    }
    case 'interrupted':
      // OBF 要求中の中断では OAuth トークンは取得済みのことがあるので、OBF について伝える
      return '中断しました。OBF トークンは取得していません（トークンは保存していません）。';
    default:
      return describeOutcome(outcome);
  }
}
