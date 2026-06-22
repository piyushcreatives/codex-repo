import Database from "better-sqlite3";
import type { Request, Response } from "express";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import type { NextcloudSession } from "./credential-provider";

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "cloudspace_session";
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 12);
const SESSION_DB_PATH = process.env.SESSION_DB_PATH || "sessions.db";
const SESSION_SECRET = (() => {
  const fromEnv = process.env.SESSION_SECRET;
  const isProd = process.env.NODE_ENV === "production";
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (isProd) {
    // Fail closed: never boot production with a weak/absent session key.
    // The session payload holds the Nextcloud app-password — a guessable key means anyone can decrypt it.
    throw new Error(
      "[security] SESSION_SECRET must be set to at least 32 characters in production. Refusing to start.",
    );
  }
  if (fromEnv) {
    console.warn("[security] SESSION_SECRET is shorter than 32 chars — acceptable for local dev only.");
    return fromEnv;
  }
  console.warn("[security] SESSION_SECRET not set — using insecure dev default. Set SESSION_SECRET for any shared/production deploy.");
  return "cloudspace-dev-session-secret";
})();
const SESSION_COOKIE_SECURE =
  process.env.SESSION_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";

const sessionDb = new Database(SESSION_DB_PATH);
sessionDb.pragma("journal_mode = WAL");
sessionDb.exec(`
  CREATE TABLE IF NOT EXISTS nextcloud_sessions (
    token_hash TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )
`);

const insertSessionStatement = sessionDb.prepare(`
  INSERT INTO nextcloud_sessions (token_hash, payload, created_at, updated_at, expires_at)
  VALUES (@token_hash, @payload, @created_at, @updated_at, @expires_at)
  ON CONFLICT(token_hash) DO UPDATE SET
    payload = excluded.payload,
    updated_at = excluded.updated_at,
    expires_at = excluded.expires_at
`);
const deleteSessionStatement = sessionDb.prepare(
  "DELETE FROM nextcloud_sessions WHERE token_hash = ?",
);
const deleteExpiredSessionsStatement = sessionDb.prepare(
  "DELETE FROM nextcloud_sessions WHERE expires_at <= ?",
);
const selectSessionStatement = sessionDb.prepare(
  "SELECT payload, expires_at FROM nextcloud_sessions WHERE token_hash = ?",
);

function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey || rest.length === 0) continue;
    cookies[rawKey] = decodeURIComponent(rest.join("="));
  }

  return cookies;
}

function getSessionKey() {
  return createHash("sha256").update(SESSION_SECRET).digest();
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function encryptSessionPayload(session: NextcloudSession) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSessionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSessionPayload(payload: string): NextcloudSession | null {
  const [ivPart, authTagPart, encryptedPart] = payload.split(".");
  if (!ivPart || !authTagPart || !encryptedPart) return null;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getSessionKey(),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64url")),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8")) as NextcloudSession;
  } catch {
    return null;
  }
}

function buildCookieValue(token: string, maxAge: number) {
  const cookieParts = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
  ];

  if (SESSION_COOKIE_SECURE) {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

function loadStoredSession(token: string | undefined) {
  if (!token) return undefined;

  deleteExpiredSessionsStatement.run(new Date().toISOString());
  const row = selectSessionStatement.get(hashSessionToken(token)) as
    | { payload: string; expires_at: string }
    | undefined;

  if (!row) return undefined;
  if (row.expires_at <= new Date().toISOString()) {
    deleteSessionStatement.run(hashSessionToken(token));
    return undefined;
  }

  const session = decryptSessionPayload(row.payload);
  if (!session) {
    deleteSessionStatement.run(hashSessionToken(token));
    return undefined;
  }

  return session;
}

export function createNextcloudSession(res: Response, session: NextcloudSession) {
  const token = randomBytes(24).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  insertSessionStatement.run({
    token_hash: hashSessionToken(token),
    payload: encryptSessionPayload(session),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });

  res.setHeader("Set-Cookie", buildCookieValue(token, SESSION_TTL_SECONDS));
}

export function getNextcloudSession(req: Request) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return loadStoredSession(token);
}

// For WebSocket upgrades, where we only have the raw cookie header.
export function getSessionFromCookieHeader(cookieHeader?: string) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  return loadStoredSession(token);
}

export function updateNextcloudSession(req: Request, partial: Partial<NextcloudSession>) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;

  const existing = loadStoredSession(token);
  if (!existing) return null;

  const next = { ...existing, ...partial };
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  insertSessionStatement.run({
    token_hash: hashSessionToken(token),
    payload: encryptSessionPayload(next),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });

  return next;
}

export function clearNextcloudSession(req: Request, res: Response) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    deleteSessionStatement.run(hashSessionToken(token));
  }

  res.setHeader("Set-Cookie", buildCookieValue("", 0));
}
