import type { OAuthOptions } from './session.js';

export interface CliDeps extends Omit<OAuthOptions, 'clientId'> {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly write: (line: string) => void;
}

export async function runCli(_argv: readonly string[], _deps: CliDeps): Promise<number> {
  void _argv;
  void _deps;
  return 1;
}
