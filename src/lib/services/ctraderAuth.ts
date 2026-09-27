import "server-only";
import WebSocket from "ws";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/auth/mfa";
import { CT, decodeEnvelope, encodeEnvelope, toInt, type CTraderConfig } from "@/trading/feeds/ctrader";

/**
 * cTrader Open API OAuth (https://help.ctrader.com/open-api/account-authentication/).
 *
 * An admin clicks "Connect cTrader" (GET /api/admin/ctrader/connect), grants
 * access on id.ctrader.com, and cTrader redirects to CTRADER_REDIRECT_URI
 * (/api/ctrader/callback) with a one-time `code`. The web app exchanges it for
 * an access token (~30 days) + refresh token (no expiry), picks the trading
 * account, and stores everything AES-256-GCM encrypted in SystemSetting
 * "ctrader.oauth" (same key material as the TOTP secrets). The trading worker
 * reads that record, refreshes the access token before it expires, and
 * reconnects when it changes. Tokens never leave the server.
 */

export const CTRADER_AUTH_SETTING = "ctrader.oauth";
const AUTHORIZE_URL = "https://id.ctrader.com/my/settings/openapi/grantingaccess/";
const TOKEN_URL = "https://openapi.ctrader.com/apps/token";
const REFRESH_BEFORE_MS = 7 * 86_400_000;

type Env = Record<string, string | undefined>;

export type CTraderAccount = { ctidTraderAccountId: number; isLive: boolean; traderLogin: number | null };

export type StoredCTraderAuth = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms; null when unknown. */
  expiresAt: number | null;
  accountId: number;
  isLive: boolean;
  traderLogin: number | null;
  connectedAt: string;
  refreshedAt: string | null;
};

/** Non-secret view for the admin page. */
export type CTraderAuthStatus = {
  appConfigured: boolean;
  redirectUri: string | null;
  connected: boolean;
  source: "oauth" | "env" | null;
  accountId: number | null;
  isLive: boolean | null;
  traderLogin: number | null;
  expiresAt: number | null;
  connectedAt: string | null;
};

export function ctraderApp(env: Env = process.env): { clientId: string; clientSecret: string; redirectUri: string | null } | null {
  const clientId = env.CTRADER_CLIENT_ID?.trim();
  const clientSecret = env.CTRADER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: env.CTRADER_REDIRECT_URI?.trim() || null };
}

export function ctraderHost(isLive: boolean, env: Env = process.env): string {
  return env.CTRADER_HOST?.trim() || (isLive ? "live.ctraderapi.com" : "demo.ctraderapi.com");
}

/** The id.ctrader.com consent URL. Scope `accounts` (read-only) is enough for prices; `trading` only if CTRADER_OAUTH_SCOPE says so. */
export function buildAuthorizeUrl(state: string, env: Env = process.env): string {
  const app = ctraderApp(env);
  if (!app) throw new Error("CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET are not set");
  if (!app.redirectUri) throw new Error("CTRADER_REDIRECT_URI is not set");
  const scope = env.CTRADER_OAUTH_SCOPE === "trading" ? "trading" : "accounts";
  const qs = new URLSearchParams({ client_id: app.clientId, redirect_uri: app.redirectUri, scope, product: "web", state });
  return `${AUTHORIZE_URL}?${qs.toString()}`;
}

type TokenResponse = { accessToken?: string; refreshToken?: string; expiresIn?: number; errorCode?: string | null; description?: string | null };

async function tokenRequest(params: Record<string, string>): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: number | null }> {
  // The secret travels only in this server-to-server request; errors never include the URL.
  const res = await fetch(`${TOKEN_URL}?${new URLSearchParams(params).toString()}`, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.errorCode || !body.accessToken) {
    throw new Error(`cTrader token request failed (${res.status}${body.errorCode ? ` ${body.errorCode}` : ""}${body.description ? `: ${body.description}` : ""})`);
  }
  const expiresIn = Number(body.expiresIn);
  return { accessToken: body.accessToken, refreshToken: body.refreshToken || null, expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null };
}

export async function exchangeAuthorizationCode(code: string, env: Env = process.env) {
  const app = ctraderApp(env);
  if (!app?.redirectUri) throw new Error("cTrader app credentials / CTRADER_REDIRECT_URI are not configured");
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: app.redirectUri, client_id: app.clientId, client_secret: app.clientSecret });
}

export async function refreshAccessToken(refreshToken: string, env: Env = process.env) {
  const app = ctraderApp(env);
  if (!app) throw new Error("cTrader app credentials are not configured");
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret });
}

