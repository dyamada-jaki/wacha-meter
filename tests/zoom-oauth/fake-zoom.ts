// テスト用の偽の Zoom（認可画面を操作するブラウザと、トークン API）。
// 本物の Zoom は人間のログイン・許可が要り CI で使えないため、この外部境界だけを偽物にする。
// 一時サーバー・HTTP・fetch・PKCE の計算は実物を使う。
//
// - 偽ブラウザ: 認可 URL を受け取り、指定された動き（許可・拒否・不正な応答など）で
//   redirect_uri へ実際に HTTP GET する。
// - 偽トークン API: 127.0.0.1 の実 HTTP サーバー。Zoom の公開クライアントの形式
//   （x-www-form-urlencoded、Authorization ヘッダーなし、body に client_id）を受け、
//   S256(code_verifier) が認可時の code_challenge と一致し、redirect_uri・client_id・code が
//   一致するときだけトークンを返す。

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';

export const FAKE_CLIENT_ID = 'fake-public-client-id-Q7x';
export const FAKE_CODE = 'fake-authorization-code-K3m';
export const FAKE_ACCESS_TOKEN = 'fake-access-token-Z9p';
export const FAKE_REFRESH_TOKEN = 'fake-refresh-token-W2n';
/** 不正な request-target に含める架空の秘密の値 */
export const FAKE_BAD_TARGET_SECRET = 'fake-bad-target-secret-V5r';
/** URL として解析できない request-target（認可コードに当たる値を含む） */
export const BAD_REQUEST_TARGET = `http://[?code=${FAKE_BAD_TARGET_SECRET}`;

/** 偽ブラウザが見た認可 URL の内容 */
export interface SeenAuthorize {
  readonly origin: string;
  readonly path: string;
  readonly params: URLSearchParams;
}

export type BrowserBehavior =
  | 'approve'
  | 'wrong_state'
  | 'no_state'
  | 'deny'
  | 'provider_error'
  | 'no_code'
  | 'favicon_then_approve'
  | 'bad_target_then_approve'
  | 'never'
  | 'fail';

export interface FakeBrowser {
  readonly open: (url: string) => Promise<void>;
  readonly seen: () => SeenAuthorize | undefined;
  /** 偽ブラウザが redirect_uri から受け取った応答（状態と本文） */
  readonly responses: () => readonly { readonly status: number; readonly body: string }[];
  /** 送った GET がすべて終わるまで待つ */
  readonly settled: () => Promise<void>;
}

export function createFakeBrowser(behavior: BrowserBehavior): FakeBrowser {
  let seen: SeenAuthorize | undefined;
  const responses: { status: number; body: string }[] = [];
  const pending: Promise<void>[] = [];

  async function get(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      responses.push({ status: res.status, body: await res.text() });
    } catch {
      // 待受が閉じた後の接続失敗などは、応答なしとして扱う
    }
  }

  async function visit(redirectUri: string, state: string): Promise<void> {
    const callback = (query: Record<string, string>) => `${redirectUri}?${new URLSearchParams(query).toString()}`;
    switch (behavior) {
      case 'approve':
        return get(callback({ code: FAKE_CODE, state }));
      case 'wrong_state':
        return get(callback({ code: FAKE_CODE, state: `${state}x` }));
      case 'no_state':
        return get(callback({ code: FAKE_CODE }));
      case 'deny':
        return get(callback({ error: 'access_denied', state }));
      case 'provider_error':
        return get(callback({ error: 'invalid_request', state }));
      case 'no_code':
        return get(callback({ state }));
      case 'favicon_then_approve': {
        const origin = new URL(redirectUri).origin;
        await get(`${origin}/favicon.ico`);
        return get(callback({ code: FAKE_CODE, state }));
      }
      case 'bad_target_then_approve': {
        const port = Number(new URL(redirectUri).port);
        const raw = await sendRawRequest(port, BAD_REQUEST_TARGET);
        if (raw !== undefined) responses.push(raw);
        return get(callback({ code: FAKE_CODE, state }));
      }
      case 'never':
      case 'fail':
        return;
    }
  }

  return {
    open: async (url) => {
      if (behavior === 'fail') throw new Error('ブラウザを開けません');
      const parsed = new URL(url);
      seen = { origin: parsed.origin, path: parsed.pathname, params: parsed.searchParams };
      const redirectUri = parsed.searchParams.get('redirect_uri') ?? '';
      const state = parsed.searchParams.get('state') ?? '';
      // ブラウザは開いた後、利用者の操作を待つ。open 自体はすぐ返す
      pending.push(new Promise((r) => setTimeout(r, 10)).then(() => visit(redirectUri, state)));
    },
    seen: () => seen,
    responses: () => responses,
    settled: async () => {
      await Promise.all(pending);
    },
  };
}

