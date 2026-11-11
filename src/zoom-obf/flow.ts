// OAuth（zoom-oauth の流れ）でアクセストークンを得て、同じプロセスの中で OBF を要求する。
// アクセストークンは後続処理の引数として渡すだけで、戻り値・表示に含めない。

import type { OAuthFlowOptions } from '../zoom-oauth/flow.js';
import type { ObfOutcome } from './outcome.js';

export interface ObfFlowOptions extends Omit<OAuthFlowOptions, 'useAccessToken'> {
  /** OBF の要求先（本番は ZOOM_OBF_URL） */
  readonly obfUrl: string;
  /** OBF 要求の上限 */
  readonly obfTimeoutMs: number;
}

export function runObfFlow(_options: ObfFlowOptions): Promise<ObfOutcome> {
  throw new Error('未実装');
}
