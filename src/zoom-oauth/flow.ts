// OAuth（Public Client + PKCE S256 + state + loopback）の流れを1回行う。
// 127.0.0.1 の一時ポートで待ち受け、ブラウザで認可画面を開き、/callback の応答を待つ。
// 成功・失敗・時間切れ・中断のどれでも待受を閉じてから、認可コードをトークンに交換する。

import type { OAuthOutcome } from './outcome.js';

export interface OAuthFlowOptions {
  readonly clientId: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  /** 認可の応答を待つ上限 */
  readonly timeoutMs: number;
  /** トークン要求の上限 */
  readonly tokenTimeoutMs: number;
  /** 認可 URL をブラウザで開く。失敗したら reject する */
  readonly openBrowser: (url: string) => Promise<void>;
  /** 中断 */
  readonly signal?: AbortSignal;
  /** 利用者向けの進行表示 */
  readonly log: (line: string) => void;
  /** 待受を始めたとき（テストでポートを知るため） */
  readonly onListening?: (address: { readonly address: string; readonly port: number }) => void;
}

export function runOAuthFlow(_options: OAuthFlowOptions): Promise<OAuthOutcome> {
  throw new Error('未実装');
}
