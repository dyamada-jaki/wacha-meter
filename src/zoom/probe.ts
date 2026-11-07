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

export function createJwt(_credentials: Credentials, _nowSeconds: number): string {
  throw new Error('未実装');
}

export async function loadCredentials(_path?: string): Promise<Credentials> {
  throw new Error('未実装');
}

export async function runProbe(_options: ProbeOptions): Promise<{ code: number; messages: string[] }> {
  return { code: 8, messages: ['未実装'] };
}
