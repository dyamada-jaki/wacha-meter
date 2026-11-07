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

export function classifyProbeRun(run: ProbeRun): ProbeOutcome {
  void run;
  throw new Error('未実装');
}

export function exitCodeFor(outcome: ProbeOutcome): number {
  void outcome;
  throw new Error('未実装');
}

export function describeOutcome(outcome: ProbeOutcome): string {
  void outcome;
  throw new Error('未実装');
}
