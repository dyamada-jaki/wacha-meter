import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';

export interface Credentials { clientId: string; clientSecret: string }
export interface ProbeOptions {
  sdkPath: string;
  binaryPath: string;
  credentialsPath?: string;
  initOnly?: boolean;
  dockerCommand?: string;
  deadlineMs?: number;
  signal?: AbortSignal;
}

export function createJwt(credentials: Credentials, nowSeconds: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({ appKey: credentials.clientId, iat: nowSeconds - 30,
    exp: nowSeconds + 1800, tokenExp: nowSeconds + 1800 });
  const signature = createHmac('sha256', credentials.clientSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

export async function loadCredentials(path?: string): Promise<Credentials> {
  try {
    if (!path) throw new Error();
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object' || !('clientId' in value) || !('clientSecret' in value)
      || typeof value.clientId !== 'string' || !value.clientId.trim()
      || typeof value.clientSecret !== 'string' || !value.clientSecret.trim()) throw new Error();
    return { clientId: value.clientId, clientSecret: value.clientSecret };
  } catch { throw new Error('認証情報を設定してください。'); }
}

const descriptions: Record<number, string> = {
  0: '認証に成功しました。', 2: '認証情報を設定してください。',
  3: 'SDK の初期化に失敗しました。', 4: '認証に失敗しました。',
  5: '制限時間を超過しました。', 6: '後始末に失敗しました。',
  7: '中断しました。', 8: '実行環境を確認してください。',
  9: '認証の回数制限を検出しました。再実行を止めてください。',
};

// docker のエラー本文・SDK の生出力には秘密が含まれ得るため返さない。
async function dockerControl(command: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'ignore' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    child.once('error', () => { clearTimeout(timer); resolve(false); });
    child.once('close', code => { clearTimeout(timer); resolve(code === 0); });
  });
}

export async function runProbe(options: ProbeOptions): Promise<{ code: number; messages: string[] }> {
  let token = '';
  if (!options.initOnly) {
    try { token = createJwt(await loadCredentials(options.credentialsPath), Math.floor(Date.now() / 1000)); }
    catch { return { code: 2, messages: [descriptions[2]!] }; }
  }
  if (options.signal?.aborted) return { code: 7, messages: [descriptions[7]!] };
  let sdkPath: string, binaryPath: string;
  try {
    sdkPath = await realpath(options.sdkPath);
    binaryPath = await realpath(options.binaryPath);
    if (!(await stat(sdkPath)).isDirectory() || !(await stat(binaryPath)).isFile()) throw new Error();
  } catch { return { code: 8, messages: [descriptions[8]!] }; }
  const name = `wacha-issue-1-codex-${randomUUID()}`;
  const command = options.dockerCommand ?? 'docker';
  // --rm には頼らず、下の rm 成功を終了条件にする（daemon 不通を削除済みと誤認しない）。
  const args = ['run', '--init', '--name', name, '--platform', 'linux/arm64', '-i',
    '--read-only', '--log-driver', 'none', '--ulimit', 'core=0',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,nosuid,nodev', '--tmpfs', '/home/probe:rw,uid=10001,gid=10001,mode=700',
    '--mount', `type=bind,source=${sdkPath},target=/opt/zoom-sdk,readonly`,
    '--mount', `type=bind,source=${binaryPath},target=/opt/wacha-probe,readonly`,
    ...(options.initOnly ? ['--network', 'none'] : []),
    '--env', 'LD_LIBRARY_PATH=/opt/zoom-sdk:/opt/zoom-sdk/qt_libs:/opt/zoom-sdk/qt_libs/Qt/lib',
    'wacha-meter-issue-1-codex:local', '/opt/wacha-probe', options.initOnly ? '--init-only' : '--auth'];
  const markers = new Set<string>();
  let forced: number | undefined;
  const code = await new Promise<number>(resolve => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: number) => {
      if (forced !== undefined) return;
      forced = reason;
      // CLI へ転送し SDK の後始末を試す。反応しない場合はコンテナごと除去する。
      child.kill('SIGTERM');
      killTimer = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
    };
    const abort = () => stop(7);
    const timer = setTimeout(() => stop(5), options.deadlineMs ?? 45000);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      // 長大な行も保持せず、任意の SDK 出力をログや成果物にしない。
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      if (buffer.length > 4096) buffer = '';
      for (const line of lines) if (/^WACHA_(INIT_OK|CLEAN_OK|RESULT_[0-9])$/.test(line)) markers.add(line);
    });
    child.stdin.on('error', () => { /* 起動失敗・早期終了時にも秘密を出さない */ });
    child.stdin.end(token ? `${token}\n` : '');
    token = '';
    const finish = (exitCode: number | null) => {
      clearTimeout(timer); clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', abort);
      const complete = exitCode !== null && markers.has(`WACHA_RESULT_${exitCode}`)
        && (exitCode !== 0 || (markers.has('WACHA_INIT_OK') && markers.has('WACHA_CLEAN_OK')));
      resolve(forced ?? (complete ? exitCode! : 8));
    };
    child.once('error', () => finish(null));
    child.once('close', finish);
  });
  // 自分の一意な名前だけを削除し、削除確認ができない場合は成功としない。
  const removed = await dockerControl(command, ['rm', '-f', name]);
  const finalCode = removed ? code : 6;
  const messages: string[] = [];
  if (markers.has('WACHA_INIT_OK')) messages.push('SDK の初期化に成功しました。');
  if (markers.has('WACHA_CLEAN_OK')) messages.push('SDK の後始末に成功しました。');
  messages.push(finalCode === 0 && options.initOnly ? '初期化の確認を終了しました。' : descriptions[finalCode] ?? descriptions[8]!);
  return { code: finalCode, messages };
}
