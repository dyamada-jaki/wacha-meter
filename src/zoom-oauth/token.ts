// 認可コードを Zoom のトークン API でトークンに交換する（公開クライアント: Secret なし、body に client_id）。
// トークンの値は返さない。成功したかと、表示してよい情報（種類・有効期間・スコープ）だけを返す。

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
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** トークン API の応答本文を検証する。成功の形でなければ undefined */
export function summarizeTokenResponse(_body: unknown): TokenSummary | undefined {
  throw new Error('未実装');
}

export function exchangeCode(_input: ExchangeCodeInput): Promise<TokenResult> {
  throw new Error('未実装');
}
