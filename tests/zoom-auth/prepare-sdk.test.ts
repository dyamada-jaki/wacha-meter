// SDK の準備スクリプト（prototypes/zoom/scripts/）を実際のシェルと tar で動かす。
// 本物の SDK は CI に置けないため、同じ「Linux-all」形式（<最上位>/arm64/・<最上位>/x86_64/）の
// 小さなアーカイブを作って確かめる。SHA-256 の照合は本物のアーカイブだけが通るので、
// 照合後の展開・ELF の確認は extract-sdk-arm64.sh を直接呼んで確かめる。
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPTS = resolve('prototypes/zoom/scripts');
const TOP = 'zoom-sdk-linux-0.0.0.1';

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'wacha-prepare-sdk-'));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

/** ELF64 リトルエンディアンのヘッダーだけを持つファイルの中身（e_machine を指定） */
function elfHeader(machine: number): Buffer {
  const header = Buffer.alloc(64);
  header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  header.writeUInt16LE(3, 16); // ET_DYN
  header.writeUInt16LE(machine, 18);
  return header;
}
const AARCH64 = 183;
const X86_64 = 62;

/** Linux-all 形式のアーカイブを作る。arm64 側の libmeetingsdk.so の中身と、追加のシンボリックリンク（arm64/ からの相対パス → リンク先）を選べる */
function makeArchive(arm64Library: Buffer | undefined, links: Record<string, string> = {}): string {
  const src = join(work, 'src');
  const arm = join(src, TOP, 'arm64');
  const x86 = join(src, TOP, 'x86_64');
  mkdirSync(join(arm, 'h'), { recursive: true });
  mkdirSync(join(arm, 'libglib2/lib'), { recursive: true });
  mkdirSync(x86, { recursive: true });
  if (arm64Library) writeFileSync(join(arm, 'libmeetingsdk.so'), arm64Library);
  writeFileSync(join(arm, 'h/zoom_sdk.h'), '// header\n');
  writeFileSync(join(arm, 'libglib2/lib/libglib-2.0.so.0.7200.4'), '');
  symlinkSync('libglib-2.0.so.0.7200.4', join(arm, 'libglib2/lib/libglib-2.0.so.0'));
  for (const [path, target] of Object.entries(links)) symlinkSync(target, join(arm, path));
  writeFileSync(join(x86, 'libmeetingsdk.so'), elfHeader(X86_64));
  writeFileSync(join(src, TOP, 'version.txt'), 'v0.0.0.1\n');
  const archive = join(work, 'sdk.tar.xz');
  const tar = spawnSync('tar', ['-cJf', archive, '-C', src, TOP]);
  expect(tar.status).toBe(0);
  return archive;
}

function extract(archive: string, dest: string) {
  return spawnSync('bash', [join(SCRIPTS, 'extract-sdk-arm64.sh'), archive, dest, `${TOP}/arm64`], { encoding: 'utf8' });
}

describe('SDK の arm64 部分の展開（extract-sdk-arm64.sh）', () => {
  it('Linux-all 形式から arm64/ の中身だけを展開先の直下に置く（x86_64 と最上位フォルダは置かない）', () => {
    const dest = join(work, 'out/sdk');
    const result = extract(makeArchive(elfHeader(AARCH64)), dest);
    expect(result.status).toBe(0);
    expect(existsSync(join(dest, 'libmeetingsdk.so'))).toBe(true);
    expect(existsSync(join(dest, 'h/zoom_sdk.h'))).toBe(true);
    expect(readlinkSync(join(dest, 'libglib2/lib/libglib-2.0.so.0'))).toBe('libglib-2.0.so.0.7200.4');
    expect(existsSync(join(dest, 'x86_64'))).toBe(false);
    expect(existsSync(join(dest, TOP))).toBe(false);
    expect(existsSync(join(dest, 'version.txt'))).toBe(false);
  });

  it('arm64/ の libmeetingsdk.so が AArch64 の ELF でなければ失敗し、展開先を作らない', () => {
    const dest = join(work, 'out/sdk');
    const result = extract(makeArchive(elfHeader(X86_64)), dest);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('AArch64');
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(join(work, 'out'))).toBe(false);
  });

  it('arm64/ に libmeetingsdk.so がなければ失敗し、展開先を作らない', () => {
    const dest = join(work, 'out/sdk');
    const result = extract(makeArchive(undefined), dest);
    expect(result.status).not.toBe(0);
    expect(existsSync(dest)).toBe(false);
  });

  it('失敗したとき、処理前からある空の祖先ディレクトリは消さない（今回作った親だけを消す）', () => {
    const keep = join(work, 'keep');
    mkdirSync(keep);
    const dest = join(keep, 'new-parent/sdk');
    const result = extract(makeArchive(elfHeader(X86_64)), dest);
    expect(result.status).not.toBe(0);
    expect(existsSync(join(keep, 'new-parent'))).toBe(false);
    expect(lstatSync(keep).isDirectory()).toBe(true);
    expect(lstatSync(work).isDirectory()).toBe(true);
  });

  it('展開先の外を指す絶対パスのシンボリックリンクがあれば失敗し、展開先と一時フォルダを残さない', () => {
    const outside = join(work, 'outside.txt');
    writeFileSync(outside, 'x');
    const parent = join(work, 'out');
    mkdirSync(parent);
    const dest = join(parent, 'sdk');
    const result = extract(makeArchive(elfHeader(AARCH64), { 'h/evil': outside }), dest);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('h/evil');
    expect(existsSync(dest)).toBe(false);
    expect(readdirSync(parent)).toEqual([]);
  });

  it('.. で展開先の外に出る相対パスのシンボリックリンクがあれば失敗し、展開先を作らない', () => {
    const dest = join(work, 'out/sdk');
    const result = extract(makeArchive(elfHeader(AARCH64), { 'h/evil': '../../outside.txt' }), dest);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('h/evil');
    expect(existsSync(dest)).toBe(false);
  });

  it('展開先の中を指す相対パスのシンボリックリンク（.. で上がっても中に留まるもの）は許す', () => {
    const dest = join(work, 'out/sdk');
    const result = extract(makeArchive(elfHeader(AARCH64), { 'h/lib': '../libmeetingsdk.so', 'h/self': './zoom_sdk.h' }), dest);
    expect(result.status).toBe(0);
    expect(readlinkSync(join(dest, 'h/lib'))).toBe('../libmeetingsdk.so');
    expect(readlinkSync(join(dest, 'h/self'))).toBe('./zoom_sdk.h');
    expect(readlinkSync(join(dest, 'libglib2/lib/libglib-2.0.so.0'))).toBe('libglib-2.0.so.0.7200.4');
  });

  it('展開先がすでにあれば、上書きせずに失敗する', () => {
    const dest = join(work, 'sdk');
    mkdirSync(dest);
    writeFileSync(join(dest, 'keep'), 'x');
    const result = extract(makeArchive(elfHeader(AARCH64)), dest);
    expect(result.status).not.toBe(0);
    expect(lstatSync(join(dest, 'keep')).isFile()).toBe(true);
    expect(existsSync(join(dest, 'libmeetingsdk.so'))).toBe(false);
  });
});

describe('SDK の準備（prepare-sdk.sh）', () => {
  it('SHA-256 が受領記録と一致しないアーカイブは展開しない', () => {
    const dest = join(work, 'sdk');
    const result = spawnSync('bash', [join(SCRIPTS, 'prepare-sdk.sh'), makeArchive(elfHeader(AARCH64)), dest], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SHA-256');
    expect(existsSync(dest)).toBe(false);
  });
});
