import { runOAuthFlow, type OAuthFlowOptions } from '../zoom-oauth/flow.js';
import type { OAuthOutcome } from '../zoom-oauth/outcome.js';
import { requestObfToken, type ObfResult } from './token.js';

export type ObfOutcome = ObfResult | {
  readonly kind: 'oauth_failed';
  readonly outcome: Exclude<OAuthOutcome, { readonly kind: 'succeeded' }>;
};

export interface ObfFlowOptions extends Omit<OAuthFlowOptions, 'onAccessToken'> {
  readonly obfUrl: string;
  readonly obfTimeoutMs: number;
}

/** 待受を閉じ、OAuth交換後の接続点でOBFを要求する。トークンは結果へ返さない。 */
export async function runObfFlow(options: ObfFlowOptions): Promise<ObfOutcome> {
  let obf: ObfResult | undefined;
  const oauth = await runOAuthFlow({
    ...options,
    onAccessToken: async (accessToken) => {
      options.log('OAuth の認可を確認しました。OBF トークンを要求します。');
      obf = await requestObfToken({
        url: options.obfUrl, accessToken, timeoutMs: options.obfTimeoutMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    },
  });
  if (oauth.kind !== 'succeeded') return { kind: 'oauth_failed', outcome: oauth };
  if (options.signal?.aborted === true) return { kind: 'interrupted' };
  return obf ?? { kind: 'malformed' };
}
