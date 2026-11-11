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
export function isObfTokenResponse(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const { token } = body as Record<string, unknown>;
  return typeof token === 'string' && token !== '';
}

export async function requestObfToken(input: ObfRequestInput): Promise<ObfResult> {
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const signal = input.signal === undefined ? timeout : AbortSignal.any([input.signal, timeout]);
  try {
    const response = await fetch(input.url, {
      method: 'GET',
      headers: { authorization: `Bearer ${input.accessToken}`, accept: 'application/json' },
      // リダイレクト先にアクセストークンを送らない
      redirect: 'error',
      signal,
    });
    const body = parseJson(await response.text());
    if (response.status !== 200) {
      const code = errorCodeOf(body);
      return { kind: 'http_error', status: response.status, ...(code === undefined ? {} : { code }) };
    }
    // OBF の値は判定に使うだけで、返さない
    return isObfTokenResponse(body) ? { kind: 'ok' } : { kind: 'malformed' };
  } catch {
    if (input.signal?.aborted === true) return { kind: 'aborted' };
    if (timeout.aborted) return { kind: 'timeout' };
    return { kind: 'network_error' };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** エラー本文の code（整数 0〜999999 のときだけ）。message など説明文は値を含みうるので使わない */
function errorCodeOf(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { code } = body as Record<string, unknown>;
  return typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= MAX_SAFE_ERROR_CODE
    ? code
    : undefined;
}
