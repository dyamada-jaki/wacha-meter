// OAuth（Public Client + PKCE S256 + state + loopback）の流れを1回行う。
// 127.0.0.1 の一時ポートで待ち受け、ブラウザで認可画面を開き、/callback の応答を待つ。
// 応答・時間切れ・中断・ブラウザ起動失敗のどれでも、先に待受を閉じてから結果を決める。
// 認可コードのトークンへの交換は、待受を閉じた後に行う（Zoom の loopback の手順どおり）。

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildAuthorizeUrl } from './authorize.js';
import { classifyCallback, type CallbackResult } from './callback.js';
import type { OAuthOutcome } from './outcome.js';
import { createPkce, createState } from './pkce.js';
import { exchangeCode, type UseAccessToken } from './token.js';

export interface OAuthFlowOptions<U = never> {
  readonly clientId: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  /** 認可の応答を待つ上限 */
  readonly timeoutMs: number;
  /** トークン要求の上限 */
  readonly tokenTimeoutMs: number;
  /** 認可 URL をブラウザで開く。失敗したら reject する */
  readonly openBrowser: (url: string) => Promise<void>;
  /** 中断 */
  readonly signal?: AbortSignal;
  /** 利用者向けの進行表示 */
  readonly log: (line: string) => void;
  /** 待受を始めたとき（テストでポートを知るため） */
  readonly onListening?: (address: { readonly address: string; readonly port: number }) => void;
  /** 指定すると、トークン取得の成功後にアクセストークンを渡して呼ぶ（値は戻り値に含めない） */
  readonly useAccessToken?: UseAccessToken<U>;
}

export const LOOPBACK_HOST = '127.0.0.1';
export const CALLBACK_PATH = '/callback';

type Waited =
  | { readonly kind: 'callback'; readonly result: CallbackResult }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'browser_failed' };

/** ブラウザに返す固定の文言。認可コード・state・トークンを含めない */
const CALLBACK_PAGE =
  '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>わちゃメーター</title></head>' +
  '<body><p>Zoom からの応答を受け取りました。この画面を閉じて、ターミナルの表示を確認してください。</p></body></html>';

export async function runOAuthFlow<U = never>(options: OAuthFlowOptions<U>): Promise<OAuthOutcome<U>> {
  if (isAborted(options.signal)) return { kind: 'interrupted' };

  const pkce = createPkce();
  const state = createState();

  let settled = false;
  let settle: (waited: Waited) => void = () => undefined;
  const waited = new Promise<Waited>((resolve) => (settle = resolve));
  const finish = (value: Waited): void => {
    if (settled) return;
    settled = true;
    settle(value);
  };

  let received = false;
  const server = createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${LOOPBACK_HOST}`);
    } catch {
      // URL として解析できない request-target。入力も例外の本文も出さず、
      // /callback 以外と同じく固定の応答を返して待ち続ける
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
      res.end('Bad Request');
      return;
    }
    if (req.method !== 'GET' || url.pathname !== CALLBACK_PATH || received || settled) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
      res.end('Not Found');
      return;
    }
    // 最初の /callback だけを扱う
    received = true;
    const result = classifyCallback(url.searchParams, state);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
    res.end(CALLBACK_PAGE, () => finish({ kind: 'callback', result }));
  });

  await listen(server);
  const { address, port } = server.address() as AddressInfo;
  options.onListening?.({ address, port });
  const redirectUri = `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`;

  const timer = setTimeout(() => finish({ kind: 'timeout' }), options.timeoutMs);
  const onAbort = (): void => finish({ kind: 'aborted' });
  options.signal?.addEventListener('abort', onAbort, { once: true });

  options.log(
    `${LOOPBACK_HOST}:${port} で認可の応答を待っています（最大 ${Math.round(options.timeoutMs / 1000)} 秒。Ctrl+C で中断）。`,
  );
  const url = buildAuthorizeUrl({
    authorizeUrl: options.authorizeUrl,
    clientId: options.clientId,
    redirectUri,
    codeChallenge: pkce.challenge,
    state,
  });
  options.openBrowser(url).then(
    () => {
      if (!settled) options.log('ブラウザで Zoom の認可画面を開きました。ログインして、アプリを許可してください。');
    },
    () => finish({ kind: 'browser_failed' }),
  );

  const result = await waited;
  clearTimeout(timer);
  options.signal?.removeEventListener('abort', onAbort);
  await close(server);
  options.log('待受を閉じました。');

  switch (result.kind) {
    case 'timeout':
      return { kind: 'timed_out' };
    case 'aborted':
      return { kind: 'interrupted' };
    case 'browser_failed':
      return { kind: 'browser_failed' };
    case 'callback':
      break;
  }

  const callback = result.result;
  if (callback.kind === 'denied') return { kind: 'denied' };
  if (callback.kind === 'invalid') {
    return {
      kind: 'invalid_response',
      reason: callback.reason,
      ...(callback.errorCode === undefined ? {} : { errorCode: callback.errorCode }),
    };
  }
  // 待っている間に中断されていたら、認可コードを送らない
  if (isAborted(options.signal)) return { kind: 'interrupted' };

  options.log('認可の応答を受け取りました。トークンを要求します。');
  const token = await exchangeCode({
    tokenUrl: options.tokenUrl,
    clientId: options.clientId,
    code: callback.code,
    redirectUri,
    codeVerifier: pkce.verifier,
    timeoutMs: options.tokenTimeoutMs,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  switch (token.kind) {
    case 'ok':
      return { kind: 'succeeded', token: token.token };
    case 'malformed':
      return { kind: 'invalid_response', reason: 'token_malformed' };
    case 'aborted':
      return { kind: 'interrupted' };
    case 'timeout':
      return { kind: 'token_failed', reason: 'timeout' };
    case 'network_error':
      return { kind: 'token_failed', reason: 'network_error' };
    case 'http_error':
      return {
        kind: 'token_failed',
        reason: 'http_error',
        status: token.status,
        ...(token.errorCode === undefined ? {} : { errorCode: token.errorCode }),
      };
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** loopback（127.0.0.1）の一時ポートだけで待ち受ける */
function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: LOOPBACK_HOST, port: 0 }, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

/** 待受を閉じ、残っている接続も切って、閉じ終わるまで待つ */
function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
