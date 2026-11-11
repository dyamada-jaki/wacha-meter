// 実Nodeプロセスの入口を確認する。openとZoom HTTPSだけを偽物にし、本物のZoomには接続しない。
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BAD_REQUEST_TARGET, FAKE_BAD_TARGET_SECRET, connectionRefused, sendRawRequest } from '../zoom-oauth/fake-zoom.js';

const ID = 'fake-obf-main-public-id-M3';
const ACCESS = 'fake-obf-main-access-P4';
const REFRESH = 'fake-obf-main-refresh-T6';
const OBF = 'fake-obf-main-token-A8';
const MESSAGE = 'fake-obf-main-message-C5';
let outDir: string;
let binDir: string;
let openLog: string;
let preload: string;
interface MainProcess { child: ChildProcess; exited: Promise<number | null>; output: () => string }
const children: MainProcess[] = [];

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'wacha-obf-build-'));
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--outDir', outDir, '--declaration', 'false', '--sourceMap', 'false'], { stdio: 'inherit' });
}, 60000);
afterAll(() => rmSync(outDir, { recursive: true, force: true }));
beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), 'wacha-obf-open-'));
  openLog = join(binDir, 'open.log');
  writeFileSync(join(binDir, 'open'), `#!/bin/sh\nprintf '%s\\n' "$1" >> "${openLog}"\nexit 0\n`);
  chmodSync(join(binDir, 'open'), 0o755);
  preload = join(binDir, 'fake-zoom.mjs');
  // fetch先を書き換えるテスト専用preload。製品にテスト用URL/env設定を追加しない。
  writeFileSync(preload, `
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (url === 'https://zoom.us/oauth/token' && init.method === 'POST') {
    return new Response(JSON.stringify({ access_token: '${ACCESS}', refresh_token: '${REFRESH}', token_type: 'bearer', expires_in: 3599, scope: '${MESSAGE}' }));
  }
  if (url === 'https://api.zoom.us/v2/users/me/token?type=onbehalf' && init.method === 'GET' && new Headers(init.headers).get('authorization') === 'Bearer ${ACCESS}') {
    if (process.env.FAKE_OBF_MODE === 'hold') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('${MESSAGE}')), { once: true }));
    return new Response(JSON.stringify({ token: '${OBF}', code: 124, message: '${MESSAGE}' }), { status: process.env.FAKE_OBF_MODE === 'fail' ? 401 : 200 });
  }
  if (new URL(url).hostname !== '127.0.0.1') throw new Error('${MESSAGE}');
  return originalFetch(url, init);
};`);
});
afterEach(async () => {
  for (const main of children.splice(0)) {
    if (main.child.exitCode === null) main.child.kill('SIGKILL');
    await main.exited;
  }
  rmSync(binDir, { recursive: true, force: true });
});

function startMain(env: Record<string, string> = { ZOOM_OAUTH_CLIENT_ID: ID }, argv: string[] = []): MainProcess {
  const child = spawn(process.execPath, ['--import', preload, join(outDir, 'zoom-obf/main.js'), ...argv], {
    env: { PATH: `${binDir}:${process.env.PATH ?? ''}`, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (data: string) => (output += data));
  child.stderr.setEncoding('utf8').on('data', (data: string) => (output += data));
  const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
  const main = { child, exited, output: () => output };
  children.push(main);
  return main;
}

async function opened(main: ReturnType<typeof startMain>): Promise<URL | undefined> {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (existsSync(openLog) && readFileSync(openLog, 'utf8').trim()) return new URL(readFileSync(openLog, 'utf8').trim());
    if (main.child.exitCode !== null) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return undefined;
}

function noSecrets(output: string) {
  for (const secret of [ID, ACCESS, REFRESH, OBF, MESSAGE, FAKE_BAD_TARGET_SECRET]) expect(output).not.toContain(secret);
}

async function approve(authorize: URL) {
  const redirect = new URL(authorize.searchParams.get('redirect_uri')!);
  redirect.searchParams.set('state', authorize.searchParams.get('state')!);
  redirect.searchParams.set('code', 'dummy-main-authorization-code');
  const response = await fetch(redirect);
  noSecrets(await response.text());
  return Number(redirect.port);
}

describe('zoom-obf main 実プロセス', () => {
  it('設定なしは2、ブラウザを開かない', async () => {
    const main = startMain({});
    expect(await main.exited).toBe(2);
    expect(existsSync(openLog)).toBe(false);
    expect(main.output()).toContain('.local/zoom-oauth.env');
  });

  it.each([['ok', 0], ['fail', 1]] as const)('OAuth許可からOBF %sまで実行し終了%s、秘密を表示せず後始末する', async (mode, code) => {
    const main = startMain({ ZOOM_OAUTH_CLIENT_ID: ID, FAKE_OBF_MODE: mode });
    const authorize = await opened(main);
    expect(authorize).toBeDefined();
    if (!authorize) return;
    const port = await approve(authorize);
    expect(await main.exited).toBe(code);
    expect(await connectionRefused(port)).toBe(true);
    noSecrets(main.output());
    expect(main.output()).not.toContain('dummy-main-authorization-code');
    if (mode === 'ok') expect(main.output()).toContain('OBF トークンを取得しました');
    else expect(main.output()).toContain('HTTP 401 code 124');
  });

  it.each([['SIGINT', 130], ['SIGTERM', 143]] as const)('待受中%sで閉じて%s、不正URLも400で継続（#4 R1）', async (signal, code) => {
    const main = startMain();
    const authorize = await opened(main);
    expect(authorize).toBeDefined();
    if (!authorize) return;
    const port = Number(new URL(authorize.searchParams.get('redirect_uri')!).port);
    expect((await sendRawRequest(port, BAD_REQUEST_TARGET))?.status).toBe(400);
    expect(main.child.exitCode).toBeNull();
    main.child.kill(signal);
    expect(await main.exited).toBe(code);
    expect(await connectionRefused(port)).toBe(true);
    noSecrets(main.output());
  });

  it.each([['SIGINT', 130], ['SIGTERM', 143]] as const)('OBF要求中%sでも成功とせず%s', async (signal, code) => {
    const main = startMain({ ZOOM_OAUTH_CLIENT_ID: ID, FAKE_OBF_MODE: 'hold' });
    const authorize = await opened(main);
    expect(authorize).toBeDefined();
    if (!authorize) return;
    const port = await approve(authorize);
    const start = Date.now();
    while (!main.output().includes('OBF トークンを要求します') && Date.now() - start < 3000) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(main.output()).toContain('OBF トークンを要求します');
    main.child.kill(signal);
    expect(await main.exited).toBe(code);
    expect(await connectionRefused(port)).toBe(true);
    expect(main.output()).not.toContain('OBF トークンを取得しました');
    noSecrets(main.output());
  });
});
