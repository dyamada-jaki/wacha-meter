// 入口（zoom-obf/main.js）を実際のプロセスとして起動する。ブラウザを開く `open` は PATH に置いた偽物で、
// 受け取った認可 URL をファイルに残すだけ（Zoom には接続しない）。
// OBF まで進めるテストでは、テスト専用の preload（node --import）で本番 URL への fetch だけを差し替える。
// 製品コードにはテスト用の設定（環境変数・URL の切り替え）を足さない。
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BAD_REQUEST_TARGET, connectionRefused, FAKE_BAD_TARGET_SECRET, sendRawRequest } from '../zoom-oauth/fake-zoom.js';

const PUBLIC_ID = 'obf-main-public-client-id-J6w';
const ACCESS = 'obf-main-access-token-D3q';
const REFRESH = 'obf-main-refresh-token-S5t';
const OBF = 'obf-main-obf-token-G1v';
const MESSAGE = 'obf-main-message-X0k';
const CODE = 'obf-main-authorization-code-B7y';

let outDir: string;
let binDir: string;
let openLog: string;
let preload: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'wacha-obf-build-'));
  execFileSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--outDir', outDir, '--declaration', 'false', '--sourceMap', 'false'],
    { stdio: 'inherit' },
  );
}, 60000);
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), 'wacha-obf-open-'));
  openLog = join(binDir, 'open.log');
  writeFileSync(join(binDir, 'open'), `#!/bin/sh\nprintf '%s\\n' "$1" >> "${openLog}"\nexit 0\n`);
  chmodSync(join(binDir, 'open'), 0o755);
  preload = join(binDir, 'fake-zoom-fetch.mjs');
  // 本番のトークン API・Users API の URL への fetch だけを偽の応答にする。ほかの送り先には接続しない。
  // FAKE_OBF_MODE はこの preload だけが読む（ok: 200 と token / fail: 401 / hold: 中断されるまで応答しない）
  writeFileSync(
    preload,
    `
globalThis.fetch = async (url, init = {}) => {
  if (url === 'https://zoom.us/oauth/token' && init.method === 'POST') {
    return new Response(JSON.stringify({ access_token: '${ACCESS}', refresh_token: '${REFRESH}', token_type: 'bearer', expires_in: 3599, scope: 'user:read:token' }));
  }
  if (url === 'https://api.zoom.us/v2/users/me/token?type=onbehalf' && init.method === 'GET' &&
      new Headers(init.headers).get('authorization') === 'Bearer ${ACCESS}') {
    const mode = process.env.FAKE_OBF_MODE;
    if (mode === 'hold') {
      return new Promise((_resolve, reject) => {
        // 実際の接続と同じくプロセスを生かしておく
        const timer = setTimeout(() => reject(new Error('${MESSAGE}')), 60000);
        const fail = () => { clearTimeout(timer); reject(new Error('${MESSAGE}')); };
        if (init.signal?.aborted) fail();
        else init.signal?.addEventListener('abort', fail, { once: true });
      });
    }
    if (mode === 'fail') return new Response(JSON.stringify({ code: 124, message: '${MESSAGE}' }), { status: 401 });
    return new Response(JSON.stringify({ token: '${OBF}', message: '${MESSAGE}' }));
  }
  throw new Error('${MESSAGE}');
};
`,
  );
});
afterEach(() => rmSync(binDir, { recursive: true, force: true }));

