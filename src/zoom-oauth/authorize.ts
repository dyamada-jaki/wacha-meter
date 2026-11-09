// Zoom の認可画面の URL を作る。URL は Client ID を含むので、画面やログに出さない。

export const ZOOM_AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';

export interface AuthorizeUrlInput {
  readonly authorizeUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly state: string;
}

export function buildAuthorizeUrl(_input: AuthorizeUrlInput): string {
  throw new Error('未実装');
}
