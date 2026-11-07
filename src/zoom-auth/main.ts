// 検証コマンドの入口。実際の Docker と検証プログラムにつなぐ。
// 例: npm run zoom:init / npm run zoom:auth -- --timeout 30

import { resolve } from 'node:path';
import { runCli } from './cli.js';
import { buildChildEnv, DEFAULT_CONTAINER_PREFIX, DEFAULT_IMAGE } from './docker.js';
import { EXIT_CODES } from './outcome.js';
import { createProbeSession, SetupError } from './session.js';

const env = process.env;
const session = createProbeSession({
  sdkDir: resolve(env.WACHA_ZOOM_SDK_DIR ?? '.local/zoom-sdk/7.1.5.4434'),
  probeBuildDir: resolve(env.WACHA_ZOOM_PROBE_BUILD_DIR ?? '.local/zoom-auth-probe/build'),
  image: env.WACHA_ZOOM_IMAGE ?? DEFAULT_IMAGE,
  containerPrefix: env.WACHA_ZOOM_CONTAINER_PREFIX ?? DEFAULT_CONTAINER_PREFIX,
  childEnv: buildChildEnv(env),
  hostMarginSeconds: 15,
  initHostLimitSeconds: 30 + 15,
  killGraceMs: 5000,
  log: (line) => console.error(line),
});

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    env,
    now: () => Math.floor(Date.now() / 1000),
    runProbe: session.runProbe,
    write: (line) => console.log(line),
  });
} catch (error) {
  console.error(error instanceof SetupError ? error.message : `検証コマンドが失敗しました: ${String(error)}`);
  process.exitCode = error instanceof SetupError ? EXIT_CODES.config : EXIT_CODES.other;
}
