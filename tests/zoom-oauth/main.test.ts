import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let outDir: string;
let dir: string;
const children = new Set<ReturnType<typeof spawn>>();
beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'wacha-oauth-build-'));
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json', '--outDir', outDir,
    '--declaration', 'false', '--sourceMap', 'false'], { stdio: 'inherit' });
}, 60_000);
afterAll(() => rmSync(outDir, { force: true, recursive: true }));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wacha-oauth-main-'));
  // OSのブラウザ境界だけをfakeにし、本物のZoomへはアクセスしない。
  writeFileSync(join(dir, 'open'), `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(join(dir, 'opened.json'))}, JSON.stringify({url:process.argv[2],pid:process.pid,sdkSecretPresent:!!process.env.ZOOM_SDK_CLIENT_SECRET}));
const mode=fs.readFileSync(${JSON.stringify(join(dir, 'mode'))},'utf8');
if(mode==='hang') setInterval(()=>{},1000);
if(mode==='fail') { console.error('test-secret-error '+process.argv[2]); process.exit(1); }
`, { mode: 0o700 });
  writeFileSync(join(dir, 'mode'), 'normal');
});
afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.clear();
  rmSync(dir, { force: true, recursive: true });
});

function start(args: string[] = [], configured = true) {
  const child = spawn(process.execPath, [join(outDir, 'zoom-oauth/main.js'), ...args], {
    cwd: dir,
    env: { PATH: `${dir}:/usr/bin:/bin`, ZOOM_SDK_CLIENT_ID: 'test-sdk-id', ZOOM_SDK_CLIENT_SECRET: 'test-sdk-secret',
      ...(configured ? { ZOOM_OAUTH_PUBLIC_CLIENT_ID: 'test-public-id' } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr!.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  const done = new Promise<number | null>((resolve) => child.once('close', (code) => { children.delete(child); resolve(code); }));
  return { child, done, output: () => output };
}

async function opened(): Promise<{ url: string; pid: number; sdkSecretPresent: boolean }> {
  const path = join(dir, 'opened.json');
  const deadline = Date.now() + 3000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error('fake browserが呼ばれませんでした');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return JSON.parse(readFileSync(path, 'utf8')) as { url: string; pid: number; sdkSecretPresent: boolean };
}

describe('OAuth 実コマンド: OSブラウザ境界だけfake', () => {
  it('SDK設定だけでは起動せず、Public ID設定の案内で終了2になる', async () => {
    const main = start([], false);
    expect(await main.done).toBe(2);
    expect(main.output()).toContain('ZOOM_OAUTH_PUBLIC_CLIENT_ID');
    expect(main.output()).not.toContain('test-sdk-secret');
    expect(existsSync(join(dir, 'opened.json'))).toBe(false);
  });
  it('--helpは設定もブラウザも不要', async () => {
    const main = start(['--help'], false);
    expect(await main.done).toBe(0);
    expect(main.output()).toContain('zoom:oauth');
    expect(existsSync(join(dir, 'opened.json'))).toBe(false);
  });
  it.each([['SIGINT', 130], ['SIGTERM', 143]] as const)('%sで待受・未完了接続・起動子プロセスを閉じ終了%i', async (signal, code) => {
    writeFileSync(join(dir, 'mode'), 'hang');
    const main = start();
    const browser = await opened();
    expect(browser.sdkSecretPresent).toBe(false);
    const redirect = new URL(new URL(browser.url).searchParams.get('redirect_uri')!);
    const socket = connect({ host: '127.0.0.1', port: Number(redirect.port) });
    socket.on('error', () => {});
    const socketClosed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    main.child.kill(signal);
    expect(await main.done).toBe(code);
    await socketClosed;
    expect(main.output()).toContain('中断');
    expect(main.output()).not.toContain('test-public-id');
    expect(() => process.kill(browser.pid, 0)).toThrow();
    await expect(fetch(redirect)).rejects.toThrow();
  });
  it('open失敗はURLやOSのエラー出力を表示しない', async () => {
    writeFileSync(join(dir, 'mode'), 'fail');
    const main = start();
    const browser = await opened();
    expect(await main.done).toBe(1);
    expect(main.output()).toContain('失敗');
    expect(main.output()).not.toContain('test-secret-error');
    expect(main.output()).not.toContain('test-public-id');
    expect(main.output()).not.toContain('https://zoom.us');
    await expect(fetch(new URL(browser.url).searchParams.get('redirect_uri')!)).rejects.toThrow();
  });
  it('本物のtoken APIを呼ばず拒否を終了3で示し、descriptionは表示しない', async () => {
    const main = start();
    const browser = await opened();
    const auth = new URL(browser.url);
    const callback = new URL(auth.searchParams.get('redirect_uri')!);
    callback.search = new URLSearchParams({ state: auth.searchParams.get('state')!, error: 'access_denied', error_description: 'test-secret-description' }).toString();
    await fetch(callback);
    expect(await main.done).toBe(3);
    expect(main.output()).toContain('access_denied');
    expect(main.output()).not.toContain('test-secret-description');
    expect(main.output()).not.toContain('test-public-id');
  });
});
