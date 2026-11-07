// 検証プログラムを Docker（linux/arm64）で動かすための引数と環境変数を作る。
// JWT・Secret は引数にも環境変数にも載せない（JWT は標準入力で渡す）。

import type { ProbeMode } from './outcome.js';

export const DEFAULT_IMAGE = 'wacha-meter-zoom-dev:local';
export const DEFAULT_CONTAINER_PREFIX = 'wacha-meter-zoom-auth';

export interface DockerRunOptions {
  readonly image: string;
  readonly containerName: string;
  /** 展開済み SDK のホスト側の絶対パス */
  readonly sdkDir: string;
  /** 検証プログラムのビルド結果のホスト側の絶対パス */
  readonly probeBuildDir: string;
  readonly mode: ProbeMode;
  /** auth の SDK 側の待ち時間（秒） */
  readonly authTimeoutSeconds: number;
  /** true ならコンテナのネットワークを切る（時間切れの確認用） */
  readonly offline: boolean;
}

export function buildDockerRunArgs(options: DockerRunOptions): string[] {
  void options;
  throw new Error('未実装');
}

export function buildDockerKillArgs(containerName: string): string[] {
  void containerName;
  throw new Error('未実装');
}

/** docker CLI に渡す環境変数。Docker の接続に必要なものだけを残す。 */
export function buildChildEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  void env;
  throw new Error('未実装');
}

export function makeContainerName(prefix: string, suffix: string): string {
  void prefix;
  void suffix;
  throw new Error('未実装');
}
