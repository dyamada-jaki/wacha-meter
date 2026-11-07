// Meeting SDK の認証に使う JWT（HS256）を作る。
// 形式は SDK 同梱ヘッダー auth_service_interface.h の AuthContext の説明に従う。

/** 公式資料の最小値（iat から 1800 秒以上）に合わせた有効期間。 */
export const SDK_JWT_TTL_SECONDS = 1800;

export interface SdkJwtInput {
  readonly clientId: string;
  readonly clientSecret: string;
  /** 発行時刻（UNIX 秒） */
  readonly issuedAt: number;
}

export function createSdkJwt(input: SdkJwtInput): string {
  void input;
  throw new Error('未実装');
}
