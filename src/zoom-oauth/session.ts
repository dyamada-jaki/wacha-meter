export type OAuthResult = {
  readonly kind: 'success' | 'failure' | 'denied' | 'timeout' | 'interrupted';
  readonly errorCode?: string;
};

export interface OAuthOptions {
  readonly clientId: string;
  readonly openBrowser: (url: string, signal: AbortSignal) => Promise<void>;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly tokenTimeoutMs?: number;
  readonly browserTimeoutMs?: number;
}

// テスト先行のための入口。承認された振る舞いは次のコミットで実装する。
export async function runOAuth(_options: OAuthOptions): Promise<OAuthResult> {
  void _options;
  return { kind: 'failure' };
}
