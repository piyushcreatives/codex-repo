import { createHash } from "node:crypto";

const NC_BASE_URL = process.env.NC_BASE_URL || "http://localhost:8090";
const NEXTCLOUD_APP_PASSWORD_LABEL =
  process.env.NEXTCLOUD_APP_PASSWORD_LABEL || "CloudSpace Adapter";
const NEXTCLOUD_BOOTSTRAP_STRATEGY =
  process.env.NEXTCLOUD_BOOTSTRAP_STRATEGY || "exchange-or-direct";

// Keycloak SSO — the adapter is a DIRECT OIDC client of Keycloak (no Nextcloud
// OAuth2 layer / consent screens). The Keycloak access token is stored on the
// session and sent as a Bearer to Nextcloud, which validates + provisions it via
// the user_oidc app (check-bearer). See OAUTH_MIGRATION.md.
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "";
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "";
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || "";
const OAUTH_AUTHORIZE_URL = process.env.OAUTH_AUTHORIZE_URL || "";
const OAUTH_TOKEN_URL = process.env.OAUTH_TOKEN_URL || "";
const OAUTH_SCOPE = process.env.OAUTH_SCOPE || "openid profile email";

export type DelegatedCredential = {
  type: "app-password";
  secret: string;
  source: "bootstrap-exchange" | "user-supplied";
  createdAt: string;
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
};

export type NextcloudWebSession = {
  cookies: string[];
  createdAt: string;
};

export type NextcloudSession = {
  username: string;
  credential?: DelegatedCredential; // app-password path (username/password login)
  oauth?: OAuthTokens;              // OAuth/Keycloak path (Bearer token login)
  displayNameOverride?: string;
  webSession?: NextcloudWebSession;
};

// Single source of truth for the Nextcloud Authorization header: Bearer for OAuth
// sessions, Basic (app-password) otherwise. Every server-side NC call uses this.
export function nextcloudAuthHeaderValue(session: NextcloudSession): string {
  if (session.oauth?.accessToken) return `Bearer ${session.oauth.accessToken}`;
  if (session.credential?.secret) return `Basic ${toBasicAuth(session.username, session.credential.secret)}`;
  throw new Error("Nextcloud session has no usable credential");
}

type NextcloudUserPayload = {
  ocs?: {
    data?: {
      id?: string;
      displayname?: string;
      email?: string;
      groups?: string[];
      quota?: {
        used?: number | string;
        quota?: number | string;
      };
    };
  };
};

export type CloudSpaceUser = {
  id: number;
  name: string;
  email: string;
  avatar: null;
  role: "admin" | "user";
  storageUsed: number;
  storageQuota: number;
  username: string;
};

function normalizeLoginIdentifier(value: string) {
  const trimmed = value.trim();
  if (trimmed.endsWith("@cloudspace.home")) {
    return trimmed.slice(0, trimmed.indexOf("@"));
  }
  return trimmed;
}

function usernameToStableUserId(username: string) {
  const digest = createHash("sha1").update(`user:${username}`).digest("hex").slice(0, 7);
  return parseInt(digest, 16);
}

function toBasicAuth(username: string, secret: string) {
  return Buffer.from(`${username}:${secret}`).toString("base64");
}

function buildAuthHeaders(username: string, secret: string, headers?: HeadersInit) {
  const nextHeaders = new Headers(headers);
  nextHeaders.set("Authorization", `Basic ${toBasicAuth(username, secret)}`);
  return nextHeaders;
}

function mapNextcloudUser(payload: NextcloudUserPayload) {
  const data = payload.ocs?.data || {};
  const quota = data.quota || {};

  return {
    id: usernameToStableUserId(data.id || "user"),
    name: data.displayname || data.id || "Nextcloud User",
    email: data.email || `${data.id || "user"}@cloudspace.home`,
    avatar: null,
    role: Array.isArray(data.groups) && data.groups.includes("admin") ? "admin" : "user",
    storageUsed: Number(quota.used || 0),
    storageQuota: Number(quota.quota || 0),
    username: data.id || "",
  } satisfies CloudSpaceUser;
}

async function nextcloudJsonWithSecret(
  username: string,
  secret: string,
  path: string,
  init?: RequestInit,
) {
  const headers = buildAuthHeaders(username, secret, init?.headers);
  headers.set("OCS-APIRequest", "true");
  headers.set("Accept", "application/json");

  const response = await fetch(`${NC_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Nextcloud request failed: ${response.status} ${path}`);
  }

  return response.json() as Promise<NextcloudUserPayload>;
}

