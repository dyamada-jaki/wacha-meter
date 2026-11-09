import { spawn } from 'node:child_process';

/** Macの既定ブラウザへ渡す。URLやOSのエラー出力は表示しない。 */
export function openBrowser(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('ブラウザ起動を中断しました。')); return; }
    const env: NodeJS.ProcessEnv = {};
    for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG']) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    const child = spawn('open', [url], { stdio: 'ignore', env });
    const abort = () => { child.kill('SIGKILL'); };
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('ブラウザを起動できませんでした。'));
    });
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (code === 0 && !signal.aborted) resolve();
      else reject(new Error('ブラウザを起動できませんでした。'));
    });
    if (signal.aborted) abort();
  });
}
