import type { OAuthRequest } from '../zoom-oauth/cli.js';
import type { ObfOutcome } from './flow.js';

export interface ObfCliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runFlow: (request: OAuthRequest) => Promise<ObfOutcome>;
  readonly write: (line: string) => void;
}

export function describeObfOutcome(_outcome: ObfOutcome): string {
  void _outcome;
  return '';
}

export async function runObfCli(_argv: readonly string[], _deps: ObfCliDeps): Promise<number> {
  void _argv;
  void _deps;
  return 1;
}
