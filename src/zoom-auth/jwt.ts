// Meeting SDK の認証に使う JWT（HS256）を作る。
// 形式は SDK 同梱ヘッダー auth_service_interface.h の AuthContext の説明に従う。

import { createHmac } from 'node:crypto';

/**
 * 有効期間（秒）。公式資料の最小は iat から 1800 秒だが、SDK 7.1.5.4434 は
 * exp − iat = 1800 秒の JWT を SDKAuth の呼び出し時点で SDKERR_INTERNAL_ERROR として拒否した（手元の実測。
 * 1801 秒は受理）。残りの有効期間を SDK の時計で確かめているとみられるので、余裕をもって 1 時間にする（上限は 48 時間）。
 */
export const SDK_JWT_TTL_SECONDS = 3600;

export interface SdkJwtInput {
  readonly clientId: string;
  readonly clientSecret: string;
  /** 発行時刻（UNIX 秒） */
  readonly issuedAt: number;
}

export function createSdkJwt(input: SdkJwtInput): string {
  const expiresAt = input.issuedAt + SDK_JWT_TTL_SECONDS;
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    appKey: input.clientId,
    iat: input.issuedAt,
    exp: expiresAt,
    tokenExp: expiresAt,
  });
  const signature = createHmac('sha256', input.clientSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