/** ApplicationAuth + GetAccountListByAccessToken over the JSON Open API socket. */
export async function listTradingAccounts(accessToken: string, env: Env = process.env): Promise<CTraderAccount[]> {
  const app = ctraderApp(env);
  if (!app) throw new Error("cTrader app credentials are not configured");
  const url = `wss://${ctraderHost(false, env)}:${Number(env.CTRADER_PORT) || 5036}`;
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: 15_000 });
    const timer = setTimeout(() => finish(new Error("cTrader account list timed out")), 20_000);
    let done = false;
    const finish = (err: Error | null, accounts?: CTraderAccount[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.terminate();
      if (err) reject(err);
      else resolve(accounts ?? []);
    };
    socket.on("open", () => socket.send(encodeEnvelope(CT.APPLICATION_AUTH_REQ, { clientId: app.clientId, clientSecret: app.clientSecret }, "app")));
    socket.on("error", (err) => finish(new Error(`cTrader connection failed: ${err.message}`)));
    socket.on("message", (data) => {
      const env2 = decodeEnvelope(data.toString());
      if (!env2) return;
      if (env2.payloadType === CT.ERROR_RES || env2.payloadType === CT.PROTO_ERROR_RES) {
        finish(new Error(`cTrader error ${String(env2.payload?.errorCode)}: ${String(env2.payload?.description ?? "")}`));
      } else if (env2.payloadType === CT.APPLICATION_AUTH_RES) {
        socket.send(encodeEnvelope(CT.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ, { accessToken }, "accounts"));
      } else if (env2.payloadType === CT.GET_ACCOUNTS_BY_ACCESS_TOKEN_RES) {
        const list = Array.isArray(env2.payload?.ctidTraderAccount) ? (env2.payload.ctidTraderAccount as Record<string, unknown>[]) : [];
        finish(
          null,
          list
            .map((a) => ({ ctidTraderAccountId: toInt(a.ctidTraderAccountId) ?? 0, isLive: a.isLive === true, traderLogin: toInt(a.traderLogin) }))
            .filter((a) => a.ctidTraderAccountId > 0),
        );
      }
    });
  });
}

/** CTRADER_ACCOUNT_ID if it is among the granted accounts, else the first demo account, else the first account. */
export function chooseAccount(accounts: CTraderAccount[], env: Env = process.env): CTraderAccount | null {
  const wanted = Number(env.CTRADER_ACCOUNT_ID);
  if (Number.isFinite(wanted) && wanted > 0) {
    const hit = accounts.find((a) => a.ctidTraderAccountId === wanted);
    if (hit) return hit;
  }
  return accounts.find((a) => !a.isLive) ?? accounts[0] ?? null;
}

export async function loadStoredCTraderAuth(): Promise<StoredCTraderAuth | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: CTRADER_AUTH_SETTING } });
  const value = row?.value as { v?: number; data?: string } | null | undefined;
  if (!value?.data) return null;
  try {
    return JSON.parse(decryptSecret(value.data)) as StoredCTraderAuth;
  } catch {
    // Wrong key material (JWT_SECRET/MFA_ENCRYPTION_KEY rotated): treat as not connected.
    return null;
  }
}

export async function saveStoredCTraderAuth(auth: StoredCTraderAuth, actorId: string | null): Promise<void> {
  const value = { v: 1, data: encryptSecret(JSON.stringify(auth)) };
  await prisma.systemSetting.upsert({
    where: { key: CTRADER_AUTH_SETTING },
    create: { key: CTRADER_AUTH_SETTING, value, updatedById: actorId },
    update: { value, updatedById: actorId },
  });
}

/**
 * Worker config: the OAuth record (preferred) or the CTRADER_ACCESS_TOKEN /
 * CTRADER_ACCOUNT_ID env pair. Null until the app credentials and a token exist.
 */
export async function loadCTraderConfig(env: Env = process.env): Promise<CTraderConfig | null> {
  const app = ctraderApp(env);
  if (!app) return null;
  const port = Number(env.CTRADER_PORT) || 5036;
  const stored = await loadStoredCTraderAuth().catch(() => null);
  if (stored) return { clientId: app.clientId, clientSecret: app.clientSecret, accessToken: stored.accessToken, accountId: stored.accountId, host: ctraderHost(stored.isLive, env), port };
  const accessToken = env.CTRADER_ACCESS_TOKEN?.trim();
  const accountId = Number(env.CTRADER_ACCOUNT_ID);
  if (!accessToken || !Number.isFinite(accountId) || accountId <= 0) return null;
  return { clientId: app.clientId, clientSecret: app.clientSecret, accessToken, accountId, host: ctraderHost(false, env), port };
}

/**
 * Refreshes the stored access token when it expires within 7 days (or
 * `force`, e.g. after the server invalidated it). Returns true when a new
 * token was saved. Safe to call often: it is a no-op while the token is fresh.
 */
export async function refreshStoredCTraderAuthIfNeeded(opts: { force?: boolean } = {}): Promise<boolean> {
  const stored = await loadStoredCTraderAuth();
  if (!stored?.refreshToken) return false;
  if (!opts.force && stored.expiresAt != null && stored.expiresAt - Date.now() > REFRESH_BEFORE_MS) return false;
  const next = await refreshAccessToken(stored.refreshToken);
  await saveStoredCTraderAuth(
    { ...stored, accessToken: next.accessToken, refreshToken: next.refreshToken ?? stored.refreshToken, expiresAt: next.expiresAt, refreshedAt: new Date().toISOString() },
    null,
  );
  return true;
}

export async function ctraderAuthStatus(env: Env = process.env): Promise<CTraderAuthStatus> {
  const app = ctraderApp(env);
  const stored = await loadStoredCTraderAuth().catch(() => null);
  const envToken = !!env.CTRADER_ACCESS_TOKEN?.trim() && Number(env.CTRADER_ACCOUNT_ID) > 0;
  return {
    appConfigured: !!app,
    redirectUri: app?.redirectUri ?? null,
    connected: !!app && (!!stored || envToken),
    source: stored ? "oauth" : envToken ? "env" : null,
    accountId: stored?.accountId ?? (envToken ? Number(env.CTRADER_ACCOUNT_ID) : null),
    isLive: stored ? stored.isLive : envToken ? false : null,
    traderLogin: stored?.traderLogin ?? null,
    expiresAt: stored?.expiresAt ?? null,
    connectedAt: stored?.connectedAt ?? null,
  };
}
