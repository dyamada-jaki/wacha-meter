import { describe, expect, it } from 'vitest';
import {
  classifyProbeRun,
  describeOutcome,
  exitCodeFor,
  type ProbeOutcome,
  type ProbeRun,
} from '../../src/zoom-auth/outcome.js';

function line(result: Record<string, string>): string {
  return `WACHA_PROBE_RESULT ${JSON.stringify(result)}\n`;
}

function run(partial: Partial<ProbeRun>): ProbeRun {
  return { mode: 'auth', exitCode: 0, stdout: '', hostTimedOut: false, ...partial };
}

describe('classifyProbeRun', () => {
  it('init が成功を報告し終了コード 0 なら、init の成功', () => {
    const outcome = classifyProbeRun(
      run({ mode: 'init', stdout: line({ mode: 'init', outcome: 'succeeded' }) }),
    );
    expect(outcome).toEqual({ kind: 'succeeded', mode: 'init' });
  });

  it('auth の成功は、SDK の雑多な出力が前後にあっても結果行から読む', () => {
    const stdout = `sdk log line\n${line({ mode: 'auth', outcome: 'succeeded' })}after\n`;
    expect(classifyProbeRun(run({ stdout }))).toEqual({ kind: 'succeeded', mode: 'auth' });
  });

  it('終了コード 0 でも結果行が無ければ成功にしない', () => {
    expect(classifyProbeRun(run({ stdout: 'something\n' }))).toEqual({
      kind: 'probe_error',
      reason: 'no_result',
    });
  });

  it('結果行の JSON が壊れていれば成功にしない', () => {
    expect(classifyProbeRun(run({ stdout: 'WACHA_PROBE_RESULT {"outcome":"succ\n' }))).toEqual({
      kind: 'probe_error',
      reason: 'malformed_result',
    });
  });

  it('成功の結果行でも終了コードが 0 でなければ成功にしない', () => {
    const stdout = line({ mode: 'auth', outcome: 'succeeded' });
    expect(classifyProbeRun(run({ stdout, exitCode: 1 }))).toEqual({
      kind: 'probe_error',
      reason: 'inconsistent_result',
    });
  });

  it('init を頼んだのに auth の成功が返ったら成功にしない', () => {
    const stdout = line({ mode: 'auth', outcome: 'succeeded' });
    expect(classifyProbeRun(run({ mode: 'init', stdout }))).toEqual({
      kind: 'probe_error',
      reason: 'inconsistent_result',
    });
  });

  it('認証の失敗は SDK のコード名を残し、時間切れと区別する', () => {
    const stdout = line({ mode: 'auth', outcome: 'failed', stage: 'auth', code: 'AUTHRET_JWTTOKENWRONG' });
    expect(classifyProbeRun(run({ stdout, exitCode: 3 }))).toEqual({
      kind: 'auth_failed',
      code: 'AUTHRET_JWTTOKENWRONG',
    });
  });

  it('コードの無い時間切れは、検証プログラムが待ちきった（SDK から結果が返らなかった）時間切れ', () => {
    const stdout = line({ mode: 'auth', outcome: 'timeout', stage: 'auth' });
    expect(classifyProbeRun(run({ stdout, exitCode: 4 }))).toEqual({ kind: 'timed_out', by: 'probe' });
  });

  it('SDK が AUTHRET_OVERTIME を返した時間切れは、sdk による時間切れ', () => {
    const stdout = line({ mode: 'auth', outcome: 'timeout', stage: 'auth', code: 'AUTHRET_OVERTIME' });
    expect(classifyProbeRun(run({ stdout, exitCode: 4 }))).toEqual({ kind: 'timed_out', by: 'sdk' });
  });

  it('ホスト側で止めた場合は、出力に何があっても host による時間切れ', () => {
    const stdout = line({ mode: 'auth', outcome: 'succeeded' });
    expect(classifyProbeRun(run({ stdout, exitCode: null, hostTimedOut: true }))).toEqual({
      kind: 'timed_out',
      by: 'host',
    });
  });

  it('初期化の失敗は、段階とコードを残す', () => {
    const stdout = line({ mode: 'init', outcome: 'failed', stage: 'init', code: 'SDKERR_UNINITIALIZE' });
    expect(classifyProbeRun(run({ mode: 'init', stdout, exitCode: 1 }))).toEqual({
      kind: 'sdk_error',
      stage: 'init',
      code: 'SDKERR_UNINITIALIZE',
    });
  });

  it('後始末の失敗は成功にしない', () => {
    const stdout = line({ mode: 'init', outcome: 'failed', stage: 'cleanup', code: 'SDKERR_INTERNAL_ERROR' });
    expect(classifyProbeRun(run({ mode: 'init', stdout, exitCode: 1 }))).toEqual({
      kind: 'sdk_error',
      stage: 'cleanup',
      code: 'SDKERR_INTERNAL_ERROR',
    });
  });

  it('auth 段階の失敗でも AUTHRET 以外（SDKAuth 呼び出しの失敗）は sdk_error として扱う', () => {
    const stdout = line({ mode: 'auth', outcome: 'failed', stage: 'auth', code: 'SDKERR_INVALID_PARAMETER' });
    expect(classifyProbeRun(run({ stdout, exitCode: 1 }))).toEqual({
      kind: 'sdk_error',
      stage: 'auth',
      code: 'SDKERR_INVALID_PARAMETER',
    });
  });
});

