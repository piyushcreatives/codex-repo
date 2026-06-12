import type { NextcloudSession } from "./credential-provider";

const NC_BASE_URL = process.env.NC_BASE_URL || "http://localhost:8090";

export type NextcloudWebSession = {
  cookies: string[];
  createdAt: string;
};

function extractSetCookies(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const combined = response.headers.get("set-cookie");
  if (!combined) return [];

  return combined
    .split(/,(?=[^;]+=[^;]+)/g)
    .map((value) => value.trim())
    .filter(Boolean);
}

function mergeCookies(existing: string[], setCookies: string[]) {
  const jar = new Map<string, string>();

  for (const cookie of existing) {
    const [pair] = cookie.split(";");
    const [name] = pair.split("=");
    if (!name) continue;
    jar.set(name.trim(), pair.trim());
  }

  for (const cookie of setCookies) {
    const [pair] = cookie.split(";");
    const [name] = pair.split("=");
    if (!name) continue;
    jar.set(name.trim(), pair.trim());
  }

  return Array.from(jar.values());
}

function toCookieHeader(cookies: string[]) {
  return cookies.join("; ");
}

function parseRequestToken(html: string) {
  const match =
    html.match(/name=["']requesttoken["']\s+value=["']([^"']+)["']/i) ||
    html.match(/data-requesttoken=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

async function fetchWithCookieJar(path: string, cookies: string[], init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (cookies.length) {
    headers.set("Cookie", toCookieHeader(cookies));
  }

  const response = await fetch(`${NC_BASE_URL}${path}`, {
    ...init,
    headers,
    redirect: "manual",
  });

  return {
    response,
    cookies: mergeCookies(cookies, extractSetCookies(response)),
  };
}

export async function establishNextcloudWebSession(username: string, password: string) {
  let cookies: string[] = [];

  const loginPage = await fetchWithCookieJar("/login", cookies, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
    },
  });
  cookies = loginPage.cookies;

  if (!loginPage.response.ok) {
    throw new Error(`Unable to load Nextcloud login page (${loginPage.response.status}).`);
  }

  const requestToken = parseRequestToken(await loginPage.response.text());
  if (!requestToken) {
    throw new Error("Unable to extract Nextcloud login request token.");
  }

  const loginBody = new URLSearchParams({
    user: username,
    password,
    requesttoken: requestToken,
    timezone: "UTC",
    timezone_offset: "0",
  });

  const loginSubmit = await fetchWithCookieJar("/login", cookies, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml",
      Origin: NC_BASE_URL,
      Referer: `${NC_BASE_URL}/login`,
    },
    body: loginBody.toString(),
  });
  cookies = loginSubmit.cookies;

  if (![200, 303].includes(loginSubmit.response.status)) {
    throw new Error(`Nextcloud web login failed (${loginSubmit.response.status}).`);
  }

  const verify = await fetch(`${NC_BASE_URL}/ocs/v2.php/cloud/user?format=json`, {
    method: "GET",
    headers: {
      Cookie: toCookieHeader(cookies),
      Accept: "application/json",
      "OCS-APIRequest": "true",
    },
  });

  if (!verify.ok) {
    throw new Error(`Nextcloud web session verification failed (${verify.status}).`);
  }

  return {
    cookies,
    createdAt: new Date().toISOString(),
  } satisfies NextcloudWebSession;
}

export function getWebSessionCookieHeader(session: NextcloudSession) {
  const cookies = session.webSession?.cookies || [];
  if (!cookies.length) {
    throw new Error("Nextcloud web session is unavailable for native Talk calls.");
  }

  return toCookieHeader(cookies);
}

export async function nextcloudWebSessionFetch(session: NextcloudSession, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cookie", getWebSessionCookieHeader(session));

  return fetch(`${NC_BASE_URL}${path}`, {
    ...init,
    headers,
  });
}

export async function nextcloudWebSessionJson<T>(
  session: NextcloudSession,
  path: string,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers);
  headers.set("Cookie", getWebSessionCookieHeader(session));
  headers.set("Accept", "application/json");
  headers.set("OCS-APIRequest", "true");

  const response = await fetch(`${NC_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Nextcloud cookie-session request failed: ${response.status} ${path}`);
  }

  return response.json() as Promise<T>;
}
