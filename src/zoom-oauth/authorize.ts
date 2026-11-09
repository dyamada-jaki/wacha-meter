// Zoom の認可画面の URL を作る。URL は Client ID を含むので、画面やログに出さない。

export const ZOOM_AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';

export interface AuthorizeUrlInput {
  readonly authorizeUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly state: string;
}

export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const url = new URL(input.authorizeUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    state: input.state,
  }).toString();
  return url.toString();
}
