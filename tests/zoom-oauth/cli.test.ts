import { describe, expect, it } from 'vitest';
import { runCli, type CliDeps, type OAuthRequest } from '../../src/zoom-oauth/cli.js';
import type { OAuthOutcome } from '../../src/zoom-oauth/outcome.js';

const PUBLIC_ID = 'public-client-id-L5v';

// OAuth の流れ（ブラウザと Zoom）だけを偽物にする。流れ自体は flow.test.ts で確かめる。
function setup(env: Record<string, string | undefined>, outcome: OAuthOutcome = { kind: 'denied' }) {
  const requests: OAuthRequest[] = [];
  const lines: string[] = [];
  const deps: CliDeps = {
    env,
    runFlow: async (request) => {
      requests.push(request);
      return outcome;
    },
    write: (line) => lines.push(line),
  };
  return { deps, requests, lines };
}

describe('runCli: Public Client ID', () => {
  it('ZOOM_OAUTH_CLIENT_ID が未設定なら、ブラウザを開かず終了コード 2 で設定場所を案内する', async () => {
    const { deps, requests, lines } = setup({});
    expect(await runCli([], deps)).toBe(2);
    // 設定不備のまま認可へ進まないこと自体が契約なので、呼び出しの有無を確かめる
    expect(requests).toEqual([]);
    expect(lines.join('\n')).toContain('ZOOM_OAUTH_CLIENT_ID');
    expect(lines.join('\n')).toContain('.local/zoom-oauth.env');
  });

  it('SDK 用の ZOOM_SDK_CLIENT_ID だけでは代わりに使わない', async () => {
    const { deps, requests } = setup({ ZOOM_SDK_CLIENT_ID: 'sdk-id', ZOOM_SDK_CLIENT_SECRET: 'sdk-secret' });
    expect(await runCli([], deps)).toBe(2);
    expect(requests).toEqual([]);
  });

  it.each([
    ['空', ''],
    ['空白だけ', '   '],
    ['改行入り', `${PUBLIC_ID}\n`],
  ])('値が%sなら終了コード 2。値は表示しない', async (_label, value) => {
    const { deps, requests, lines } = setup({ ZOOM_OAUTH_CLIENT_ID: value });
    expect(await runCli([], deps)).toBe(2);
    expect(requests).toEqual([]);
    expect(lines.join('\n')).not.toContain(PUBLIC_ID);
  });

  it('設定があれば、既定の待機 180 秒で流れを1回行い、結果の終了コードを返す', async () => {
    const { deps, requests, lines } = setup({ ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID }, { kind: 'denied' });
    expect(await runCli([], deps)).toBe(3);
    expect(requests).toEqual([{ clientId: PUBLIC_ID, timeoutSeconds: 180 }]);
    expect(lines.join('\n')).not.toContain(PUBLIC_ID);
  });

  it('成功なら終了コード 0 で、結果の文言を表示する', async () => {
    const { deps, lines } = setup(
      { ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID },
      { kind: 'succeeded', token: { tokenType: 'bearer', expiresIn: 3599, scope: 'user:read:token' } },
    );
    expect(await runCli([], deps)).toBe(0);
    expect(lines.join('\n')).toContain('OAuth トークンを取得しました');
  });
});

describe('runCli: 引数', () => {
  const env = { ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID };

  it.each([
    ['30', 30],
    ['600', 600],
  ])('--timeout %s は受け付ける', async (value, expected) => {
    const { deps, requests } = setup(env);
    await runCli(['--timeout', value], deps);
    expect(requests).toEqual([{ clientId: PUBLIC_ID, timeoutSeconds: expected }]);
  });

  it.each([['29'], ['601'], ['abc'], ['1.5'], ['']])('--timeout %s は終了コード 2', async (value) => {
    const { deps, requests } = setup(env);
    expect(await runCli(['--timeout', value], deps)).toBe(2);
    expect(requests).toEqual([]);
  });

  it('知らない引数は終了コード 2', async () => {
    const { deps, requests } = setup(env);
    expect(await runCli(['--save'], deps)).toBe(2);
    expect(requests).toEqual([]);
  });
});
