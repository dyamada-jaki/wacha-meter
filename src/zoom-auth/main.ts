// 検証コマンドの入口。実際の Docker と検証プログラムにつなぐ。
// 例: npm run zoom:init / npm run zoom:auth -- --timeout 30

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runCli, type ProbeRequest } from './cli.js';
import {
  buildChildEnv,
  buildDockerKillArgs,
  buildDockerRunArgs,
  DEFAULT_CONTAINER_PREFIX,
  DEFAULT_IMAGE,
  makeContainerName,
} from './docker.js';
import { classifyProbeRun, EXIT_CODES, type ProbeOutcome } from './outcome.js';
import { runWithTimeout } from './run.js';

/** SDK 側の待ち時間に足す、ホスト側の余裕（秒） */
const HOST_MARGIN_SECONDS = 15;
/** init のホスト側の上限（秒） */
const INIT_HOST_LIMIT_SECONDS = 30 + HOST_MARGIN_SECONDS;
const KILL_GRACE_MS = 5000;

const env = process.env;
const sdkDir = resolve(env.WACHA_ZOOM_SDK_DIR ?? '.local/zoom-sdk/7.1.5.4434');
const probeBuildDir = resolve(env.WACHA_ZOOM_PROBE_BUILD_DIR ?? '.local/zoom-auth-probe/build');
const image = env.WACHA_ZOOM_IMAGE ?? DEFAULT_IMAGE;
const containerPrefix = env.WACHA_ZOOM_CONTAINER_PREFIX ?? DEFAULT_CONTAINER_PREFIX;
const childEnv = buildChildEnv(env);

class SetupError extends Error {}

async function runProbe(request: ProbeRequest): Promise<ProbeOutcome> {
  if (!existsSync(resolve(sdkDir, 'libmeetingsdk.so'))) {
    throw new SetupError(`SDK が見つかりません: ${sdkDir}（prototypes/zoom/scripts/prepare-sdk.sh で展開してください）`);
  }
  if (!existsSync(resolve(probeBuildDir, 'wacha-zoom-auth-probe'))) {
    throw new SetupError(
      `検証プログラムが見つかりません: ${probeBuildDir}（prototypes/zoom/scripts/build-probe.sh でビルドしてください）`,
    );
  }
  const containerName = makeContainerName(containerPrefix, randomBytes(4).toString('hex'));
  const hostLimitSeconds =
    request.mode === 'auth' ? request.authTimeoutSeconds + HOST_MARGIN_SECONDS : INIT_HOST_LIMIT_SECONDS;

  const result = await runWithTimeout({
    command: 'docker',
    args: buildDockerRunArgs({
      image,
      containerName,
      sdkDir,
      probeBuildDir,
      mode: request.mode,
      authTimeoutSeconds: request.authTimeoutSeconds,
      offline: request.offline,
    }),
    env: childEnv,
    ...(request.jwt === undefined ? {} : { stdin: `${request.jwt}\n` }),
    timeoutMs: hostLimitSeconds * 1000,
    killGraceMs: KILL_GRACE_MS,
    onTimeout: async () => {
      spawnSync('docker', buildDockerKillArgs(containerName), { env: childEnv, stdio: 'ignore' });
    },
  });

  // 検証プログラム自身の進行表示（[probe] で始まる行）だけを見せる。SDK の他の出力は出さない
  for (const line of result.stderr.split('\n')) {
    if (line.startsWith('[probe] ')) console.error(line);
  }
  ensureContainerRemoved(containerName);
  return classifyProbeRun({ mode: request.mode, exitCode: result.exitCode, stdout: result.stdout, hostTimedOut: result.timedOut });
}

/** 終了後に同名のコンテナが残っていないことを確かめ、残っていれば削除して知らせる。 */
function ensureContainerRemoved(containerName: string): void {
  const listed = spawnSync('docker', ['ps', '-a', '-q', '--filter', `name=^/${containerName}$`], {
    env: childEnv,
    encoding: 'utf8',
  });
  if (listed.status !== 0) {
    console.error(`コンテナの残りを確認できませんでした: ${containerName}`);
    return;
  }
  if (listed.stdout.trim() === '') {
    console.error(`コンテナは残っていません: ${containerName}`);
    return;
  }
  spawnSync('docker', ['rm', '-f', containerName], { env: childEnv, stdio: 'ignore' });
  console.error(`残っていたコンテナを削除しました: ${containerName}`);
}

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    env,
    now: () => Math.floor(Date.now() / 1000),
    runProbe,
    write: (line) => console.log(line),
  });
} catch (error) {
  console.error(error instanceof SetupError ? error.message : `検証コマンドが失敗しました: ${String(error)}`);
  process.exitCode = error instanceof SetupError ? EXIT_CODES.config : EXIT_CODES.other;
}
