// 検証プログラムを Docker で 1 回動かし、結果の判定と後始末までを行う。
// main.ts（入口）から使う。docker コマンドの名前・環境変数・時間の上限を外から渡せるようにして、
// テストでは PATH に置いた偽の docker で確かめる。

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProbeRequest } from './cli.js';
import { buildDockerKillArgs, buildDockerRunArgs, makeContainerName } from './docker.js';
import { classifyProbeRun, type ProbeOutcome } from './outcome.js';
import { runWithTimeout } from './run.js';

export interface ProbeSessionConfig {
  readonly sdkDir: string;
  readonly probeBuildDir: string;
  readonly image: string;
  readonly containerPrefix: string;
  /** docker CLI に渡す環境変数（buildChildEnv の結果） */
  readonly childEnv: Readonly<Record<string, string>>;
  /** SDK 側の待ち時間に足す、ホスト側の余裕（秒） */
  readonly hostMarginSeconds: number;
  /** init のホスト側の上限（秒） */
  readonly initHostLimitSeconds: number;
  /** docker kill のあと、docker コマンドを強制終了するまでの猶予 */
  readonly killGraceMs: number;
  /** 利用者向けの進行表示（標準エラー） */
  readonly log: (line: string) => void;
}

export class SetupError extends Error {}

export interface ProbeSession {
  readonly runProbe: (request: ProbeRequest) => Promise<ProbeOutcome>;
}

export function createProbeSession(config: ProbeSessionConfig): ProbeSession {
  const { childEnv, log } = config;

  async function runProbe(request: ProbeRequest): Promise<ProbeOutcome> {
    if (!existsSync(resolve(config.sdkDir, 'libmeetingsdk.so'))) {
      throw new SetupError(
        `SDK が見つかりません: ${config.sdkDir}（prototypes/zoom/scripts/prepare-sdk.sh で展開してください）`,
      );
    }
    if (!existsSync(resolve(config.probeBuildDir, 'wacha-zoom-auth-probe'))) {
      throw new SetupError(
        `検証プログラムが見つかりません: ${config.probeBuildDir}（prototypes/zoom/scripts/build-probe.sh でビルドしてください）`,
      );
    }
    const containerName = makeContainerName(config.containerPrefix, randomBytes(4).toString('hex'));
    const hostLimitSeconds =
      request.mode === 'auth' ? request.authTimeoutSeconds + config.hostMarginSeconds : config.initHostLimitSeconds;

    const result = await runWithTimeout({
      command: 'docker',
      args: buildDockerRunArgs({
        image: config.image,
        containerName,
        sdkDir: config.sdkDir,
        probeBuildDir: config.probeBuildDir,
        mode: request.mode,
        authTimeoutSeconds: request.authTimeoutSeconds,
        offline: request.offline,
      }),
      env: childEnv,
      ...(request.jwt === undefined ? {} : { stdin: `${request.jwt}\n` }),
      timeoutMs: hostLimitSeconds * 1000,
      killGraceMs: config.killGraceMs,
      onTimeout: async () => {
        spawnSync('docker', buildDockerKillArgs(containerName), { env: childEnv, stdio: 'ignore' });
      },
    });

    for (const line of probeProgressLines(result.stderr)) log(line);
    ensureContainerRemoved(containerName);
    return classifyProbeRun({
      mode: request.mode,
      exitCode: result.exitCode,
      stdout: result.stdout,
      hostTimedOut: result.timedOut,
    });
  }

  /** 終了後に同名のコンテナが残っていないことを確かめ、残っていれば削除して知らせる。 */
  function ensureContainerRemoved(containerName: string): void {
    const listed = spawnSync('docker', ['ps', '-a', '-q', '--filter', `name=^/${containerName}$`], {
      env: childEnv,
      encoding: 'utf8',
    });
    if (listed.status !== 0) {
      log(`コンテナの残りを確認できませんでした: ${containerName}`);
      return;
    }
    if (listed.stdout.trim() === '') {
      log(`コンテナは残っていません: ${containerName}`);
      return;
    }
    spawnSync('docker', ['rm', '-f', containerName], { env: childEnv, stdio: 'ignore' });
    log(`残っていたコンテナを削除しました: ${containerName}`);
  }

  return { runProbe };
}

/**
 * 検証プログラムの標準エラーから、利用者に見せてよい行だけを取り出す。
 * 検証プログラム自身の進行表示（[probe] で始まる行）だけを見せ、SDK の他の出力は出さない。
 */
export function probeProgressLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('[probe] '));
}
