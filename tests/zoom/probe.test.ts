import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createJwt, loadCredentials, runProbe } from '../../src/zoom/probe.js';

let temporary: string;
beforeAll(async () => { temporary = await mkdtemp(join(tmpdir(), 'wacha-issue-1-codex-')); });
afterAll(async () => { await rm(temporary, { recursive: true, force: true }); });

describe('秘密の設定とJWT', () => {
  it('未指定・不存在・不正JSON・空値を固定エラーにする', async () => {
    const file = join(temporary, 'credentials.json');
    for (const content of ['{private-value', '{}', '{"clientId":"dummy-id","clientSecret":""}']) {
      await writeFile(file, content, { mode: 0o600 });
      await expect(loadCredentials(file)).rejects.toThrow(/^認証情報を設定してください。$/);
    }
    await expect(loadCredentials()).rejects.toThrow(/^認証情報を設定してください。$/);
    await expect(loadCredentials(join(temporary, 'absent'))).rejects.toThrow(/^認証情報を設定してください。$/);
  });
  it('ローカル設定を読み、仕様のclaimとHS256署名を作る', async () => {
    const file = join(temporary, 'valid.json');
    await writeFile(file, JSON.stringify({ clientId: 'dummy-id', clientSecret: 'dummy-secret' }), { mode: 0o600 });
    const credentials = await loadCredentials(file);
    const jwt = createJwt(credentials, 2_000_000_000);
    const [header, payload, signature] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      appKey: 'dummy-id', iat: 1_999_999_970, exp: 2_000_001_800, tokenExp: 2_000_001_800,
    });
    expect(signature).toBe(createHmac('sha256', 'dummy-secret').update(`${header}.${payload}`).digest('base64url'));
    expect(jwt).not.toContain('dummy-secret');
  });
});

describe('C++のライフサイクル（SDK境界だけfake）', () => {
  let executable: string;
  beforeAll(() => {
    executable = join(temporary, 'lifecycle');
    // コンパイラ不在も失敗。SDKなしのMac/Ubuntuで同じ状態処理を検証する。
    execFileSync('c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-Iprototypes/zoom',
      'tests/zoom/lifecycle.cpp', '-o', executable]);
  });
  it.each([
    ['success', 0, 1, 1, 1], ['init-only', 0, 1, 1, 0],
    ['failure', 4, 1, 1, 1], ['api-failure', 4, 1, 1, 1],
    ['sdk-timeout', 5, 1, 1, 1], ['pending', 5, 1, 1, 1],
    ['rate-limit', 9, 1, 1, 1], ['init-failure', 3, 0, 1, 0],
    ['cleanup-failure', 6, 1, 0, 1], ['interrupted', 7, 0, 1, 0],
  ])('%s: 結果を区別し後始末して再試行しない', (scenario, code, initialized, cleaned, attempts) => {
    const actual = execFileSync(executable, [String(scenario)], { encoding: 'utf8', timeout: 2000 }).trim();
    expect(actual).toBe(`${code} ${initialized} ${cleaned} 0 ${attempts}`);
  });
});

async function dockerFixture(mode: 'success' | 'failure' | 'hang') {
  const directory = await mkdtemp(join(temporary, 'docker-'));
  const executable = join(directory, 'docker.mjs');
  const actions = join(directory, 'actions.jsonl');
  const input = join(directory, 'input');
  await writeFile(executable, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(actions)}, JSON.stringify(process.argv.slice(2))+'\\n');
if (process.argv[2] === 'rm') process.exit(0);
process.stdin.on('data', d => fs.appendFileSync(${JSON.stringify(input)}, d));
console.log('SDK raw dummy-secret and dummy-jwt');
console.error('SDK stderr dummy-secret');
${mode === 'hang' ? 'setInterval(() => {}, 1000);' : `console.log('WACHA_INIT_OK'); console.log('WACHA_CLEAN_OK'); console.log('WACHA_RESULT_${mode === 'success' ? 0 : 4}'); process.stdin.resume(); process.stdin.on('end', () => process.exit(${mode === 'success' ? 0 : 4}));`}
`, { mode: 0o700 });
  return { executable, actions, input };
}

describe('起動プロセス（docker境界だけfixture）', () => {
  it('資格情報未設定ではプロセスを起動せず非0にする', async () => {
    const result = await runProbe({ sdkPath: temporary, binaryPath: temporary, dockerCommand: '/absent' });
    expect(result).toEqual({ code: 2, messages: ['認証情報を設定してください。'] });
  });
  it.each(['success', 'failure'] as const)('%s: 秘密をstdinだけへ送り固定結果のみ公開する', async mode => {
    const fixture = await dockerFixture(mode);
    const credentialsPath = join(temporary, `creds-${mode}.json`);
    await writeFile(credentialsPath, '{"clientId":"dummy-id","clientSecret":"dummy-secret"}', { mode: 0o600 });
    const result = await runProbe({ sdkPath: temporary, binaryPath: resolve('package.json'), credentialsPath, dockerCommand: fixture.executable });
    expect(result.code).toBe(mode === 'success' ? 0 : 4);
    expect(result.messages).toContain('SDK の初期化に成功しました。');
    expect(result.messages).toContain('SDK の後始末に成功しました。');
    expect(result.messages).toContain(mode === 'success' ? '認証に成功しました。' : '認証に失敗しました。');
    expect(JSON.stringify(result)).not.toMatch(/dummy-|raw|stderr/);
    const actions = (await readFile(fixture.actions, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[]);
    expect(actions).toHaveLength(2);
    expect(actions[0]).toContain('--read-only');
    expect(JSON.stringify(actions)).not.toMatch(/dummy-|eyJ/);
    expect(actions[1]?.slice(0, 2)).toEqual(['rm', '-f']);
    expect(actions[1]?.[2]).toMatch(/^wacha-issue-1-codex-/);
    expect(await readFile(fixture.input, 'utf8')).toMatch(/^eyJ[^\s]+\n$/);
  });
  it.each(['deadline', 'interrupt'] as const)('%s: 有限時間で終了し自分のコンテナを削除する', async mode => {
    const fixture = await dockerFixture('hang');
    const controller = new AbortController();
    const timer = mode === 'interrupt' ? setTimeout(() => controller.abort(), 150) : undefined;
    try {
      const result = await runProbe({ sdkPath: temporary, binaryPath: resolve('package.json'), initOnly: true,
        dockerCommand: fixture.executable, deadlineMs: 300, signal: controller.signal });
      expect(result.code).toBe(mode === 'deadline' ? 5 : 7);
      const actions = (await readFile(fixture.actions, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[]);
      expect(actions.at(-1)?.slice(0, 2)).toEqual(['rm', '-f']);
      expect(JSON.stringify(result)).not.toMatch(/dummy-|raw|stderr/);
    } finally { clearTimeout(timer); }
  });
});
