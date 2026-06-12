import type { NextcloudSession } from "./credential-provider";

const NC_BASE_URL = process.env.NC_BASE_URL || "http://localhost:8090";
const SERVICE_USERNAME =
  process.env.NC_CAPABILITY_USERNAME ||
  process.env.NC_ADMIN_USER ||
  "";
const SERVICE_PASSWORD =
  process.env.NC_CAPABILITY_PASSWORD ||
  process.env.NC_ADMIN_PASSWORD ||
  "";

export type CloudspaceCapabilities = {
  auth: boolean;
  files: boolean;
  talk: boolean;
  deck: boolean;
  calendar: boolean;
  contacts: boolean;
  notes: boolean;
  mail: boolean;
  activity: boolean;
};

type CapabilitySnapshot = {
  apps: string[];
  capabilities: CloudspaceCapabilities;
  source: "startup-service-auth" | "session-auth" | "default";
  checkedAt: string;
};

const defaultCapabilities: CloudspaceCapabilities = {
  auth: true,
  files: true,
  talk: false,
  deck: false,
  calendar: false,
  contacts: false,
  notes: true,
  mail: false,
  activity: false,
};

let startupSnapshot: CapabilitySnapshot = {
  apps: [],
  capabilities: defaultCapabilities,
  source: "default",
  checkedAt: new Date().toISOString(),
};

function toBasicAuth(username: string, secret: string) {
  return Buffer.from(`${username}:${secret}`).toString("base64");
}

function mapAppsToCapabilities(apps: string[], overrides?: Partial<CloudspaceCapabilities>) {
  const installedApps = new Set(apps);

  return {
    auth: true,
    files: true,
    talk: installedApps.has("spreed"),
    deck: installedApps.has("deck"),
    calendar: installedApps.has("calendar"),
    contacts: installedApps.has("contacts"),
    notes: true,
    mail: installedApps.has("mail"),
    activity: installedApps.has("activity"),
    ...overrides,
  } satisfies CloudspaceCapabilities;
}

async function fetchInstalledApps(headers: HeadersInit) {
  const response = await fetch(`${NC_BASE_URL}/ocs/v2.php/cloud/apps?format=json`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Installed apps request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    ocs?: {
      data?: {
        apps?: string[];
      };
    };
  };

  return payload.ocs?.data?.apps || [];
}

async function fetchMailReady(headers: HeadersInit) {
  const response = await fetch(`${NC_BASE_URL}/index.php/apps/mail/api/accounts`, {
    headers,
  });

  if (response.status === 412 || response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(`Mail accounts request failed: ${response.status}`);
  }

  const payload = (await response.json()) as Array<Record<string, unknown>>;
  return Array.isArray(payload) && payload.length > 0;
}

async function buildSnapshot(headers: HeadersInit, source: CapabilitySnapshot["source"]) {
  const apps = await fetchInstalledApps(headers);
  let mailReady = false;

  if (apps.includes("mail")) {
    try {
      mailReady = await fetchMailReady(headers);
    } catch {
      mailReady = false;
    }
  }

  return {
    apps,
    capabilities: mapAppsToCapabilities(apps),
    source,
    checkedAt: new Date().toISOString(),
  } satisfies CapabilitySnapshot;
}

function sessionHeaders(session: NextcloudSession) {
  return {
    Authorization: `Basic ${toBasicAuth(session.username, session.credential.secret)}`,
    "OCS-APIRequest": "true",
    Accept: "application/json",
  };
}

export async function refreshStartupCapabilities() {
  if (!SERVICE_USERNAME || !SERVICE_PASSWORD) {
    return startupSnapshot;
  }

  try {
    startupSnapshot = await buildSnapshot(
      {
        Authorization: `Basic ${toBasicAuth(SERVICE_USERNAME, SERVICE_PASSWORD)}`,
        "OCS-APIRequest": "true",
        Accept: "application/json",
      },
      "startup-service-auth",
    );
  } catch {
    startupSnapshot = {
      ...startupSnapshot,
      source: "default",
      checkedAt: new Date().toISOString(),
    };
  }

  return startupSnapshot;
}

void refreshStartupCapabilities();

export async function getCapabilities(session?: NextcloudSession) {
  if (session) {
    try {
      return await buildSnapshot(sessionHeaders(session), "session-auth");
    } catch {
      return startupSnapshot;
    }
  }

  return startupSnapshot;
}
