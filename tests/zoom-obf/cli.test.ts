import { describe, expect, it } from 'vitest';
import { runObfCli, describeObfOutcome } from '../../src/zoom-obf/cli.js';
import type { ObfOutcome } from '../../src/zoom-obf/flow.js';
import type { OAuthRequest } from '../../src/zoom-oauth/cli.js';

const ID = 'fake-obf-public-client-id-X4';
const SECRET = 'fake-cli-secret-J2';
function setup(env: Record<string, string | undefined> = { ZOOM_OAUTH_CLIENT_ID: ID }, outcome: ObfOutcome = { kind: 'succeeded' }) {
  const requests: OAuthRequest[] = [];
  const lines: string[] = [];
  return { requests, lines, deps: { env, runFlow: async (request: OAuthRequest) => { requests.push(request); return outcome; }, write: (line: string) => lines.push(line) } };
}

describe('zoom:obf CLI', () => {
  it.each([{}, { ZOOM_SDK_CLIENT_ID: ID }, { ZOOM_OAUTH_CLIENT_ID: '' }, { ZOOM_OAUTH_CLIENT_ID: `${ID}\n` }])(
    '設定不備では認可を始めず2、安全な設定案内', async (env) => {
      const { deps, requests, lines } = setup(env);
      expect(await runObfCli([], deps)).toBe(2);
      expect(requests).toEqual([]);
      expect(lines.join('\n')).toContain('.local/zoom-oauth.env');
      expect(lines.join('\n')).not.toContain(ID);
    },
  );
  it.each([['--save', SECRET], ['--timeout', '29'], ['--timeout', '601'], ['--timeout', '1.5'], ['--timeout']])(
    '使えない引数 %j は2、入力を反射しない', async (...argv) => {
      const { deps, requests, lines } = setup();
      expect(await runObfCli(argv, deps)).toBe(2);
      expect(requests).toEqual([]);
      expect(lines.join('\n')).not.toContain(SECRET);
      expect(lines.join('\n')).toContain('zoom:obf');
    },
  );
  it.each([30, 180, 600])('待機%s秒で1回だけ実行し、OBF成功0を返す', async (seconds) => {
    const { deps, requests, lines } = setup();
    expect(await runObfCli(seconds === 180 ? [] : ['--timeout', String(seconds)], deps)).toBe(0);
    expect(requests).toEqual([{ clientId: ID, timeoutSeconds: seconds }]);
    expect(lines.join('\n')).toContain('OBF トークンを取得しました');
    expect(lines.join('\n')).not.toContain(ID);
  });
  it.each([
    [{ kind: 'malformed' }, 1], [{ kind: 'network_error' }, 1], [{ kind: 'timeout' }, 1],
    [{ kind: 'interrupted' }, 130], [{ kind: 'http_error', status: 403 }, 1],
    [{ kind: 'oauth_failed', outcome: { kind: 'denied' } }, 3],
    [{ kind: 'oauth_failed', outcome: { kind: 'timed_out' } }, 4],
    [{ kind: 'oauth_failed', outcome: { kind: 'interrupted' } }, 130],
    [{ kind: 'oauth_failed', outcome: { kind: 'token_failed', reason: 'timeout' } }, 1],
  ] satisfies [ObfOutcome, number][])('結果 %j の終了コードは%s', async (outcome, code) => {
    const { deps, lines } = setup(undefined, outcome);
    expect(await runObfCli([], deps)).toBe(code);
    expect(lines.join('\n')).not.toContain('OBF トークンを取得しました');
  });
  it('秘密入り例外でも内容を表示せず失敗1', async () => {
    const { deps, lines } = setup();
    expect(await runObfCli([], { ...deps, runFlow: async () => { throw new Error(SECRET); } })).toBe(1);
    expect(lines.join('\n')).not.toContain(SECRET);
  });
  it('OAuth失敗の自由なerrorCodeも新コマンドでは表示しない', () => {
    expect(describeObfOutcome({ kind: 'oauth_failed', outcome: { kind: 'invalid_response', reason: 'provider_error', errorCode: SECRET } })).not.toContain(SECRET);
  });
});
