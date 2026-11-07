import { spawn } from 'node:child_process';

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
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, [...options.args], {
      env: { ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let graceTimer: NodeJS.Timeout | undefined;

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    // 子が標準入力を読まずに終わった場合の EPIPE は、結果の判定に使わない
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.stdin ?? '');

    const timer = setTimeout(() => {
      timedOut = true;
      graceTimer = setTimeout(() => child.kill('SIGKILL'), options.killGraceMs);
      options.onTimeout().catch(() => undefined);
    }, options.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}
