import { describe, expect, it } from 'vitest';
import { runCli, type CliDeps } from '../../src/zoom-oauth/cli.js';

function fixture(overrides: Partial<CliDeps> = {}) {
  const output: string[] = [];
  let opened = false;
  let requested = false;
  const deps: CliDeps = {
    env: { ZOOM_OAUTH_PUBLIC_CLIENT_ID: 'test-public-id', ZOOM_SDK_CLIENT_ID: 'test-sdk-id', ZOOM_SDK_CLIENT_SECRET: 'test-sdk-secret' },
    write: (line) => output.push(line),
    openBrowser: async (value) => {
      opened = true;
      const auth = new URL(value);
      const url = new URL(auth.searchParams.get('redirect_uri')!);
      url.search = new URLSearchParams({ code: 'test-code', state: auth.searchParams.get('state')! }).toString();
      await fetch(url);
    },
    fetch: async () => { requested = true; return Response.json({ access_token: 'test-access-token', token_type: 'bearer' }); },
    timeoutMs: 2000,
    ...overrides,
  };
  return { deps, output: () => output.join('\n'), opened: () => opened, requested: () => requested };
}

describe('OAuth CLI の結果と秘密情報を含まない表示', () => {
  it('トークンを返さず成功と終了0を示す', async () => {
    const f = fixture();
    expect(await runCli([], f.deps)).toBe(0);
    expect(f.output()).toContain('トークン取得に成功');
    expect(f.output()).toContain('300秒');
    for (const value of ['test-public-id', 'test-code', 'test-access-token', 'test-sdk-id', 'test-sdk-secret', 'https://zoom.us']) expect(f.output()).not.toContain(value);
    expect(f.requested()).toBe(true);
  });
  it.each([undefined, '', ' ', 'secret\nvalue'])('Public ID が不正ならSDK用の設定にfallbackしない（%s）', async (value) => {
    const f = fixture({ env: { ZOOM_OAUTH_PUBLIC_CLIENT_ID: value, ZOOM_SDK_CLIENT_ID: 'sdk-id', ZOOM_SDK_CLIENT_SECRET: 'sdk-secret' } });
    expect(await runCli([], f.deps)).toBe(2);
    expect(f.opened()).toBe(false);
    expect(f.requested()).toBe(false);
    expect(f.output()).toContain('ZOOM_OAUTH_PUBLIC_CLIENT_ID');
    expect(f.output()).not.toContain('sdk-secret');
    expect(f.output()).not.toContain('secret\nvalue');
  });
  it('不明引数を値ごと表示しない', async () => {
    const f = fixture();
    expect(await runCli(['secret-value'], f.deps)).toBe(2);
    expect(f.output()).not.toContain('secret-value');
    expect(f.opened()).toBe(false);
  });
  it('--helpは設定不要で外部通信しない', async () => {
    const f = fixture({ env: {} });
    expect(await runCli(['--help'], f.deps)).toBe(0);
    expect(f.output()).toContain('zoom:oauth');
    expect(f.opened()).toBe(false);
  });
  it('認可拒否は終了3と安全なエラーコードだけを示す', async () => {
    const f = fixture({ openBrowser: async (value) => {
      const auth = new URL(value);
      const url = new URL(auth.searchParams.get('redirect_uri')!);
      url.search = new URLSearchParams({ error: 'access_denied', state: auth.searchParams.get('state')!, error_description: 'test-secret-description' }).toString();
      await fetch(url);
    } });
    expect(await runCli([], f.deps)).toBe(3);
    expect(f.output()).toContain('access_denied');
    expect(f.output()).not.toContain('test-secret-description');
    expect(f.requested()).toBe(false);
  });
  it.each(['invalid_client', 'invalid_grant'])('トークン失敗%sを終了1とコードだけで示す', async (error) => {
    const f = fixture({ fetch: async () => Response.json({ error, error_description: 'test-secret-description' }, { status: 400 }) });
    expect(await runCli([], f.deps)).toBe(1);
    expect(f.output()).toContain(error);
    expect(f.output()).not.toContain('test-secret-description');
  });
  it('時間切れは終了4、中断は終了130になる', async () => {
    const timed = fixture({ timeoutMs: 20, openBrowser: async () => {} });
    expect(await runCli([], timed.deps)).toBe(4);
    expect(timed.output()).toContain('時間切れ');
    const controller = new AbortController(); controller.abort();
    const cancelled = fixture({ signal: controller.signal });
    expect(await runCli([], cancelled.deps)).toBe(130);
    expect(cancelled.output()).toContain('中断');
  });
});
