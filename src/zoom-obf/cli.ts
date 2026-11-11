// OBF 取得確認コマンド。引数と Public Client ID を確かめ、OAuth → OBF の流れを1回行い、結果と終了コードを返す。
// 引数・設定の扱いは zoom:oauth と同じ（.local/zoom-oauth.env の ZOOM_OAUTH_CLIENT_ID）。

import type { OAuthRequest } from '../zoom-oauth/cli.js';
import type { ObfOutcome } from './outcome.js';

export interface ObfCliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runFlow: (request: OAuthRequest) => Promise<ObfOutcome>;
  readonly write: (line: string) => void;
}

export function runObfCli(_argv: readonly string[], _deps: ObfCliDeps): Promise<number> {
  throw new Error('未実装');
}
