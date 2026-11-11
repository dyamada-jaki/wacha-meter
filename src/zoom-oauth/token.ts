// 認可コードを Zoom のトークン API でトークンに交換する（公開クライアント: Secret なし、body に client_id）。
// トークンの値は返さない。成功したかと、表示してよい情報（種類・有効期間・スコープ）だけを返す。
// アクセストークンは任意の接続点で同一プロセス内の次のAPIへ渡せる。保存も更新もしない。

import { SAFE_ERROR_CODE } from './callback.js';

export const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';

export interface TokenSummary {
  readonly tokenType: string;
  readonly expiresIn: number;
  readonly scope?: string;
}

export type TokenResult =
  | { readonly kind: 'ok'; readonly token: TokenSummary }
  | { readonly kind: 'http_error'; readonly status: number; readonly errorCode?: string }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'network_error' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' };

export interface ExchangeCodeInput {
  /** 検証済みの値をメモリ内でのみ使う。戻り値には含めない。 */
  readonly onAccessToken?: (accessToken: string) => Promise<void>;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
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

export async function exchangeCode(input: ExchangeCodeInput): Promise<TokenResult> {
  if (isAborted(input.signal)) return { kind: 'aborted' };
  let validated: { token: TokenSummary; accessToken: string };
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
    if (token === undefined) return { kind: 'malformed' };
    if (isAborted(input.signal)) return { kind: 'aborted' };
    if (timeout.aborted) return { kind: 'timeout' };
    validated = { token, accessToken: (body as { access_token: string }).access_token };
  } catch {
    if (isAborted(input.signal)) return { kind: 'aborted' };
    if (timeout.aborted) return { kind: 'timeout' };
    return { kind: 'network_error' };
  }
  // 後続APIは自身の期限を持つ。例外は通信例外に読み替えず呼び出し側で処理する。
  await input.onAccessToken?.(validated.accessToken);
  return { kind: 'ok', token: validated.token };
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

function isAborted(signal: AbortSignal | undefined): boolean { return signal?.aborted === true; }
