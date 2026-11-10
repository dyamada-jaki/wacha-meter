import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, ZOOM_AUTHORIZE_URL } from '../../src/zoom-oauth/authorize.js';

describe('buildAuthorizeUrl', () => {
  it('Zoom の認可画面に、公開クライアントの PKCE（S256）と state を付けて送る', () => {
    const url = new URL(
      buildAuthorizeUrl({
        authorizeUrl: ZOOM_AUTHORIZE_URL,
        clientId: 'client-abc',
        redirectUri: 'http://127.0.0.1:53123/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        state: 'state-xyz',
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe('https://zoom.us/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-abc',
      redirect_uri: 'http://127.0.0.1:53123/callback',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      state: 'state-xyz',
    });
  });
});
