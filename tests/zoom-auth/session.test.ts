// 検証コマンドの実行・後始末・中断を、PATH に置いた偽の docker で確かめる。
// 実物の docker / SDK との接続は、手元の実 SDK 実行で確かめる（PR に記録）。
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeOutcome, exitCodeFor } from '../../src/zoom-auth/outcome.js';
import { createProbeSession, type ProbeSessionConfig } from '../../src/zoom-auth/session.js';
import { createFakeDocker, INIT_SUCCEEDED, waitFor, type FakeDocker } from './fake-docker.js';

let fake: FakeDocker;
let logs: string[];

beforeEach(() => {
  fake = createFakeDocker();
  logs = [];
});
afterEach(() => fake.cleanup());

function session(overrides: Partial<ProbeSessionConfig> = {}) {
  return createProbeSession({
    sdkDir: fake.sdkDir,
    probeBuildDir: fake.probeBuildDir,
    image: 'wacha-meter-zoom-dev:test',
    containerPrefix: 'wacha-test',
    childEnv: { PATH: fake.path },
    hostMarginSeconds: 1,
    initHostLimitSeconds: 1,
    killGraceMs: 300,
    dockerCommandTimeoutMs: 300,
    log: (line) => logs.push(line),
    ...overrides,
  });
}

const init = { mode: 'init', authTimeoutSeconds: 30, offline: false } as const;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('ホスト側の時間切れの後始末は有限時間で終わる', () => {
  it('docker kill が応答しなくても、上限と猶予のあと時間切れとして返す', async () => {
    fake.on('run', 'exec sleep 8');
    fake.on('kill', 'exec sleep 8');
    const started = Date.now();
    const outcome = await session().runProbe(init);
    expect(outcome).toEqual({ kind: 'timed_out', by: 'host' });
    // 上限 1 秒 + 猶予 0.3 秒 + ps の確認。kill の応答を待ち続けない
    expect(Date.now() - started).toBeLessThan(4000);
  }, 20000);

  it('docker ps が応答しなくても有限時間で返し、残りを確認できないので成功にしない', async () => {
    fake.on('run', INIT_SUCCEEDED);
    fake.on('ps', 'exec sleep 8');
    const started = Date.now();
    const outcome = await session().runProbe(init);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(outcome.kind).not.toBe('succeeded');
    expect(exitCodeFor(outcome)).not.toBe(0);
  }, 20000);
});

describe('残ったコンテナの削除を確かめる', () => {
  // ps は removed の印があるまで ID を返す
  const psUntilRemoved = '[ -f "$dir/removed" ] || echo abc123';

  it('削除して再確認で消えていれば成功のまま、削除しましたと表示する', async () => {
    fake.on('run', INIT_SUCCEEDED);
    fake.on('ps', psUntilRemoved);
    fake.on('rm', 'touch "$dir/removed"');
    const outcome = await session().runProbe(init);
    expect(outcome).toEqual({ kind: 'succeeded', mode: 'init' });
    expect(logs.some((l) => l.includes('削除しました'))).toBe(true);
    const calls = fake.calls();
    const rmIndex = calls.findIndex((c) => c.startsWith('rm -f '));
    expect(rmIndex).toBeGreaterThan(0);
    expect(calls.slice(rmIndex + 1).some((c) => c.startsWith('ps '))).toBe(true);
  });

  it('docker rm -f が失敗したら成功にせず、削除しましたと表示しない', async () => {
    fake.on('run', INIT_SUCCEEDED);
    fake.on('ps', psUntilRemoved);
    fake.on('rm', 'exit 1');
    const outcome = await session().runProbe(init);
    expect(outcome.kind).not.toBe('succeeded');
    expect(exitCodeFor(outcome)).not.toBe(0);
    expect(logs.some((l) => l.includes('削除しました'))).toBe(false);
    expect(logs.some((l) => l.includes('削除できませんでした'))).toBe(true);
  });

  it('rm が成功を返しても再確認で残っていれば成功にしない', async () => {
    fake.on('run', INIT_SUCCEEDED);
    fake.on('ps', 'echo abc123');
    const outcome = await session().runProbe(init);
    expect(outcome.kind).not.toBe('succeeded');
    expect(exitCodeFor(outcome)).not.toBe(0);
    expect(logs.some((l) => l.includes('削除しました'))).toBe(false);
  });

  it('docker ps が失敗したら成功にしない', async () => {
    fake.on('run', INIT_SUCCEEDED);
    fake.on('ps', 'exit 1');
    const outcome = await session().runProbe(init);
    expect(outcome.kind).not.toBe('succeeded');
    expect(exitCodeFor(outcome)).not.toBe(0);
  });

  it('検証プログラムが失敗していれば、その終了コードを保つ', async () => {
    fake.on('run', `echo 'WACHA_PROBE_RESULT {"mode":"auth","outcome":"failed","stage":"auth","code":"AUTHRET_JWTTOKENWRONG"}'; exit 3`);
    fake.on('ps', 'exit 1');
    const outcome = await session().runProbe({ mode: 'auth', jwt: 'a.b.c', authTimeoutSeconds: 30, offline: false });
    expect(exitCodeFor(outcome)).toBe(3);
  });
});

describe('docker がコンテナを起動できなかったとき', () => {
  it('理由（docker: で始まる行）を伝え、JWT など他の標準エラーは出さない', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.secret-payload.secret-signature';
    fake.on(
      'run',
      [
        'read jwt',
        'echo "leak: $jwt" >&2',
        `echo 'docker: Error response from daemon: pull access denied for wacha-meter-zoom-dev.' >&2`,
        'exit 125',
      ].join('\n'),
    );
    const outcome = await session().runProbe({ mode: 'auth', jwt, authTimeoutSeconds: 30, offline: false });
    expect(outcome.kind).toBe('docker_failed');
    const text = describeOutcome(outcome);
    expect(text).toContain('Docker がコンテナを起動できませんでした（終了コード 125）');
    expect(text).toContain('docker: Error response from daemon: pull access denied for wacha-meter-zoom-dev.');
    expect(exitCodeFor(outcome)).toBe(1);
    for (const out of [text, ...logs]) {
      expect(out).not.toContain('secret-payload');
      expect(out).not.toContain('leak');
    }
  });
});

describe('中断（SIGINT / SIGTERM）', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('%s では自分のコンテナを kill し、残りを確かめてから %i を返す', async (signal, code) => {
    fake.on('run', 'echo $$ > "$dir/run.pid"; exec sleep 8');
    const s = session({ initHostLimitSeconds: 30 });
    void s.runProbe(init);
    await waitFor(() => fake.calls().some((c) => c.startsWith('run ')));
    const name = fake.containerName();
    expect(await s.interrupt(signal)).toBe(code);
    const calls = fake.calls();
    const killIndex = calls.indexOf(`kill ${name}`);
    expect(killIndex).toBeGreaterThan(0);
    expect(calls.slice(killIndex + 1).some((c) => c.startsWith('ps ') && c.includes(`^/${name}$`))).toBe(true);
    // docker run のクライアント（偽物）も止めている
    const pid = Number(readFileSync(`${fake.dir}/run.pid`, 'utf8'));
    await waitFor(() => !processAlive(pid), 2000);
  });

  it('コンテナを起動する前なら、docker を呼ばずに終了コードを返す', async () => {
    expect(await session().interrupt('SIGTERM')).toBe(143);
    expect(fake.calls()).toEqual([]);
  });
});
