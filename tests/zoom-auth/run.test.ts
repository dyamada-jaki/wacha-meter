// docker の代わりに node の子プロセスを使う（CI に Docker と SDK が無いため）。
// 実物の docker / SDK との接続は、手元の実 SDK 実行で確かめる（PR に記録）。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runWithTimeout } from '../../src/zoom-auth/run.js';
import { processAlive } from './fake-docker.js';

const env = { PATH: process.env.PATH ?? '' };

function node(script: string) {
  return { command: process.execPath, args: ['-e', script], env };
}

describe('runWithTimeout', () => {
  it('上限内に終われば、終了コードと出力をそのまま返す', async () => {
    const result = await runWithTimeout({
      ...node('process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'),
      timeoutMs: 5000,
      killGraceMs: 500,
      onTimeout: async () => {
        throw new Error('呼ばれないはず');
      },
    });
    expect(result).toEqual({ exitCode: 3, stdout: 'out', stderr: 'err', timedOut: false });
  });

  it('標準入力に渡した文字列を子プロセスが受け取れる（JWT の受け渡し）', async () => {
    const result = await runWithTimeout({
      ...node('let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(String(s.length)+":"+s.slice(0,4)))'),
      stdin: 'aaaa.bbbb.cccc\n',
      timeoutMs: 5000,
      killGraceMs: 500,
      onTimeout: async () => undefined,
    });
    expect(result.stdout).toBe('15:aaaa');
    expect(result.timedOut).toBe(false);
  });

  it('上限を過ぎたら onTimeout を呼び、それで止まった子の終了を待って時間切れとして返す', async () => {
    // onTimeout（実物では docker kill）が合図のファイルを作ると、子は自分で終了コード 137 で終わる
    const dir = mkdtempSync(join(tmpdir(), 'wacha-run-test-'));
    const signal = join(dir, 'stop');
    const started = Date.now();
    try {
      const result = await runWithTimeout({
        ...node(`const fs=require("fs");setInterval(()=>{if(fs.existsSync(${JSON.stringify(signal)}))process.exit(137)},20)`),
        timeoutMs: 300,
        killGraceMs: 5000,
        onTimeout: async () => {
          writeFileSync(signal, '');
        },
      });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(137);
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('onTimeout で止まらない子は、猶予のあと強制終了して有限時間で返す', async () => {
    const started = Date.now();
    const result = await runWithTimeout({
      ...node('process.on("SIGTERM",()=>{}); setInterval(() => {}, 1000)'),
      timeoutMs: 200,
      killGraceMs: 300,
      onTimeout: async () => undefined,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('onTimeout が失敗しても、子は強制終了して時間切れとして返す', async () => {
    const result = await runWithTimeout({
      ...node('setInterval(() => {}, 1000)'),
      timeoutMs: 200,
      killGraceMs: 300,
      onTimeout: async () => {
        throw new Error('docker kill に失敗');
      },
    });
    expect(result.timedOut).toBe(true);
  });

  it('中断（abort）で reject するときは、子プロセスの終了を待ってから reject する', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wacha-run-abort-'));
    try {
      const pidFile = join(dir, 'child.pid');
      const abort = new AbortController();
      const running = runWithTimeout({
        ...node(`require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`),
        timeoutMs: 10000,
        killGraceMs: 300,
        onTimeout: async () => undefined,
        abortSignal: abort.signal,
      });
      const started = Date.now();
      while (!existsSync(pidFile) || readFileSync(pidFile, 'utf8') === '') {
        if (Date.now() - started > 5000) throw new Error('子プロセスが起動しませんでした');
        await new Promise((r) => setTimeout(r, 20));
      }
      const pid = Number(readFileSync(pidFile, 'utf8'));
      abort.abort();
      await expect(running).rejects.toMatchObject({ name: 'AbortError' });
      // reject した時点で、子プロセスは終了して回収されている（待たずに確かめる）
      expect(processAlive(pid)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
