import { openBrowser } from './browser.js';
import { runCli } from './cli.js';

const controller = new AbortController();
let interrupted: 'SIGINT' | 'SIGTERM' | undefined;
const onInt = () => { interrupted ??= 'SIGINT'; controller.abort(); };
const onTerm = () => { interrupted ??= 'SIGTERM'; controller.abort(); };
process.on('SIGINT', onInt);
process.on('SIGTERM', onTerm);
try {
  const code = await runCli(process.argv.slice(2), {
    env: process.env, openBrowser, signal: controller.signal, write: (line) => console.log(line),
  });
  process.exitCode = interrupted === 'SIGTERM' ? 143 : interrupted === 'SIGINT' ? 130 : code;
} catch {
  console.error('OAuth の確認に失敗しました。');
  process.exitCode = interrupted === 'SIGTERM' ? 143 : interrupted === 'SIGINT' ? 130 : 1;
} finally {
  process.removeListener('SIGINT', onInt);
  process.removeListener('SIGTERM', onTerm);
}
