// 検証プログラムを Docker で 1 回動かし、結果の判定と後始末までを行う。
// main.ts（入口）から使う。docker コマンドの名前・環境変数・時間の上限を外から渡せるようにして、
// テストでは PATH に置いた偽の docker で確かめる。
//
// 有限時間で終わること: docker run は上限＋猶予で止める（run.ts）。docker kill / ps / rm は
// 非同期に呼び、それぞれ上限を過ぎたら SIGKILL する。Docker が応答しなくても後始末は終わる。
// 中断では、自分が起動した docker の子プロセスがすべて終わってから終了コードを返す。

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProbeRequest } from './cli.js';
import { buildDockerKillArgs, buildDockerRunArgs, makeContainerName } from './docker.js';
import { classifyProbeRun, withCleanup, type CleanupResult, type ProbeOutcome } from './outcome.js';
import { runWithTimeout, type RunResult } from './run.js';

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
  /** docker kill を待つ上限。また docker kill のあと、docker run を強制終了するまでの猶予 */
  readonly killGraceMs: number;
  /** docker ps / rm を待つ上限 */
  readonly dockerCommandTimeoutMs: number;
  /** 利用者向けの進行表示（標準エラー） */
  readonly log: (line: string) => void;
}

export class SetupError extends Error {}

export interface ProbeSession {
  readonly runProbe: (request: ProbeRequest) => Promise<ProbeOutcome>;
  /** SIGINT / SIGTERM を受けたときの停止と後始末。終了コード（130 / 143）を返す */
  readonly interrupt: (signal: InterruptSignal) => Promise<number>;
}

export type InterruptSignal = 'SIGINT' | 'SIGTERM';

const INTERRUPT_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

interface DockerResult {
  /** 終了コード 0 で終わったか（上限超過・起動失敗は false） */
  readonly ok: boolean;
  readonly stdout: string;
}

