// 検証プログラム（C++）の実行結果を判定し、終了コードと利用者向けの文言を決める。

export type ProbeMode = 'init' | 'auth';

/** 検証プログラムが標準出力に書く結果行の接頭辞。 */
export const RESULT_LINE_PREFIX = 'WACHA_PROBE_RESULT ';

export interface ProbeRun {
  readonly mode: ProbeMode;
  /** 子プロセスの終了コード。シグナルで止まった場合は null。 */
  readonly exitCode: number | null;
  readonly stdout: string;
  /** docker run の標準エラー。docker が起動に失敗したときの理由（docker: で始まる行）だけを使う */
  readonly stderr?: string;
  /** ホスト側の上限時間を過ぎて止めたか。 */
  readonly hostTimedOut: boolean;
}

export type ProbeOutcome =
  | { readonly kind: 'succeeded'; readonly mode: ProbeMode }
  | { readonly kind: 'auth_failed'; readonly code: string }
  | { readonly kind: 'timed_out'; readonly by: 'sdk' | 'host' }
  | { readonly kind: 'sdk_error'; readonly stage: 'init' | 'auth' | 'cleanup'; readonly code: string }
  | { readonly kind: 'probe_error'; readonly reason: 'no_result' | 'malformed_result' | 'inconsistent_result' }
  /** docker がコンテナを起動できなかった（結果行がなく、終了コード 125 / 126 / 127） */
  | { readonly kind: 'docker_failed'; readonly exitCode: number; readonly dockerLines: readonly string[] }
  /** 検証プログラムは成功したが、コンテナを削除できなかった・残りを確認できなかった */
  | { readonly kind: 'cleanup_failed'; readonly reason: 'remove_failed' | 'check_failed' };

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
  if (raw === undefined) {
    if (run.exitCode !== null && DOCKER_RUN_FAILURE_CODES.has(run.exitCode)) {
      return { kind: 'docker_failed', exitCode: run.exitCode, dockerLines: dockerErrorLines(run.stderr ?? '') };
    }
    return { kind: 'probe_error', reason: 'no_result' };
  }

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

/** docker run 自身の失敗を表す終了コード（125: docker の失敗、126: 実行できない、127: 見つからない） */
const DOCKER_RUN_FAILURE_CODES: ReadonlySet<number> = new Set([125, 126, 127]);

/**
 * 標準エラーから docker CLI 自身のエラー（docker: で始まる行）だけを取り出す。
 * JWT は標準入力で渡し引数・環境変数に載せないので、これらの行に秘密は入らない。
 * 検証プログラムや SDK の出力は、何を含むか分からないため出さない。
 */
export function dockerErrorLines(stderr: string): string[] {
  return stderr.split('\n').filter((line) => line.startsWith('docker: '));
}

/** 後始末（コンテナの残りの確認・削除）の結果 */
export type CleanupResult = 'absent' | 'removed' | 'remove_failed' | 'check_failed';

/**
 * 後始末の結果を判定に加える。コンテナを削除できない・残りを確認できないときは成功にしない。
 * 検証プログラムがすでに失敗・時間切れなら、その結果（終了コード）を保つ。
 */
export function withCleanup(outcome: ProbeOutcome, cleanup: CleanupResult): ProbeOutcome {
  if (cleanup === 'absent' || cleanup === 'removed') return outcome;
  return outcome.kind === 'succeeded' ? { kind: 'cleanup_failed', reason: cleanup } : outcome;
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
    case 'docker_failed':
    case 'cleanup_failed':
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
    case 'docker_failed':
      return [
        `Docker がコンテナを起動できませんでした（終了コード ${outcome.exitCode}）。イメージ名と、検証プログラムのビルドを確認してください。`,
        ...outcome.dockerLines,
      ].join('\n');
    case 'cleanup_failed':
      return outcome.reason === 'remove_failed'
        ? '検証プログラムは成功しましたが、コンテナを削除できませんでした。成功とは扱いません。'
        : '検証プログラムは成功しましたが、コンテナが残っていないことを確認できませんでした。成功とは扱いません。';
  }
}
