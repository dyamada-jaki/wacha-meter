// 検証プログラム（C++）の実行結果を判定し、終了コードと利用者向けの文言を決める。

export type ProbeMode = 'init' | 'auth';

/** 検証プログラムが標準出力に書く結果行の接頭辞。 */
export const RESULT_LINE_PREFIX = 'WACHA_PROBE_RESULT ';

export interface ProbeRun {
  readonly mode: ProbeMode;
  /** 子プロセスの終了コード。シグナルで止まった場合は null。 */
  readonly exitCode: number | null;
  readonly stdout: string;
  /** ホスト側の上限時間を過ぎて止めたか。 */
  readonly hostTimedOut: boolean;
}

export type ProbeOutcome =
  | { readonly kind: 'succeeded'; readonly mode: ProbeMode }
  | { readonly kind: 'auth_failed'; readonly code: string }
  | { readonly kind: 'timed_out'; readonly by: 'sdk' | 'host' }
  | { readonly kind: 'sdk_error'; readonly stage: 'init' | 'auth' | 'cleanup'; readonly code: string }
  | { readonly kind: 'probe_error'; readonly reason: 'no_result' | 'malformed_result' | 'inconsistent_result' };

export const EXIT_CODES = {
  success: 0,
  other: 1,
  config: 2,
  authFailed: 3,
  timedOut: 4,
} as const;

interface ResultLine {
  readonly mode: ProbeMode;
  readonly outcome: 'succeeded' | 'failed' | 'timeout';
  readonly stage?: 'init' | 'auth' | 'cleanup';
  readonly code?: string;
}

export function classifyProbeRun(run: ProbeRun): ProbeOutcome {
  if (run.hostTimedOut) return { kind: 'timed_out', by: 'host' };

  const raw = run.stdout
    .split('\n')
    .filter((line) => line.startsWith(RESULT_LINE_PREFIX))
    .at(-1);
  if (raw === undefined) return { kind: 'probe_error', reason: 'no_result' };

  const result = parseResultLine(raw.slice(RESULT_LINE_PREFIX.length));
  if (result === undefined) return { kind: 'probe_error', reason: 'malformed_result' };
  if (result.mode !== run.mode) return { kind: 'probe_error', reason: 'inconsistent_result' };

  switch (result.outcome) {
    case 'succeeded':
      return run.exitCode === EXIT_CODES.success
        ? { kind: 'succeeded', mode: run.mode }
        : { kind: 'probe_error', reason: 'inconsistent_result' };
    case 'timeout':
      return { kind: 'timed_out', by: 'sdk' };
    case 'failed': {
      const stage = result.stage ?? 'init';
      const code = result.code ?? 'UNKNOWN';
      if (run.exitCode === EXIT_CODES.success) return { kind: 'probe_error', reason: 'inconsistent_result' };
      if (stage === 'auth' && code.startsWith('AUTHRET_')) return { kind: 'auth_failed', code };
      return { kind: 'sdk_error', stage, code };
    }
  }
}

function parseResultLine(json: string): ResultLine | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const { mode, outcome, stage, code } = record;
  if (mode !== 'init' && mode !== 'auth') return undefined;
  if (outcome !== 'succeeded' && outcome !== 'failed' && outcome !== 'timeout') return undefined;
  if (stage !== undefined && stage !== 'init' && stage !== 'auth' && stage !== 'cleanup') return undefined;
  if (code !== undefined && (typeof code !== 'string' || !/^[A-Z0-9_]+$/.test(code))) return undefined;
  return {
    mode,
    outcome,
    ...(stage === undefined ? {} : { stage }),
    ...(code === undefined ? {} : { code }),
  };
}

export function exitCodeFor(outcome: ProbeOutcome): number {
  switch (outcome.kind) {
    case 'succeeded':
      return EXIT_CODES.success;
    case 'auth_failed':
      return EXIT_CODES.authFailed;
    case 'timed_out':
      return EXIT_CODES.timedOut;
    case 'sdk_error':
    case 'probe_error':
      return EXIT_CODES.other;
  }
}

const STAGE_LABELS = { init: '初期化', auth: '認証の呼び出し', cleanup: '後始末' } as const;
const PROBE_ERROR_LABELS = {
  no_result: '結果行がありません',
  malformed_result: '結果行を読めません',
  inconsistent_result: '結果行と終了コードが食い違っています',
} as const;

export function describeOutcome(outcome: ProbeOutcome): string {
  switch (outcome.kind) {
    case 'succeeded':
      return outcome.mode === 'init'
        ? 'SDK の初期化と後始末に成功しました。'
        : 'SDK の認証に成功しました（会議には参加していません）。';
    case 'auth_failed':
      return `SDK の認証に失敗しました（${outcome.code}）。認証情報と、アプリで Meeting SDK が有効かを確認してください。`;
    case 'timed_out':
      return outcome.by === 'sdk'
        ? 'SDK の認証が時間切れになりました（SDK 側の待ち時間を超えました）。ネットワークを確認してください。'
        : '検証プログラムが時間切れになったため停止しました（ホスト側の上限を超えました）。';
    case 'sdk_error':
      return `SDK の${STAGE_LABELS[outcome.stage]}に失敗しました（${outcome.code}）。`;
    case 'probe_error':
      return `検証プログラムの結果を確認できませんでした（${PROBE_ERROR_LABELS[outcome.reason]}）。成功とは扱いません。`;
  }
}
