import type { OAuthFlowOptions } from '../zoom-oauth/flow.js';
import type { OAuthOutcome } from '../zoom-oauth/outcome.js';
import type { ObfResult } from './token.js';

export type ObfOutcome = ObfResult | {
  readonly kind: 'oauth_failed';
  readonly outcome: Exclude<OAuthOutcome, { readonly kind: 'succeeded' }>;
};

export interface ObfFlowOptions extends Omit<OAuthFlowOptions, 'onAccessToken'> {
  readonly obfUrl: string;
  readonly obfTimeoutMs: number;
}

export async function runObfFlow(_options: ObfFlowOptions): Promise<ObfOutcome> {
  void _options;
  return { kind: 'malformed' };
}
