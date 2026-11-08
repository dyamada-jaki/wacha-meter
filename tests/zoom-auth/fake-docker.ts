// テスト用の偽の docker。PATH の先頭に置き、実物の docker CLI と同じく子プロセスとして呼ばれる。
// サブコマンド（run / kill / ps / rm）ごとの動きは、同じフォルダの <サブコマンド>.sh に sh で書く。
// 呼ばれた引数は calls.log に1行ずつ残る。CI に Docker と SDK が無いため、この境界だけを偽物にする。

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = `#!/bin/sh
dir=$(cd "$(dirname "$0")" && pwd)
printf '%s\\n' "$*" >> "$dir/calls.log"
if [ -f "$dir/$1.sh" ]; then . "$dir/$1.sh"; fi
exit 0
`;

export interface FakeDocker {
  /** 偽の docker を置いたフォルダ（状態ファイルもここに置く） */
  readonly dir: string;
  /** 偽の docker を先頭に置いた PATH */
  readonly path: string;
  /** SDK・検証プログラムの置き場所（中身は空のファイル） */
  readonly sdkDir: string;
  readonly probeBuildDir: string;
  /** サブコマンドの動きを sh で決める */
  readonly on: (subcommand: 'run' | 'kill' | 'ps' | 'rm', body: string) => void;
  /** 呼ばれた docker の引数（1回ごとに1行） */
  readonly calls: () => string[];
  /** docker run に渡したコンテナ名 */
  readonly containerName: () => string | undefined;
  readonly cleanup: () => void;
}

export function createFakeDocker(): FakeDocker {
  const root = mkdtempSync(join(tmpdir(), 'wacha-fake-docker-'));
  const dir = join(root, 'bin');
  const sdkDir = join(root, 'sdk');
  const probeBuildDir = join(root, 'probe');
  for (const d of [dir, sdkDir, probeBuildDir]) mkdirSync(d);
  writeFileSync(join(sdkDir, 'libmeetingsdk.so'), '');
  writeFileSync(join(probeBuildDir, 'wacha-zoom-auth-probe'), '');
  writeFileSync(join(dir, 'docker'), SCRIPT);
  chmodSync(join(dir, 'docker'), 0o755);

  const calls = (): string[] => {
    const file = join(dir, 'calls.log');
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l !== '') : [];
  };
  return {
    dir,
    path: `${dir}:${process.env.PATH ?? ''}`,
    sdkDir,
    probeBuildDir,
    on: (subcommand, body) => writeFileSync(join(dir, `${subcommand}.sh`), body),
    calls,
    containerName: () => {
      const run = calls().find((c) => c.startsWith('run '));
      return run?.split(' ')[run.split(' ').indexOf('--name') + 1];
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** 条件が成り立つまで待つ（上限つき） */
export async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('待ち時間を超えました');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** プロセスがまだ生きているか（シグナル 0 で確かめる） */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const INIT_SUCCEEDED = `echo 'WACHA_PROBE_RESULT {"mode":"init","outcome":"succeeded"}'`;