function startMain(env: Record<string, string>, args: string[] = [], nodeArgs: string[] = []) {
  const child = spawn(process.execPath, [...nodeArgs, join(outDir, 'zoom-obf/main.js'), ...args], {
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

describe('zoom-obf main', () => {
  it('Public Client ID が無ければ、ブラウザを開かずに終了コード 2', async () => {
    const main = startMain({});
    expect(await main.exited).toBe(2);
    expect(existsSync(openLog)).toBe(false);
    expect(main.output()).toContain('ZOOM_OAUTH_CLIENT_ID');
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('認可待ちの %s で、待受を閉じて終了コード %s', async (signal, code) => {
    const main = startMain({ ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID });
    const authorize = await waitForOpen();
    const redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '');
    expect(redirect.hostname).toBe('127.0.0.1');
    expect(authorize.origin + authorize.pathname).toBe('https://zoom.us/oauth/authorize');
    main.child.kill(signal);
    expect(await main.exited).toBe(code);
    expect(await connectionRefused(Number(redirect.port))).toBe(true);
    expect(main.output()).not.toContain(PUBLIC_ID);
    expect(main.output()).toContain('中断');
    expect(main.output()).not.toContain('OBF トークンを取得しました');
  }, 15000);

  it('URL として解析できない request-target が届いても落ちず、値を出さずに待ち続ける', async () => {
    const main = startMain({ ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID });
    const authorize = await waitForOpen();
    const port = Number(new URL(authorize.searchParams.get('redirect_uri') ?? '').port);
    const response = await sendRawRequest(port, BAD_REQUEST_TARGET);
    await new Promise((r) => setTimeout(r, 300));
    expect(main.child.exitCode).toBeNull();
    expect(response?.status).toBe(400);
    main.child.kill('SIGINT');
    expect(await main.exited).toBe(130);
    expect(await connectionRefused(port)).toBe(true);
    expect(main.output()).not.toContain(FAKE_BAD_TARGET_SECRET);
    expect(main.output()).not.toContain(PUBLIC_ID);
  }, 15000);
});

/** 偽のブラウザ操作として、認可 URL の state と認可コードを付けて callback を呼ぶ。待受のポートを返す */
async function approve(authorize: URL): Promise<number> {
  const redirect = new URL(authorize.searchParams.get('redirect_uri') ?? '');
  redirect.searchParams.set('state', authorize.searchParams.get('state') ?? '');
  redirect.searchParams.set('code', CODE);
  const response = await fetch(redirect);
  expectNoSecrets(await response.text());
  return Number(redirect.port);
}

function expectNoSecrets(output: string) {
  for (const secret of [PUBLIC_ID, ACCESS, REFRESH, OBF, MESSAGE, CODE]) expect(output).not.toContain(secret);
}

describe('zoom-obf main: OBF まで（本番 URL の fetch だけを preload で差し替え）', () => {
  it.each([
    ['ok', 0, 'OBF トークンを取得しました'],
    ['fail', 1, 'HTTP 401 code 124'],
  ] as const)('OAuth の許可から OBF %s まで進み、終了コード %s。値を表示しない', async (mode, code, phrase) => {
    const main = startMain({ ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID, FAKE_OBF_MODE: mode }, [], ['--import', preload]);
    const port = await approve(await waitForOpen());
    expect(await main.exited).toBe(code);
    expect(await connectionRefused(port)).toBe(true);
    expect(main.output()).toContain(phrase);
    if (mode === 'fail') {
      expect(main.output()).not.toContain('OBF トークンを取得しました');
      expect(main.output()).toContain('PO に戻してください');
    }
    expectNoSecrets(main.output());
  }, 15000);

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('OBF 要求中の %s で、成功を表示せず終了コード %s', async (signal, code) => {
    const main = startMain({ ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID, FAKE_OBF_MODE: 'hold' }, [], ['--import', preload]);
    const port = await approve(await waitForOpen());
    const started = Date.now();
    while (!main.output().includes('OBF トークンを要求します')) {
      if (Date.now() - started > 5000) throw new Error('OBF の要求が始まりませんでした');
      await new Promise((r) => setTimeout(r, 20));
    }
    main.child.kill(signal);
    expect(await main.exited).toBe(code);
    expect(await connectionRefused(port)).toBe(true);
    expect(main.output()).toContain('中断');
    expect(main.output()).not.toContain('OBF トークンを取得しました');
    expectNoSecrets(main.output());
  }, 15000);
});
