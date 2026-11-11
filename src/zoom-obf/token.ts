/** OBF の値を含めない取得結果。 */
export type ObfResult =
  | { readonly kind: 'succeeded' }
  | { readonly kind: 'http_error'; readonly status: number; readonly code?: number }
  | { readonly kind: 'malformed' | 'network_error' | 'timeout' | 'interrupted' };

export const ZOOM_OBF_URL = 'https://api.zoom.us/v2/users/me/token?type=onbehalf';

export interface ObfTokenInput {
  readonly url: string;
  readonly accessToken: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** 値はBearerヘッダーと本文の検証だけで使い、結果やエラーへ含めない。 */
export async function requestObfToken(input: ObfTokenInput): Promise<ObfResult> {
  if (isAborted(input.signal)) return { kind: 'interrupted' };
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const signal = input.signal === undefined ? timeout : AbortSignal.any([input.signal, timeout]);
  try {
    const response = await fetch(input.url, {
      method: 'GET',
      headers: { authorization: `Bearer ${input.accessToken}`, accept: 'application/json' },
      redirect: 'error',
      signal,
    });
    // fetchのsignalは本文の受信にも適用される。
    const text = await response.text();
    if (isAborted(input.signal)) return { kind: 'interrupted' };
    if (timeout.aborted) return { kind: 'timeout' };
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = undefined; }
    const object = typeof body === 'object' && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown> : undefined;
    if (response.status !== 200) {
      const code = object?.code;
      return {
        kind: 'http_error', status: response.status,
        ...(typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 999999 ? { code } : {}),
      };
    }
    return typeof object?.token === 'string' && object.token !== ''
      ? { kind: 'succeeded' } : { kind: 'malformed' };
  } catch {
    if (isAborted(input.signal)) return { kind: 'interrupted' };
    if (timeout.aborted) return { kind: 'timeout' };
    return { kind: 'network_error' };
  }
}

function isAborted(signal: AbortSignal | undefined): boolean { return signal?.aborted === true; }
