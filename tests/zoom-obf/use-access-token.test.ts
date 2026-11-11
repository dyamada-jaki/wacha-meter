// zoom-oauth の流れに足した「アクセストークンを後続処理へ渡す」口の結合テスト（Issue #8）。
// 値を戻り値・表示へ出さないこと、後続処理の例外で落ちないこと、既存の zoom:oauth の結果が変わらないことを確かめる。
import { afterEach, describe, expect, it } from 'vitest';
import { runOAuthFlow } from '../../src/zoom-oauth/flow.js';
import { describeOutcome, exitCodeFor } from '../../src/zoom-oauth/outcome.js';
import {
  connectionRefused,
  createFakeBrowser,
  FAKE_ACCESS_TOKEN,
  FAKE_CLIENT_ID,
  FAKE_REFRESH_TOKEN,
  startFakeTokenApi,
  type FakeTokenApi,
} from '../zoom-oauth/fake-zoom.js';

let tokenApi: FakeTokenApi | undefined;
afterEach(async () => {
  await tokenApi?.close();
  tokenApi = undefined;
});

async function run<U>(useAccessToken?: (token: string, signal: AbortSignal | undefined) => Promise<U>) {
  const browser = createFakeBrowser('approve');
  tokenApi = await startFakeTokenApi('ok', browser.seen);
  const logs: string[] = [];
  let port = 0;
  const outcome = await runOAuthFlow<U>({
    clientId: FAKE_CLIENT_ID,
    authorizeUrl: 'https://zoom.example/oauth/authorize',
    tokenUrl: tokenApi.url,
    timeoutMs: 5000,
    tokenTimeoutMs: 5000,
    openBrowser: browser.open,
    log: (line) => logs.push(line),
    onListening: (a) => (port = a.port),
    ...(useAccessToken === undefined ? {} : { useAccessToken }),
  });
  await browser.settled();
  return { outcome, logs, closed: await connectionRefused(port) };
}

const SUMMARY = { tokenType: 'bearer', expiresIn: 3599, scope: 'user:read:token' } as const;

describe('runOAuthFlow: アクセストークンを後続処理へ渡す', () => {
  it('後続処理には取得したアクセストークンだけが渡り、結果には後続処理の戻り値だけが入る（トークンは入らない）', async () => {
    const received: string[] = [];
    const r = await run(async (token) => {
      received.push(token);
      return 'done' as const;
    });
    expect(received).toEqual([FAKE_ACCESS_TOKEN]);
    expect(r.outcome).toEqual({ kind: 'succeeded', token: SUMMARY, used: { kind: 'returned', value: 'done' } });
    expect(JSON.stringify(r.outcome)).not.toContain(FAKE_ACCESS_TOKEN);
    expect(JSON.stringify(r.outcome)).not.toContain(FAKE_REFRESH_TOKEN);
    expect(r.closed).toBe(true);
  });

  it('後続処理が例外を投げても落ちず、投げたことだけを返す（例外の本文は出さない）', async () => {
    const r = await run(async (token) => {
      throw new Error(`boom ${token}`);
    });
    expect(r.outcome).toEqual({ kind: 'succeeded', token: SUMMARY, used: { kind: 'threw' } });
    const output = [...r.logs, JSON.stringify(r.outcome)].join('\n');
    expect(output).not.toContain(FAKE_ACCESS_TOKEN);
    expect(output).not.toContain('boom');
    expect(r.closed).toBe(true);
  });

  it('後続処理を渡さない既存の使い方（zoom:oauth）は、結果・終了コード・表示が変わらず、トークンを含まない', async () => {
    const r = await run();
    expect(r.outcome).toStrictEqual({ kind: 'succeeded', token: SUMMARY });
    expect(exitCodeFor(r.outcome)).toBe(0);
    expect(describeOutcome(r.outcome)).toBe(
      'OAuth トークンを取得しました（種類 bearer・有効期間 3599 秒・スコープ user:read:token）。トークンは保存せず、終了時に破棄します。',
    );
    expect(JSON.stringify(r.outcome)).not.toContain(FAKE_ACCESS_TOKEN);
  });
});
