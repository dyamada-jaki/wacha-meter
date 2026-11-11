// 本人に紐づく参加用トークン（OBF）を Zoom の Users API に要求し、応答を判定する。
// 要求先: GET https://api.zoom.us/v2/users/me/token?type=onbehalf（会議番号は付けない）。
// 成功応答の形は Zoom「OBF 認証」の例 { "token": "..." }（https://developers.zoom.us/docs/meeting-sdk/auth/obf/、2026-11-11 確認）。
// OBF の値は判定に使うだけで返さない。アクセストークンも Authorization ヘッダーに載せるだけで、保存しない。

export const ZOOM_OBF_URL = 'https://api.zoom.us/v2/users/me/token?type=onbehalf';

/** 表示してよい Zoom のエラー code の範囲（整数 0〜999999 のときだけ表示する） */
export const MAX_SAFE_ERROR_CODE = 999_999;

export type ObfResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'http_error'; readonly status: number; readonly code?: number }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'network_error' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' };

export interface ObfRequestInput {
  readonly url: string;
  readonly accessToken: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** OBF 応答の本文が成功の形（token が空でない文字列）か */
export function isObfTokenResponse(_body: unknown): boolean {
  throw new Error('未実装');
}

export function requestObfToken(_input: ObfRequestInput): Promise<ObfResult> {
  throw new Error('未実装');
}
