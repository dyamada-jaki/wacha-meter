// 認可の戻り先（/callback）に届いたクエリを判定する。
// state を最初に確かめ、一致しない応答は拒否・コードの有無にかかわらず不正な応答とする。

import { timingSafeEqual } from 'node:crypto';

export type CallbackResult =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'denied' }
  | {
      readonly kind: 'invalid';
      readonly reason: 'state_missing' | 'state_mismatch' | 'code_missing' | 'provider_error';
      /** provider_error のときの error の値（英数字と _ だけのときに限る） */
      readonly errorCode?: string;
    };

/** 表示してよいエラーコードの形（値を画面に出すのはこの形のときだけ） */
export const SAFE_ERROR_CODE = /^[A-Za-z0-9_]{1,64}$/;

export function classifyCallback(query: URLSearchParams, expectedState: string): CallbackResult {
  const state = query.get('state');
  if (state === null || state === '') return { kind: 'invalid', reason: 'state_missing' };
  if (!sameString(state, expectedState)) return { kind: 'invalid', reason: 'state_mismatch' };

  const error = query.get('error');
  if (error !== null) {
    if (error === 'access_denied') return { kind: 'denied' };
    return SAFE_ERROR_CODE.test(error)
      ? { kind: 'invalid', reason: 'provider_error', errorCode: error }
      : { kind: 'invalid', reason: 'provider_error' };
  }

  const code = query.get('code');
  if (code === null || code === '') return { kind: 'invalid', reason: 'code_missing' };
  return { kind: 'code', code };
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