export type TokenBehavior =
  | 'ok'
  | 'http_400'
  | 'no_access_token'
  | 'wrong_token_type'
  | 'not_json'
  | 'slow';

export interface TokenRequestRecord {
  readonly contentType: string | undefined;
  readonly authorization: string | undefined;
  readonly form: URLSearchParams;
}

export interface FakeTokenApi {
  readonly url: string;
  readonly requests: () => readonly TokenRequestRecord[];
  readonly close: () => Promise<void>;
}

/**
 * 偽トークン API を起動する。seen は偽ブラウザが見た認可 URL（challenge・redirect_uri の照合に使う）。
 */
export async function startFakeTokenApi(
  behavior: TokenBehavior,
  seen: () => SeenAuthorize | undefined,
): Promise<FakeTokenApi> {
  const requests: TokenRequestRecord[] = [];
  const server: Server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const form = new URLSearchParams(body);
      requests.push({ contentType: req.headers['content-type'], authorization: req.headers.authorization, form });
      const authorize = seen();
      const valid =
        req.method === 'POST' &&
        req.url === '/oauth/token' &&
        req.headers['content-type']?.startsWith('application/x-www-form-urlencoded') === true &&
        req.headers.authorization === undefined &&
        form.get('grant_type') === 'authorization_code' &&
        form.get('client_id') === FAKE_CLIENT_ID &&
        form.get('code') === FAKE_CODE &&
        authorize !== undefined &&
        form.get('redirect_uri') === authorize.params.get('redirect_uri') &&
        createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') ===
          authorize.params.get('code_challenge');
      if (!valid) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant', reason: 'fake rejected the request' }));
        return;
      }
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      const ok = {
        access_token: FAKE_ACCESS_TOKEN,
        token_type: 'bearer',
        refresh_token: FAKE_REFRESH_TOKEN,
        expires_in: 3599,
        scope: 'user:read:token',
      };
      switch (behavior) {
        case 'ok':
          return json(200, ok);
        case 'http_400':
          return json(400, { error: 'invalid_grant', reason: `code ${FAKE_CODE} is used` });
        case 'no_access_token':
          return json(200, { ...ok, access_token: undefined });
        case 'wrong_token_type':
          return json(200, { ...ok, token_type: 'mac' });
        case 'not_json':
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<html>not json</html>');
          return;
        case 'slow':
          setTimeout(() => json(200, ok), 2000);
          return;
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/oauth/token`,
    requests: () => requests,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

/** そのポートへ接続できないこと（待受が閉じていること）を確かめる */
export async function connectionRefused(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/callback`, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code === 'ECONNREFUSED';
  }
}

/**
 * fetch では送れない request-target を、TCP で直接送る。
 * 応答の状態と本文を返す。接続が切れたまま応答が無いとき・上限を過ぎたときは undefined。
 */
export function sendRawRequest(
  port: number,
  target: string,
  timeoutMs = 2000,
): Promise<{ readonly status: number; readonly body: string } | undefined> {
  return new Promise((resolve) => {
    let data = '';
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    const timer = setTimeout(() => socket.destroy(), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (data += chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(timer);
      const match = /^HTTP\/1\.1 (\d{3})/.exec(data);
      if (match === null) return resolve(undefined);
      const index = data.indexOf('\r\n\r\n');
      resolve({ status: Number(match[1]), body: index < 0 ? '' : data.slice(index + 4) });
    });
  });
}

