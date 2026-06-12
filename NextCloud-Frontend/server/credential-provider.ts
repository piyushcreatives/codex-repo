import { createHash } from "node:crypto";

const NC_BASE_URL = process.env.NC_BASE_URL || "http://localhost:8090";
const NEXTCLOUD_APP_PASSWORD_LABEL =
  process.env.NEXTCLOUD_APP_PASSWORD_LABEL || "CloudSpace Adapter";
const NEXTCLOUD_BOOTSTRAP_STRATEGY =
  process.env.NEXTCLOUD_BOOTSTRAP_STRATEGY || "exchange-or-direct";

export type DelegatedCredential = {
  type: "app-password";
  secret: string;
  source: "bootstrap-exchange" | "user-supplied";
  createdAt: string;
};

export type NextcloudWebSession = {
  cookies: string[];
  createdAt: string;
};

export type NextcloudSession = {
  username: string;
  credential: DelegatedCredential;
  displayNameOverride?: string;
  webSession?: NextcloudWebSession;
};

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

export async function resolveCurrentUser(session: NextcloudSession) {
  const payload = await nextcloudJsonWithSecret(
    session.username,
    session.credential.secret,
    "/ocs/v2.php/cloud/user?format=json",
  );

  const mapped = mapNextcloudUser(payload);
  if (session.displayNameOverride) {
    return {
      ...mapped,
      name: session.displayNameOverride,
    };
  }

  return mapped;
}