describe('classifyProbeRun: docker がコンテナを起動できなかったとき', () => {
  const stderr = [
    'Unable to find image locally',
    'eyJhbGciOiJIUzI1NiJ9.secret-payload.secret-signature',
    'docker: Error response from daemon: pull access denied.',
    "docker: Run 'docker run --help' for more information",
    '',
  ].join('\n');

  it.each([125, 126, 127])('結果行がなく終了コード %i なら、docker: で始まる行だけを理由として持つ', (exitCode) => {
    expect(classifyProbeRun(run({ mode: 'init', exitCode, stderr }))).toEqual({
      kind: 'docker_failed',
      exitCode,
      dockerLines: [
        'docker: Error response from daemon: pull access denied.',
        "docker: Run 'docker run --help' for more information",
      ],
    });
  });

  it('--init の tini が検証プログラムを実行できなかったときは、その行（パスと理由だけ）も理由として持つ', () => {
    const tini = '[FATAL tini (6)] exec /opt/zoom-auth-probe/wacha-zoom-auth-probe failed: Permission denied';
    const text = describeOutcome(
      classifyProbeRun(run({ mode: 'init', exitCode: 126, stderr: `eyJ.secret-payload.x\n${tini}\n` })),
    );
    expect(text).toContain('Docker がコンテナを起動できませんでした（終了コード 126）');
    expect(text).toContain(tini);
    expect(text).not.toContain('secret-payload');
  });

  it('結果行がなく終了コード 1 なら、これまでどおり結果行がないとして扱う', () => {
    expect(classifyProbeRun(run({ exitCode: 1, stderr }))).toEqual({ kind: 'probe_error', reason: 'no_result' });
  });

  it('終了コード 125 でも結果行があれば、結果行で判定する', () => {
    const stdout = line({ mode: 'auth', outcome: 'failed', stage: 'init', code: 'SDKERR_UNKNOWN' });
    expect(classifyProbeRun(run({ exitCode: 125, stdout, stderr }))).toEqual({
      kind: 'sdk_error',
      stage: 'init',
      code: 'SDKERR_UNKNOWN',
    });
  });

  it('利用者向けの文言は終了コードと docker: の行を含み、それ以外の標準エラーを含まない', () => {
    const text = describeOutcome(classifyProbeRun(run({ mode: 'init', exitCode: 126, stderr })));
    expect(text).toContain('Docker がコンテナを起動できませんでした（終了コード 126）');
    expect(text).toContain('docker: Error response from daemon: pull access denied.');
    expect(text).not.toContain('secret-payload');
    expect(text).not.toContain('Unable to find image');
  });
});

describe('exitCodeFor', () => {
  it.each<[ProbeOutcome, number]>([
    [{ kind: 'succeeded', mode: 'init' }, 0],
    [{ kind: 'succeeded', mode: 'auth' }, 0],
    [{ kind: 'auth_failed', code: 'AUTHRET_KEYORSECRETWRONG' }, 3],
    [{ kind: 'timed_out', by: 'probe' }, 4],
    [{ kind: 'timed_out', by: 'sdk' }, 4],
    [{ kind: 'timed_out', by: 'host' }, 4],
    [{ kind: 'sdk_error', stage: 'init', code: 'SDKERR_UNKNOWN' }, 1],
    [{ kind: 'probe_error', reason: 'no_result' }, 1],
    [{ kind: 'docker_failed', exitCode: 125, dockerLines: [] }, 1],
    [{ kind: 'cleanup_failed', reason: 'remove_failed' }, 1],
    [{ kind: 'cleanup_failed', reason: 'check_failed' }, 1],
  ])('%j → %i', (outcome, code) => {
    expect(exitCodeFor(outcome)).toBe(code);
  });
});

describe('describeOutcome', () => {
  it('成功・失敗・時間切れを、それぞれ違う日本語の文言で伝える', () => {
    const texts = [
      describeOutcome({ kind: 'succeeded', mode: 'auth' }),
      describeOutcome({ kind: 'auth_failed', code: 'AUTHRET_JWTTOKENWRONG' }),
      describeOutcome({ kind: 'timed_out', by: 'sdk' }),
    ];
    expect(new Set(texts).size).toBe(3);
    expect(texts[1]).toContain('AUTHRET_JWTTOKENWRONG');
    expect(texts[0]).toContain('成功');
    expect(texts[1]).toContain('失敗');
    expect(texts[2]).toContain('時間切れ');
  });

  it('時間切れは、誰が待ちきったかで文言を分ける（SDK のコードがあるときだけ SDK 側の時間切れと書く）', () => {
    const probe = describeOutcome({ kind: 'timed_out', by: 'probe' });
    const sdk = describeOutcome({ kind: 'timed_out', by: 'sdk' });
    const host = describeOutcome({ kind: 'timed_out', by: 'host' });
    expect(new Set([probe, sdk, host]).size).toBe(3);
    expect(probe).toContain('SDK から認証の結果が返りませんでした');
    expect(probe).toContain('--timeout');
    expect(probe).not.toContain('SDK 側');
    expect(sdk).toContain('AUTHRET_OVERTIME');
  });
});
