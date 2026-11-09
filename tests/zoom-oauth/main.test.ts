// 入口（main.js）を実際のプロセスとして起動する。ブラウザを開く `open` は PATH に置いた偽物で、
// 受け取った認可 URL をファイルに残すだけ（Zoom には接続しない）。
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectionRefused } from './fake-zoom.js';

const PUBLIC_ID = 'main-test-public-client-id-R4t';

let outDir: string;
let binDir: string;
let openLog: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'wacha-oauth-build-'));
  execFileSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--outDir', outDir, '--declaration', 'false', '--sourceMap', 'false'],
    { stdio: 'inherit' },
  );
}, 60000);
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), 'wacha-fake-open-'));
  openLog = join(binDir, 'open.log');
  writeFileSync(join(binDir, 'open'), `#!/bin/sh\nprintf '%s\\n' "$1" >> "${openLog}"\nexit 0\n`);
  chmodSync(join(binDir, 'open'), 0o755);
});
afterEach(() => rmSync(binDir, { recursive: true, force: true }));

function startMain(env: Record<string, string>, args: string[] = []) {
  const child = spawn(process.execPath, [join(outDir, 'zoom-oauth/main.js'), ...args], {
    env: { PATH: `${binDir}:${process.env.PATH ?? ''}`, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (output += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (output += d));
  const exited = new Promise<number | null>((r) => child.on('close', (code) => r(code)));
  return { child, exited, output: () => output };
}

async function waitForOpen(timeoutMs = 5000): Promise<URL> {
  const started = Date.now();
  while (!existsSync(openLog) || readFileSync(openLog, 'utf8').trim() === '') {
    if (Date.now() - started > timeoutMs) throw new Error('ブラウザが開かれませんでした');
    await new Promise((r) => setTimeout(r, 20));
  }
  return new URL(readFileSync(openLog, 'utf8').trim().split('\n')[0] ?? '');
}

describe('zoom-oauth main', () => {
  it('Public Client ID が無ければ、ブラウザを開かずに終了コード 2', async () => {
    const main = startMain({});
    expect(await main.exited).toBe(2);
    expect(existsSync(openLog)).toBe(false);
    expect(main.output()).toContain('ZOOM_OAUTH_CLIENT_ID');
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('待機中の %s で、待受を閉じて終了コード %s', async (signal, code) => {
    const main = startMain({ ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID });
    const authorize = await waitForOpen();
    const redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '');
    expect(redirect.hostname).toBe('127.0.0.1');
    expect(authorize.origin + authorize.pathname).toBe('https://zoom.us/oauth/authorize');
    main.child.kill(signal);
    expect(await main.exited).toBe(code);
    expect(await connectionRefused(Number(redirect.port))).toBe(true);
    // 認可 URL（Client ID を含む）を画面に出さない
    expect(main.output()).not.toContain(PUBLIC_ID);
    expect(main.output()).toContain('中断');
  }, 15000);
});
