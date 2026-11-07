// 検証コマンドの入口（main.js）を実際のプロセスとして起動し、中断のシグナルを送る。
// docker は PATH に置いた偽物。実物の docker / SDK での中断は手元で確かめる（PR に記録）。
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFakeDocker, waitFor, type FakeDocker } from './fake-docker.js';

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
});
