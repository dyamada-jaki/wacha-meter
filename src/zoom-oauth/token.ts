// 認可コードを Zoom のトークン API でトークンに交換する（公開クライアント: Secret なし、body に client_id）。
// トークンの値は返さない。成功したかと、表示してよい情報（種類・有効期間・スコープ）だけを返す。
// アクセストークン・リフレッシュトークンはこの関数の中だけで扱い、保存も更新もしない。

import { SAFE_ERROR_CODE } from './callback.js';

export const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';

export interface TokenSummary {
  readonly tokenType: string;
  readonly expiresIn: number;
  readonly scope?: string;
}

/** アクセストークンを使う後続処理の結果。例外は値を含みうるので、投げたことだけを残す */
export type UseResult<U> = { readonly kind: 'returned'; readonly value: U } | { readonly kind: 'threw' };

/**
 * アクセストークンを受け取って後続の API を呼ぶ処理。トークンは引数としてだけ渡し、戻り値に含めない。
 * signal は利用者の中断（後続処理の上限時間は後続処理の側で持つ）。
 */
export type UseAccessToken<U> = (accessToken: string, signal: AbortSignal | undefined) => Promise<U>;

export type TokenResult<U = never> =
  | { readonly kind: 'ok'; readonly token: TokenSummary; readonly used?: UseResult<U> }
  | { readonly kind: 'http_error'; readonly status: number; readonly errorCode?: string }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'network_error' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' };

export interface ExchangeCodeInput<U = never> {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** 指定すると、成功の検証後にアクセストークンを渡して呼ぶ（トークンの要求の上限の外） */
  readonly useAccessToken?: UseAccessToken<U>;
}

/** トークン API の応答本文を検証する。成功の形でなければ undefined */
export function summarizeTokenResponse(body: unknown): TokenSummary | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { access_token: accessToken, token_type: tokenType, expires_in: expiresIn, scope } = body as Record<
    string,
    unknown
  >;
  if (typeof accessToken !== 'string' || accessToken === '') return undefined;
  if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') return undefined;
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) return undefined;
  return { tokenType, expiresIn, ...(typeof scope === 'string' ? { scope } : {}) };
}

export async function exchangeCode<U = never>(input: ExchangeCodeInput<U>): Promise<TokenResult<U>> {
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const signal = input.signal === undefined ? timeout : AbortSignal.any([input.signal, timeout]);
  try {
    const response = await fetch(input.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }).toString(),
      redirect: 'error',
      signal,
    });
    const text = await response.text();
    const body = parseJson(text);
    if (response.status !== 200) {
      const errorCode = errorCodeOf(body);
      return { kind: 'http_error', status: response.status, ...(errorCode === undefined ? {} : { errorCode }) };
    }
    const token = summarizeTokenResponse(body);
    return token === undefined ? { kind: 'malformed' } : { kind: 'ok', token };
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

/** エラー応答の error（形が安全なときだけ）。reason などの説明文は値を含みうるので使わない */
function errorCodeOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { error } = body as Record<string, unknown>;
  return typeof error === 'string' && SAFE_ERROR_CODE.test(error) ? error : undefined;
}
