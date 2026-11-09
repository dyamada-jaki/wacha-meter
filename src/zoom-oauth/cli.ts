// Zoom アカウント連携（OAuth）の確認コマンド。
// 引数と Public Client ID を確かめ、OAuth の流れを1回行い、結果と終了コードを返す。
// 会議への参加・OBF の取得・トークンの保存は行わない。

import type { OAuthOutcome } from './outcome.js';

export const PUBLIC_CLIENT_ID_VARIABLE = 'ZOOM_OAUTH_CLIENT_ID';
export const DEFAULT_TIMEOUT_SECONDS = 180;
export const MIN_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 600;

export interface OAuthRequest {
  readonly clientId: string;
  readonly timeoutSeconds: number;
}

export interface CliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runFlow: (request: OAuthRequest) => Promise<OAuthOutcome>;
  readonly write: (line: string) => void;
}

export function runCli(_argv: readonly string[], _deps: CliDeps): Promise<number> {
  throw new Error('未実装');
}
