// Zoom Meeting SDK の開発用認証情報を環境変数から読み、形式を確かめる。
// エラー文には値を含めない。

export const CLIENT_ID_VARIABLE = 'ZOOM_SDK_CLIENT_ID';
export const CLIENT_SECRET_VARIABLE = 'ZOOM_SDK_CLIENT_SECRET';

export type CredentialVariable = typeof CLIENT_ID_VARIABLE | typeof CLIENT_SECRET_VARIABLE;

export interface Credentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface CredentialError {
  /** missing: 未設定・空。invalid: 空白や改行を含むなど、そのまま使えない値。 */
  readonly kind: 'missing' | 'invalid';
  readonly variable: CredentialVariable;
  readonly message: string;
}

export type CredentialsResult =
  | { readonly ok: true; readonly credentials: Credentials }
  | { readonly ok: false; readonly errors: readonly CredentialError[] };

export function readCredentials(env: Readonly<Record<string, string | undefined>>): CredentialsResult {
  const errors: CredentialError[] = [];
  const clientId = check(env, CLIENT_ID_VARIABLE, errors);
  const clientSecret = check(env, CLIENT_SECRET_VARIABLE, errors);
  if (errors.length > 0 || clientId === undefined || clientSecret === undefined) {
    return { ok: false, errors };
  }
  return { ok: true, credentials: { clientId, clientSecret } };
}

function check(
  env: Readonly<Record<string, string | undefined>>,
  variable: CredentialVariable,
  errors: CredentialError[],
): string | undefined {
  const value = env[variable];
  if (value === undefined || value.trim() === '') {
    errors.push({ kind: 'missing', variable, message: `${variable} が設定されていません。` });
    return undefined;
  }
  if (/\s/.test(value)) {
    errors.push({
      kind: 'invalid',
      variable,
      message: `${variable} に空白または改行が含まれています。値をそのまま貼り付けたか確認してください。`,
    });
    return undefined;
  }
  return value;
}