export function createProbeSession(config: ProbeSessionConfig): ProbeSession {
  const { childEnv, log } = config;
  /** 起動中のコンテナ名（起動前・後始末後は undefined） */
  let activeContainer: string | undefined;
  /** 中断したら docker run のクライアントを止める */
  const abort = new AbortController();
  let interruption: Promise<number> | undefined;
  /** 実行中の docker run のクライアント（子プロセスの終了で settle する） */
  let activeRun: Promise<RunResult> | undefined;
  /** 実行中の docker kill / ps / rm（子プロセスの終了で resolve する） */
  const pendingDocker = new Set<Promise<DockerResult>>();

  /** docker を非同期に呼ぶ。上限を過ぎたら SIGKILL する。失敗しても例外にしない */
  function docker(args: readonly string[], timeoutMs: number): Promise<DockerResult> {
    const pending = new Promise<DockerResult>((resolveResult) => {
      // execFile のコールバックは子プロセスの終了（close）のあとに呼ばれる
      execFile(
        'docker',
        [...args],
        { env: { ...childEnv }, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL' },
        (error, stdout) => resolveResult({ ok: error === null, stdout }),
      );
    });
    pendingDocker.add(pending);
    void pending.then(() => pendingDocker.delete(pending));
    return pending;
  }

  /**
   * 自分が起動した docker の子プロセスがすべて終わるまで待つ。
   * 待っている間に通常の後始末が次の docker（rm・再確認）を呼ぶことがあるので、空になるまで繰り返す。
   * どの docker も上限を過ぎたら SIGKILL されるので、有限時間で終わる。
   */
  async function waitForDockerChildren(): Promise<void> {
    await activeRun?.catch(() => undefined);
    while (pendingDocker.size > 0) {
      await Promise.allSettled([...pendingDocker]);
    }
  }

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
    if (interruption !== undefined) return waitForever();

    const containerName = makeContainerName(config.containerPrefix, randomBytes(4).toString('hex'));
    const hostLimitSeconds =
      request.mode === 'auth' ? request.authTimeoutSeconds + config.hostMarginSeconds : config.initHostLimitSeconds;

    activeContainer = containerName;
    let result: RunResult;
    try {
      activeRun = runWithTimeout({
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
          await docker(buildDockerKillArgs(containerName), config.killGraceMs);
        },
        abortSignal: abort.signal,
      });
      result = await activeRun;
    } catch (error) {
      // 中断の後始末は interrupt が行い、終了コードも interrupt が決める
      if (interruption !== undefined) return waitForever();
      throw error;
    }
    if (interruption !== undefined) return waitForever();

    for (const line of probeProgressLines(result.stderr)) log(line);
    const cleanup = await ensureContainerRemoved(containerName);
    activeContainer = undefined;
    const outcome = classifyProbeRun({
      mode: request.mode,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      hostTimedOut: result.timedOut,
    });
    return withCleanup(outcome, cleanup);
  }

  /**
   * 同名のコンテナが残っていないことを確かめ、残っていれば削除してもう一度確かめる。
   * 最後の確認で残っていないと分かったときだけ、片付いたとする。
   */
  async function ensureContainerRemoved(containerName: string): Promise<CleanupResult> {
    const listArgs = ['ps', '-a', '-q', '--filter', `name=^/${containerName}$`];
    const uncheckable = `コンテナの残りを確認できませんでした: ${containerName}（docker ps -a で確かめてください）`;
    const listed = await docker(listArgs, config.dockerCommandTimeoutMs);
    if (!listed.ok) {
      log(uncheckable);
      return 'check_failed';
    }
    if (listed.stdout.trim() === '') {
      log(`コンテナは残っていません: ${containerName}`);
      return 'absent';
    }
    const removed = await docker(['rm', '-f', containerName], config.dockerCommandTimeoutMs);
    const recheck = await docker(listArgs, config.dockerCommandTimeoutMs);
    if (!recheck.ok) {
      log(uncheckable);
      return 'check_failed';
    }
    if (recheck.stdout.trim() !== '') {
      log(`コンテナを削除できませんでした: ${containerName}（docker rm -f ${containerName} で削除してください）`);
      return 'remove_failed';
    }
    // rm が失敗しても、--rm による削除が先に終わっていれば残りはない
    if (!removed.ok) {
      log(`コンテナは残っていません: ${containerName}`);
      return 'absent';
    }
    log(`残っていたコンテナを削除しました: ${containerName}`);
    return 'removed';
  }

  function interrupt(signal: InterruptSignal): Promise<number> {
    interruption ??= (async () => {
      log(`中断を受けました（${signal}）。検証プログラムを止めて後始末をします。`);
      const containerName = activeContainer;
      if (containerName !== undefined) {
        await docker(buildDockerKillArgs(containerName), config.killGraceMs);
      }
      abort.abort();
      if (containerName !== undefined) {
        const cleanup = await ensureContainerRemoved(containerName);
        if (cleanup === 'remove_failed' || cleanup === 'check_failed') {
          log('コンテナが残っている可能性があります。上の案内に従って確かめてください。');
        }
      }
      // 通常の後始末や時間切れの docker kill が並行して動いていれば、それも終わるのを待つ。
      // 終了コードを返したあとすぐ process.exit するため、待たないと子プロセスが残る
      await waitForDockerChildren();
      return INTERRUPT_EXIT_CODES[signal];
    })();
    return interruption;
  }

  return { runProbe, interrupt };
}

/** 中断の後は通常の結果を出さない（interrupt の終わりにプロセスを終了する） */
function waitForever(): Promise<never> {
  return new Promise<never>(() => undefined);
}

/**
 * 検証プログラムの標準エラーから、利用者に見せてよい行だけを取り出す。
 * 検証プログラム自身の進行表示（[probe] で始まる行）だけを見せ、SDK の他の出力は出さない。
 */
export function probeProgressLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('[probe] '));
}
