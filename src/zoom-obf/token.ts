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

export async function requestObfToken(_input: ObfTokenInput): Promise<ObfResult> {
  void _input;
  return { kind: 'malformed' };
}
