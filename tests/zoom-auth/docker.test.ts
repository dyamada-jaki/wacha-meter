import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildChildEnv,
  buildDockerKillArgs,
  buildDockerRunArgs,
  makeContainerName,
  type DockerRunOptions,
} from '../../src/zoom-auth/docker.js';

const base: DockerRunOptions = {
  image: 'wacha-meter-zoom-dev:issue-1-claude',
  containerName: 'wacha-meter-zoom-auth-issue-1-claude-abc123',
  sdkDir: '/work/.local/zoom-sdk/7.1.5.4434',
  probeBuildDir: '/work/.local/zoom-auth-probe/build',
  mode: 'auth',
  authTimeoutSeconds: 30,
  offline: false,
};

function valueAfter(args: readonly string[], flag: string): string[] {
  return args.flatMap((arg, i) => (arg === flag ? [args[i + 1] ?? ''] : []));
}

describe('buildDockerRunArgs', () => {
  let args: string[] = [];
  beforeAll(() => {
    args = buildDockerRunArgs(base);
  });

  it('使い終わったら消える arm64 のコンテナを、名前付きで標準入力を開いて起動する', () => {
    expect(args[0]).toBe('run');
    expect(args).toContain('--rm');
    expect(args).toContain('-i');
    expect(valueAfter(args, '--platform')).toEqual(['linux/arm64']);
    expect(valueAfter(args, '--name')).toEqual([base.containerName]);
  });

  it('SDK とビルド結果は読み取り専用でマウントする', () => {
    const mounts = valueAfter(args, '-v');
    expect(mounts).toEqual([
      '/work/.local/zoom-sdk/7.1.5.4434:/opt/zoom-sdk:ro',
      '/work/.local/zoom-auth-probe/build:/opt/zoom-auth-probe:ro',
    ]);
  });

  it('イメージ名のあとに検証プログラムと mode・待ち時間を渡す', () => {
    const imageIndex = args.indexOf(base.image);
    expect(imageIndex).toBeGreaterThan(0);
    expect(args.slice(imageIndex + 1)).toEqual(['/opt/zoom-auth-probe/wacha-zoom-auth-probe', 'auth', '30']);
  });

  it('init では待ち時間を渡さない', () => {
    const initArgs = buildDockerRunArgs({ ...base, mode: 'init' });
    expect(initArgs.slice(initArgs.indexOf(base.image) + 1)).toEqual([
      '/opt/zoom-auth-probe/wacha-zoom-auth-probe',
      'init',
    ]);
  });

  it('offline のときだけネットワークを切る', () => {
    expect(valueAfter(args, '--network')).toEqual([]);
    expect(valueAfter(buildDockerRunArgs({ ...base, offline: true }), '--network')).toEqual(['none']);
  });

  it('環境変数（-e / --env / --env-file）でコンテナへ値を渡さない', () => {
    expect(args.filter((a) => a === '-e' || a.startsWith('--env'))).toEqual([]);
  });
});

describe('buildDockerKillArgs', () => {
  it('名前を指定して kill する', () => {
    expect(buildDockerKillArgs('wacha-x')).toEqual(['kill', 'wacha-x']);
  });
});

describe('buildChildEnv', () => {
  it('Docker の接続に必要な変数だけを残し、Zoom の認証情報や無関係な変数は渡さない', () => {
    const env = buildChildEnv({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      DOCKER_HOST: 'unix:///x.sock',
      DOCKER_CONTEXT: 'orbstack',
      DOCKER_CONFIG: '/Users/me/.docker',
      ZOOM_SDK_CLIENT_ID: 'test-client-id',
      ZOOM_SDK_CLIENT_SECRET: 'test-client-secret',
      AWS_SECRET_ACCESS_KEY: 'unrelated',
      UNSET: undefined,
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      DOCKER_HOST: 'unix:///x.sock',
      DOCKER_CONTEXT: 'orbstack',
      DOCKER_CONFIG: '/Users/me/.docker',
    });
  });
});

describe('makeContainerName', () => {
  it('接頭辞と識別子をハイフンでつなぐ', () => {
    expect(makeContainerName('wacha-meter-zoom-auth-issue-1-claude', 'a1b2')).toBe(
      'wacha-meter-zoom-auth-issue-1-claude-a1b2',
    );
  });
});
