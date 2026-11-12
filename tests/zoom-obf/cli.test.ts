import { describe, expect, it } from 'vitest';
import type { OAuthRequest } from '../../src/zoom-oauth/cli.js';
import { runObfCli, type ObfCliDeps } from '../../src/zoom-obf/cli.js';
import type { ObfOutcome } from '../../src/zoom-obf/outcome.js';

const PUBLIC_ID = 'obf-cli-public-client-id-N3c';
const SUMMARY = { tokenType: 'bearer', expiresIn: 3599, scope: 'user:read:token' } as const;

// OAuth → OBF の流れ（ブラウザと Zoom）だけを偽物にする。流れ自体は flow.test.ts で確かめる。
function setup(env: Record<string, string | undefined>, outcome: ObfOutcome = { kind: 'denied' }) {
  const requests: OAuthRequest[] = [];
  const lines: string[] = [];
  const deps: ObfCliDeps = {
    env,
    runFlow: async (request) => {
      requests.push(request);
      return outcome;
    },
    write: (line) => lines.push(line),
  };
  return { deps, requests, lines };
}

describe('runObfCli: 設定と引数（zoom:oauth と同じ）', () => {
  it('ZOOM_OAUTH_CLIENT_ID が未設定なら、ブラウザを開かず終了コード 2 で設定場所を案内する', async () => {
    const { deps, requests, lines } = setup({});
    expect(await runObfCli([], deps)).toBe(2);
    // 設定不備のまま認可へ進まないこと自体が契約なので、呼び出しの有無を確かめる
    expect(requests).toEqual([]);
    expect(lines.join('\n')).toContain('ZOOM_OAUTH_CLIENT_ID');
    expect(lines.join('\n')).toContain('.local/zoom-oauth.env');
  });

  it('SDK 用の ZOOM_SDK_CLIENT_ID だけでは代わりに使わない', async () => {
    const { deps, requests } = setup({ ZOOM_SDK_CLIENT_ID: 'sdk-id', ZOOM_SDK_CLIENT_SECRET: 'sdk-secret' });
    expect(await runObfCli([], deps)).toBe(2);
    expect(requests).toEqual([]);
  });

  it('値に改行があれば終了コード 2。値は表示しない', async () => {
    const { deps, requests, lines } = setup({ ZOOM_OAUTH_CLIENT_ID: `${PUBLIC_ID}\n` });
    expect(await runObfCli([], deps)).toBe(2);
    expect(requests).toEqual([]);
    expect(lines.join('\n')).not.toContain(PUBLIC_ID);
  });

  it('既定の待機 180 秒、--timeout 30〜600 を受け付ける', async () => {
    const a = setup({ ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID });
    await runObfCli([], a.deps);
    expect(a.requests).toEqual([{ clientId: PUBLIC_ID, timeoutSeconds: 180 }]);
    const b = setup({ ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID });
    await runObfCli(['--timeout', '600'], b.deps);
    expect(b.requests).toEqual([{ clientId: PUBLIC_ID, timeoutSeconds: 600 }]);
  });

  it.each([['29'], ['601'], ['abc']])('--timeout %s は終了コード 2', async (value) => {
    const { deps, requests } = setup({ ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID });
    expect(await runObfCli(['--timeout', value], deps)).toBe(2);
    expect(requests).toEqual([]);
  });

  it('会議番号などの知らない引数は受け付けない（終了コード 2）', async () => {
    const { deps, requests, lines } = setup({ ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID });
    expect(await runObfCli(['--meeting', '123'], deps)).toBe(2);
    expect(requests).toEqual([]);
    expect(lines.join('\n')).toContain('zoom:obf');
  });
});

describe('runObfCli: 結果', () => {
  const env = { ZOOM_OAUTH_CLIENT_ID: PUBLIC_ID };

  it('OBF 取得成功なら終了コード 0 で成功の文言を表示する', async () => {
    const { deps, lines } = setup(env, { kind: 'obf_succeeded', token: SUMMARY });
    expect(await runObfCli([], deps)).toBe(0);
    expect(lines.join('\n')).toContain('OBF トークンを取得しました');
    expect(lines.join('\n')).not.toContain(PUBLIC_ID);
  });

  it('OAuth は成功し OBF に失敗したら終了コード 1 で、成功の文言を出さない', async () => {
    const { deps, lines } = setup(env, { kind: 'obf_failed', token: SUMMARY, reason: 'http_error', status: 401, code: 124 });
    expect(await runObfCli([], deps)).toBe(1);
    expect(lines.join('\n')).not.toContain('OBF トークンを取得しました');
  });

  it.each([
    [{ kind: 'denied' } as const, 3],
    [{ kind: 'timed_out' } as const, 4],
    [{ kind: 'interrupted' } as const, 130],
  ])('%o は終了コード %s', async (outcome, code) => {
    const { deps } = setup(env, outcome);
    expect(await runObfCli([], deps)).toBe(code);
  });
});
