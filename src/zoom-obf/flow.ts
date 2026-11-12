// OAuth（zoom-oauth の流れ）でアクセストークンを得て、同じプロセスの中で OBF を要求する。
// アクセストークンは後続処理の引数として渡すだけで、戻り値・表示に含めない。
// 待受は zoom-oauth の流れがトークン要求の前に閉じるので、OBF の要求中には残っていない。

import { runOAuthFlow, type OAuthFlowOptions } from '../zoom-oauth/flow.js';
import { requestObfToken, type ObfResult } from './obf.js';
import { toObfOutcome, type ObfOutcome } from './outcome.js';

export interface ObfFlowOptions extends Omit<OAuthFlowOptions, 'useAccessToken'> {
  /** OBF の要求先（本番は ZOOM_OBF_URL） */
  readonly obfUrl: string;
  /** OBF 要求の上限 */
  readonly obfTimeoutMs: number;
}

export async function runObfFlow(options: ObfFlowOptions): Promise<ObfOutcome> {
  const { obfUrl, obfTimeoutMs, ...oauth } = options;
  const outcome = await runOAuthFlow<ObfResult>({
    ...oauth,
    useAccessToken: (accessToken, signal) => {
      options.log('OAuth トークンを取得しました。OBF トークンを要求します（会議番号なし）。');
      return requestObfToken({
        url: obfUrl,
        accessToken,
        timeoutMs: obfTimeoutMs,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  });
  return toObfOutcome(outcome);
}
