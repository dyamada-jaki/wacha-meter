// 認可の戻り先（/callback）に届いたクエリを判定する。

export type CallbackResult =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'denied' }
  | {
      readonly kind: 'invalid';
      readonly reason: 'state_missing' | 'state_mismatch' | 'code_missing' | 'provider_error';
      /** provider_error のときの error の値（英数字と _ だけのときに限る） */
      readonly errorCode?: string;
    };

export function classifyCallback(_query: URLSearchParams, _expectedState: string): CallbackResult {
  throw new Error('未実装');
}
