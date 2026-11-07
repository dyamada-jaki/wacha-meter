// わちゃメーターの Zoom SDK 初期化・認証の検証コマンド。
//   init: SDK の初期化と後始末だけを行う（認証情報は不要）
//   auth: 認証情報から JWT を作り、SDK 認証の結果を確かめる
// 会議への参加・音声取得・録音は行わない。

import type { ProbeMode, ProbeOutcome } from './outcome.js';

export interface ProbeRequest {
  readonly mode: ProbeMode;
  /** auth のときだけ。標準入力で検証プログラムへ渡す */
  readonly jwt?: string;
  readonly authTimeoutSeconds: number;
  readonly offline: boolean;
}

export interface CliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 現在時刻（UNIX 秒） */
  readonly now: () => number;
  readonly runProbe: (request: ProbeRequest) => Promise<ProbeOutcome>;
  readonly write: (line: string) => void;
}

export const DEFAULT_AUTH_TIMEOUT_SECONDS = 30;

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  void argv;
  void deps;
  throw new Error('未実装');
}