// ---- 偽 Users API（OBF の要求先。Issue #8） ----
// Zoom「OBF 認証」の例どおり、GET /v2/users/me/token?type=onbehalf に Bearer のアクセストークンで要求し、
// 200 { "token": "..." } を返す。パス・クエリ（type=onbehalf だけ。meeting_id なし）・Authorization が
// 偽トークン API の発行した値と一致するときだけ OBF を返し、違えば 400 を返す。
// エラー本文の形（code / message）は公式資料に記載が無いので、テスト用のデータとしてだけ使う。

export const FAKE_OBF_TOKEN = 'fake-obf-token-H8s';
export const OBF_PATH = '/v2/users/me/token?type=onbehalf';

export type ObfBehavior =
  | 'ok'
  | 'empty_token'
  | 'no_token'
  | 'number_token'
  | 'not_json'
  | 'http_201'
  | 'http_401'
  | 'http_403'
  | 'http_400_bad_code'
  | 'redirect'
  | 'slow'
  | 'cut';

export interface ObfRequestRecord {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly authorization: string | undefined;
}

export interface FakeUsersApi {
  /** OBF の要求先の URL */
  readonly url: string;
  readonly requests: () => readonly ObfRequestRecord[];
  /** リダイレクト先に届いた要求 */
  readonly redirectedRequests: () => readonly ObfRequestRecord[];
  readonly close: () => Promise<void>;
}

export async function startFakeUsersApi(behavior: ObfBehavior): Promise<FakeUsersApi> {
  const requests: ObfRequestRecord[] = [];
  const redirected: ObfRequestRecord[] = [];
  const record = (req: IncomingMessage): ObfRequestRecord => ({
    method: req.method,
    url: req.url,
    authorization: req.headers.authorization,
  });

  const other: Server = createServer((req, res) => {
    redirected.push(record(req));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ token: FAKE_OBF_TOKEN }));
  });
  await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
  const otherPort = (other.address() as AddressInfo).port;

  const server: Server = createServer((req, res) => {
    requests.push(record(req));
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const valid =
      req.method === 'GET' && req.url === OBF_PATH && req.headers.authorization === `Bearer ${FAKE_ACCESS_TOKEN}`;
    if (!valid) {
      return json(400, { code: 300, message: `fake rejected the request ${FAKE_ACCESS_TOKEN}` });
    }
    switch (behavior) {
      case 'ok':
        return json(200, { token: FAKE_OBF_TOKEN });
      case 'empty_token':
        return json(200, { token: '' });
      case 'no_token':
        return json(200, { obf: FAKE_OBF_TOKEN });
      case 'number_token':
        return json(200, { token: 12345 });
      case 'not_json':
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html>${FAKE_OBF_TOKEN}</html>`);
        return;
      case 'http_201':
        return json(201, { token: FAKE_OBF_TOKEN });
      case 'http_401':
        return json(401, { code: 124, message: `Invalid access token: ${FAKE_ACCESS_TOKEN}` });
      case 'http_403':
        return json(403, { code: 4711, message: `scopes missing for ${FAKE_ACCESS_TOKEN}` });
      case 'http_400_bad_code':
        return json(400, { code: `${FAKE_OBF_TOKEN}`, message: 'bad' });
      case 'redirect':
        res.writeHead(302, { location: `http://127.0.0.1:${otherPort}${OBF_PATH}` });
        res.end();
        return;
      case 'slow':
        setTimeout(() => json(200, { token: FAKE_OBF_TOKEN }), 2000);
        return;
      case 'cut':
        // ヘッダーと本文の一部を送ってから接続を切る
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' });
        res.write('{"token":"');
        setTimeout(() => res.destroy(), 20);
        return;
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const closeServer = (s: Server) =>
    new Promise<void>((r) => {
      s.closeAllConnections();
      s.close(() => r());
    });
  return {
    url: `http://127.0.0.1:${port}${OBF_PATH}`,
    requests: () => requests,
    redirectedRequests: () => redirected,
    close: async () => {
      await closeServer(server);
      await closeServer(other);
    },
  };
}

/** 接続できない（待ち受けていない）ポートの URL を作る */
export async function unusedUrl(path: string): Promise<string> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((r) => server.close(() => r()));
  return `http://127.0.0.1:${port}${path}`;
}
