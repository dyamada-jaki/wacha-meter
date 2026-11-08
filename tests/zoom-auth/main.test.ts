// 検証コマンドの入口（main.js）を実際のプロセスとして起動し、中断のシグナルを送る。
// docker は PATH に置いた偽物。実物の docker / SDK での中断は手元で確かめる（PR に記録）。
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeDocker, INIT_SUCCEEDED, processAlive, waitFor, type FakeDocker } from './fake-docker.js';

let outDir: string;
let fake: FakeDocker;

beforeAll(() => {
  // src は .js の拡張子で import しているため、tsc で一時フォルダへビルドしてから動かす
  outDir = mkdtempSync(join(tmpdir(), 'wacha-main-build-'));
  execFileSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--outDir', outDir, '--declaration', 'false', '--sourceMap', 'false'],
    { stdio: 'inherit' },
  );
}, 60000);
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

beforeEach(() => {
  fake = createFakeDocker();
});
afterEach(() => fake.cleanup());

function startMain(args: string[]) {
  const child = spawn(process.execPath, [join(outDir, 'zoom-auth/main.js'), ...args], {
    env: {
      PATH: fake.path,
      WACHA_ZOOM_SDK_DIR: fake.sdkDir,
      WACHA_ZOOM_PROBE_BUILD_DIR: fake.probeBuildDir,
      WACHA_ZOOM_CONTAINER_PREFIX: 'wacha-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (output += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (output += d));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) =>
    child.on('exit', (code, signal) => r({ code, signal })),
  );
  return { child, exited, output: () => output };
}

describe('検証コマンドの中断', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('%s を受けたら、自分のコンテナを kill して残りを確かめ、%i で終了する', async (signal, code) => {
    fake.on('run', 'exec sleep 8');
    const main = startMain(['init']);
    await waitFor(() => fake.calls().some((c) => c.startsWith('run ')));
    const name = fake.containerName();
    main.child.kill(signal);
    const result = await main.exited;
    expect(result).toEqual({ code, signal: null });
    const calls = fake.calls();
    const killIndex = calls.indexOf(`kill ${name}`);
    expect(killIndex).toBeGreaterThan(0);
    expect(calls.slice(killIndex + 1).some((c) => c.startsWith('ps ') && c.includes(`^/${name}$`))).toBe(true);
  }, 20000);

  it('後始末の途中で2回目の SIGINT が来ても、後始末を終えてから 130 で終了する', async () => {
    fake.on('run', 'exec sleep 8');
    fake.on('kill', 'sleep 1');
    const main = startMain(['init']);
    await waitFor(() => fake.calls().some((c) => c.startsWith('run ')));
    main.child.kill('SIGINT');
    await waitFor(() => fake.calls().some((c) => c.startsWith('kill ')));
    main.child.kill('SIGINT');
    const result = await main.exited;
    expect(result).toEqual({ code: 130, signal: null });
    expect(fake.calls().some((c) => c.startsWith('ps '))).toBe(true);
  }, 20000);

  it('通常の後始末で docker ps を待っている間に中断しても、その docker ps が終わってから 130 で終了する', async () => {
    fake.on('run', INIT_SUCCEEDED);
    // 通常の後始末で呼ばれる1回目の ps だけが応答に時間がかかる。以降の ps はすぐ「残りなし」を返す
    fake.on('ps', 'if [ ! -f "$dir/ps.pid" ]; then echo $$ > "$dir/ps.pid"; exec sleep 2; fi');
    const main = startMain(['init']);
    await waitFor(() => existsSync(join(fake.dir, 'ps.pid')));
    const psPid = Number(readFileSync(join(fake.dir, 'ps.pid'), 'utf8'));
    const started = Date.now();
    main.child.kill('SIGINT');
    const result = await main.exited;
    expect(result).toEqual({ code: 130, signal: null });
    // 終了した時点で、自分が起動した docker の子プロセスは残っていない（待たずに確かめる）
    expect(processAlive(psPid)).toBe(false);
    // docker ps / rm の上限（10 秒）を待たずに終わる
    expect(Date.now() - started).toBeLessThan(8000);
  }, 20000);
});

describe('SDK の既定の場所', () => {
  it('WACHA_ZOOM_SDK_DIR がなければ、作業フォルダの .local/zoom-sdk/7.2.1.5860 を読み取り専用でマウントする', async () => {
    const work = realpathSync(mkdtempSync(join(tmpdir(), 'wacha-main-cwd-')));
    try {
      const sdkDir = join(work, '.local/zoom-sdk/7.2.1.5860');
      mkdirSync(sdkDir, { recursive: true });
      writeFileSync(join(sdkDir, 'libmeetingsdk.so'), '');
      fake.on('run', INIT_SUCCEEDED);
      const child = spawn(process.execPath, [join(outDir, 'zoom-auth/main.js'), 'init'], {
        cwd: work,
        env: {
          PATH: fake.path,
          WACHA_ZOOM_PROBE_BUILD_DIR: fake.probeBuildDir,
          WACHA_ZOOM_CONTAINER_PREFIX: 'wacha-test',
        },
        stdio: 'ignore',
      });
      const code = await new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
      expect(code).toBe(0);
      const run = fake.calls().find((c) => c.startsWith('run '));
      expect(run).toContain(`${sdkDir}:/opt/zoom-sdk:ro`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 20000);
});
