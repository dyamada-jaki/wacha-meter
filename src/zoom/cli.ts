import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runProbe } from './probe.js';

const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  const { values } = parseArgs({ options: {
    sdk: { type: 'string' }, credentials: { type: 'string' }, 'init-only': { type: 'boolean' },
  } });
  const result = await runProbe({
    sdkPath: resolve(values.sdk ?? '.local/zoom-sdk-7.1.5.4434'),
    binaryPath: resolve('.local/zoom-build/zoom-probe'),
    ...(values.credentials ? { credentialsPath: values.credentials } : {}),
    initOnly: values['init-only'] ?? false, signal: controller.signal,
  });
  for (const message of result.messages) process.stdout.write(`${message}\n`);
  process.exitCode = result.code;
} catch {
  process.stderr.write('引数または実行環境を確認してください。\n');
  process.exitCode = 8;
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
