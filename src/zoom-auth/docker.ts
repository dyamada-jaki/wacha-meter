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

/** コンテナ内の検証プログラムのパス */
export const PROBE_PATH_IN_CONTAINER = '/opt/zoom-auth-probe/wacha-zoom-auth-probe';

export function buildDockerRunArgs(options: DockerRunOptions): string[] {
  return [
    'run',
    '--rm',
    '-i',
    '--platform',
    'linux/arm64',
    '--name',
    options.containerName,
    ...(options.offline ? ['--network', 'none'] : []),
    '-v',
    `${options.sdkDir}:/opt/zoom-sdk:ro`,
    '-v',
    `${options.probeBuildDir}:/opt/zoom-auth-probe:ro`,
    options.image,
    PROBE_PATH_IN_CONTAINER,
    options.mode,
    ...(options.mode === 'auth' ? [String(options.authTimeoutSeconds)] : []),
  ];
}

export function buildDockerKillArgs(containerName: string): string[] {
  return ['kill', containerName];
}

const CHILD_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'TMPDIR',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
] as const;

/** docker CLI に渡す環境変数。Docker の接続に必要なものだけを残す。 */
export function buildChildEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of CHILD_ENV_ALLOWLIST) {
    const value = env[name];
    if (value !== undefined) result[name] = value;
  }
  return result;
}

export function makeContainerName(prefix: string, suffix: string): string {
  return `${prefix}-${suffix}`;
}