async function requestAppPassword(username: string, loginSecret: string) {
  const headers = buildAuthHeaders(username, loginSecret, {
    "OCS-APIRequest": "true",
    Accept: "application/json",
    "User-Agent": NEXTCLOUD_APP_PASSWORD_LABEL,
  });

  const response = await fetch(`${NC_BASE_URL}/ocs/v2.php/core/getapppassword?format=json`, {
    method: "GET",
    headers,
  });

  if (response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`App password bootstrap failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    ocs?: { data?: { apppassword?: string } };
  };

  return payload.ocs?.data?.apppassword ?? null;
}

export async function bootstrapDelegatedSession(identifier: string, loginSecret: string) {
  const username = normalizeLoginIdentifier(identifier);
  const user = mapNextcloudUser(
    await nextcloudJsonWithSecret(username, loginSecret, "/ocs/v2.php/cloud/user?format=json"),
  );

  if (!user.username) {
    throw new Error("Authenticated user did not include an id");
  }

  let delegatedSecret = loginSecret;
  let source: DelegatedCredential["source"] = "user-supplied";

  if (NEXTCLOUD_BOOTSTRAP_STRATEGY !== "require-direct-app-password") {
    const exchangedSecret = await requestAppPassword(user.username, loginSecret);
    if (exchangedSecret) {
      delegatedSecret = exchangedSecret;
      source = "bootstrap-exchange";
    }
  }

  return {
    session: {
      username: user.username,
      credential: {
        type: "app-password",
        secret: delegatedSecret,
        source,
        createdAt: new Date().toISOString(),
      },
    } satisfies NextcloudSession,
    user,
  };
}

export async function revokeDelegatedCredential(session: NextcloudSession) {
  // Only app-password sessions have a revocable credential. OAuth sessions are
  // ended by dropping the local session (the access token expires on its own).
  if (!session.credential?.secret) return;

  const response = await fetch(`${NC_BASE_URL}/ocs/v2.php/core/apppassword`, {
    method: "DELETE",
    headers: buildAuthHeaders(session.username, session.credential.secret, {
      "OCS-APIRequest": "true",
      Accept: "application/json",
    }),
  });

  if (response.ok || response.status === 404) {
    return;
  }

  if (response.status === 401 || response.status === 403) {
    return;
  }

  throw new Error(`App password revocation failed: ${response.status}`);
}

async function nextcloudJsonAsSession(session: NextcloudSession, path: string) {
  const response = await fetch(`${NC_BASE_URL}${path}`, {
    headers: {
      Authorization: nextcloudAuthHeaderValue(session),
      "OCS-APIRequest": "true",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Nextcloud request failed: ${response.status} ${path}`);
  }
  return response.json() as Promise<NextcloudUserPayload>;
}

export async function resolveCurrentUser(session: NextcloudSession) {
  const payload = await nextcloudJsonAsSession(session, "/ocs/v2.php/cloud/user?format=json");

  const mapped = mapNextcloudUser(payload);
  if (session.displayNameOverride) {
    return {
      ...mapped,
      name: session.displayNameOverride,
    };
  }

  return mapped;
}

// ── OAuth2 (Keycloak via Nextcloud) ─────────────────────────────────────────
export function isOAuthConfigured() {
  return Boolean(
    OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET && OAUTH_REDIRECT_URI && OAUTH_AUTHORIZE_URL && OAUTH_TOKEN_URL,
  );
}

export function buildAuthorizeUrl(state: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OAUTH_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    scope: OAUTH_SCOPE,
    state,
  });
  return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

async function oauthTokenRequest(body: Record<string, string>) {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_SECRET}`).toString("base64"),
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    throw new Error(`OAuth token request failed: ${response.status}`);
  }
  return response.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user_id?: string;
  }>;
}

export async function exchangeOAuthCode(code: string) {
  const tok = await oauthTokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: OAUTH_REDIRECT_URI,
  });
  // Keycloak's token response has no user_id (that's Nextcloud-specific). Resolve the
  // Nextcloud username by calling NC with the freshly-issued Keycloak access token
  // (Bearer) — user_oidc validates it and provisions the user on first hit.
  const session: NextcloudSession = {
    username: tok.user_id ?? "",
    oauth: {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: Date.now() + tok.expires_in * 1000,
    },
  };
  const user = await resolveCurrentUser(session);
  session.username = user.username;
  return { session, user };
}

// Refresh the access token in place (mutates session.oauth). Returns false if it
// couldn't be refreshed (e.g. refresh token revoked) so the caller can re-auth.
export async function refreshOAuthTokens(session: NextcloudSession): Promise<boolean> {
  if (!session.oauth?.refreshToken) return false;
  try {
    const tok = await oauthTokenRequest({
      grant_type: "refresh_token",
      refresh_token: session.oauth.refreshToken,
    });
    session.oauth = {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token || session.oauth.refreshToken,
      expiresAt: Date.now() + tok.expires_in * 1000,
    };
    return true;
  } catch {
    return false;
  }
}
