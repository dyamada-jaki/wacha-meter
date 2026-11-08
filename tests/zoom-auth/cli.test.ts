import { describe, expect, it } from 'vitest';
import { runCli, type CliDeps, type ProbeRequest } from '../../src/zoom-auth/cli.js';
import type { ProbeOutcome } from '../../src/zoom-auth/outcome.js';

const ID = 'test-client-id-123';
const SECRET = 'test-client-secret-xyz';
const NOW = 1_800_000_000;

// 検証プログラムの起動（Docker + 実 SDK）だけを偽物にする。CI に SDK が無いため。
function setup(env: Record<string, string | undefined>, outcome: ProbeOutcome) {
  const requests: ProbeRequest[] = [];
  const lines: string[] = [];
  const deps: CliDeps = {
    env,
    now: () => NOW,
    runProbe: async (request) => {
      requests.push(request);
      return outcome;
    },
    write: (line) => lines.push(line),
  };
  return { deps, requests, lines };
}

const creds = { ZOOM_SDK_CLIENT_ID: ID, ZOOM_SDK_CLIENT_SECRET: SECRET };

describe('runCli auth', () => {
  it('認証情報が未設定なら、検証プログラムを起動せず終了コード 2 で知らせる', async () => {
    const { deps, requests, lines } = setup({}, { kind: 'succeeded', mode: 'auth' });
    expect(await runCli(['auth'], deps)).toBe(2);
    // 起動しないこと自体が「設定不備のまま接続しない」契約なので、呼び出しの有無を確かめる
    expect(requests).toEqual([]);
    expect(lines.join('\n')).toContain('ZOOM_SDK_CLIENT_ID');
    expect(lines.join('\n')).toContain('ZOOM_SDK_CLIENT_SECRET');
  });

  it('不正な値（改行入り）なら起動せず終了コード 2。値は出力しない', async () => {
    const { deps, requests, lines } = setup(
      { ZOOM_SDK_CLIENT_ID: ID, ZOOM_SDK_CLIENT_SECRET: `${SECRET}\n` },
      { kind: 'succeeded', mode: 'auth' },
    );
    expect(await runCli(['auth'], deps)).toBe(2);
    expect(requests).toEqual([]);
    expect(lines.join('\n')).not.toContain(SECRET);
  });

  it('設定がそろえば JWT を作って渡し、既定の待ち時間 30 秒・オンラインで起動する', async () => {
    const { deps, requests } = setup(creds, { kind: 'succeeded', mode: 'auth' });
    expect(await runCli(['auth'], deps)).toBe(0);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.mode).toBe('auth');
    expect(request?.authTimeoutSeconds).toBe(30);
    expect(request?.offline).toBe(false);
    const payload = JSON.parse(Buffer.from(request?.jwt?.split('.')[1] ?? '', 'base64url').toString());
    expect(payload).toMatchObject({ appKey: ID, iat: NOW });
  });

  it('--timeout と --offline を検証プログラムへ渡す', async () => {
    const { deps, requests } = setup(creds, { kind: 'timed_out', by: 'probe' });
    expect(await runCli(['auth', '--timeout', '5', '--offline'], deps)).toBe(4);
    expect(requests[0]).toMatchObject({ authTimeoutSeconds: 5, offline: true });
  });

  it.each(['0', '-1', 'abc', '1.5', '601'])('--timeout %s は使えない値として終了コード 2', async (value) => {
    const { deps, requests } = setup(creds, { kind: 'succeeded', mode: 'auth' });
    expect(await runCli(['auth', '--timeout', value], deps)).toBe(2);
    expect(requests).toEqual([]);
  });

  it.each<[ProbeOutcome, number]>([
    [{ kind: 'auth_failed', code: 'AUTHRET_JWTTOKENWRONG' }, 3],
    [{ kind: 'timed_out', by: 'host' }, 4],
    [{ kind: 'sdk_error', stage: 'init', code: 'SDKERR_UNKNOWN' }, 1],
  ])('結果 %j は終了コード %i。出力に Secret も JWT も含めない', async (outcome, code) => {
    const { deps, requests, lines } = setup(creds, outcome);
    expect(await runCli(['auth'], deps)).toBe(code);
    const output = lines.join('\n');
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain(requests[0]?.jwt ?? 'jwt-missing');
  });
});

describe('runCli init', () => {
  it('認証情報が無くても初期化の確認はでき、JWT は渡さない', async () => {
    const { deps, requests } = setup({}, { kind: 'succeeded', mode: 'init' });
    expect(await runCli(['init'], deps)).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.mode).toBe('init');
    expect(requests[0]?.jwt).toBeUndefined();
  });

  it('初期化が失敗したら終了コード 1', async () => {
    const { deps } = setup({}, { kind: 'sdk_error', stage: 'init', code: 'SDKERR_UNINITIALIZE' });
    expect(await runCli(['init'], deps)).toBe(1);
  });
});

describe('runCli の使い方の誤り', () => {
  it.each([[[]], [['join']], [['auth', '--unknown']]])('%j は終了コード 2 で、起動しない', async (argv) => {
    const { deps, requests } = setup(creds, { kind: 'succeeded', mode: 'auth' });
    expect(await runCli(argv, deps)).toBe(2);
    expect(requests).toEqual([]);
  });
});
