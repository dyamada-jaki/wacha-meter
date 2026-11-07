// 子プロセスを有限時間で終わらせる。上限を過ぎたら onTimeout（docker kill など）を呼び、
// それでも終わらなければ子プロセスを強制終了する。

export interface RunWithTimeoutOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** 標準入力に書いて閉じる文字列。省略時は空で閉じる。 */
  readonly stdin?: string;
  readonly timeoutMs: number;
  /** onTimeout のあと、子プロセスを SIGKILL するまでの猶予 */
  readonly killGraceMs: number;
  readonly onTimeout: () => Promise<void>;
}

export interface RunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export function runWithTimeout(options: RunWithTimeoutOptions): Promise<RunResult> {
  void options;
  return Promise.reject(new Error('未実装'));
}
