import { createHash } from "node:crypto";
import { storage } from "./storage";
import type { NextcloudSession } from "./credential-provider";
import { resolveCurrentUser } from "./credential-provider";

const NC_BASE_URL = process.env.NC_BASE_URL || "http://localhost:8090";
const SERVICE_USERNAME =
  process.env.NC_CAPABILITY_USERNAME ||
  process.env.NC_ADMIN_USER ||
  "";
const SERVICE_PASSWORD =
  process.env.NC_CAPABILITY_PASSWORD ||
  process.env.NC_ADMIN_PASSWORD ||
  "";

type DavFile = {
  id: number;
  name: string;
  path: string;
  type: "file" | "folder";
  mimeType: string | null;
  size: number;
  modifiedAt: string;
  sharedWith: string | null;
  isFavourite: boolean;
  parentPath: string;
  ownerId: number;
};

export type NextcloudDirectoryUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
};

export type CloudMediaFile = DavFile & {
  mediaKind: "image" | "video";
};

function normalizeCloudPath(input: string | undefined) {
  if (!input || input === "/") return "/";
  const withLeadingSlash = input.startsWith("/") ? input : `/${input}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

function toDavUrl(username: string, cloudPath = "/") {
  const normalized = normalizeCloudPath(cloudPath);
  const encodedPath =
    normalized === "/"
      ? ""
      : normalized
          .split("/")
          .filter(Boolean)
          .map((segment) => encodeURIComponent(segment))
          .join("/");

  const suffix = encodedPath ? `/${encodedPath}` : "";
  return `/remote.php/dav/files/${encodeURIComponent(username)}${suffix}`;
}

function getParentPath(cloudPath: string) {
  const normalized = normalizeCloudPath(cloudPath);
  if (normalized === "/") return "/";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

function getBaseName(cloudPath: string) {
  const normalized = normalizeCloudPath(cloudPath);
  return normalized.split("/").filter(Boolean).at(-1) || "";
}

function extractTagValue(source: string, tagName: string) {
  const pattern = new RegExp(
    `<(?:[\\w-]+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tagName}>`,
    "i",
  );
  return pattern.exec(source)?.[1]?.trim() ?? "";
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function hashToId(value: string) {
  const digest = createHash("sha1").update(value).digest("hex").slice(0, 8);
  return parseInt(digest, 16);
}

function parseDavResponses(xml: string, username: string, parentPath: string) {
  const blocks = xml.match(/<(?:\w+:)?response\b[\s\S]*?<\/(?:\w+:)?response>/gi) || [];
  const currentDavHref = decodeURIComponent(toDavUrl(username, parentPath)).replace(/\/+$/, "");
  const files: DavFile[] = [];

  for (const block of blocks) {
    const hrefRaw = decodeXml(extractTagValue(block, "href"));
    if (!hrefRaw) continue;

    const hrefPath = decodeURIComponent(hrefRaw.replace(/^https?:\/\/[^/]+/i, "")).replace(/\/+$/, "");
    if (!hrefPath || hrefPath === currentDavHref) continue;

    const displayName =
      decodeXml(extractTagValue(block, "displayname")) ||
      hrefPath.split("/").filter(Boolean).at(-1) ||
      "Untitled";
    const contentType = decodeXml(extractTagValue(block, "getcontenttype")) || null;
    const contentLength = Number(extractTagValue(block, "getcontentlength") || 0);
    const lastModified = extractTagValue(block, "getlastmodified");
    const isFolder = /<(?:\w+:)?collection\s*\/?>/i.test(block);
    const favourite = extractTagValue(block, "favorite") === "1";
    const davPrefix = `/remote.php/dav/files/${encodeURIComponent(username)}`;
    const cloudPathRaw = hrefPath.startsWith(davPrefix) ? hrefPath.slice(davPrefix.length) || "/" : hrefPath;
    const cloudPath = normalizeCloudPath(cloudPathRaw);

    files.push({
      id: hashToId(cloudPath),
      name: displayName,
      path: cloudPath,
      type: isFolder ? "folder" : "file",
      mimeType: isFolder ? null : contentType,
      size: Number.isFinite(contentLength) ? contentLength : 0,
      modifiedAt: lastModified ? new Date(lastModified).toISOString() : new Date().toISOString(),
      sharedWith: null,
      isFavourite: favourite,
      parentPath: normalizeCloudPath(parentPath),
      ownerId: 1,
    });
  }

  return files.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function toBasicAuth(session: NextcloudSession) {
  return Buffer.from(`${session.username}:${session.credential.secret}`).toString("base64");
}

async function nextcloudFetch(session: NextcloudSession, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Basic ${toBasicAuth(session)}`);

  return fetch(`${NC_BASE_URL}${path}`, {
    ...init,
    headers,
  });
}

async function nextcloudJson<T>(session: NextcloudSession, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Basic ${toBasicAuth(session)}`);
  headers.set("Accept", "application/json");
  headers.set("OCS-APIRequest", "true");

  const response = await fetch(`${NC_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Nextcloud JSON request failed: ${response.status} ${path}`);
  }

  return response.json() as Promise<T>;
}

async function nextcloudJsonWithCredentials<T>(
  username: string,
  secret: string,
  path: string,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}`);
  headers.set("Accept", "application/json");
  headers.set("OCS-APIRequest", "true");

  const response = await fetch(`${NC_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Nextcloud JSON request failed: ${response.status} ${path}`);
  }

  return response.json() as Promise<T>;
}

export async function getCurrentUser(session: NextcloudSession) {
  return resolveCurrentUser(session);
}

export async function searchUsers(session: NextcloudSession, query = "") {
  const requestPath = `/ocs/v2.php/cloud/users?format=json&search=${encodeURIComponent(query)}`;
  const payload = SERVICE_USERNAME && SERVICE_PASSWORD
    ? await nextcloudJsonWithCredentials<{
        ocs?: {
          data?: {
            users?: string[];
          };
        };
      }>(SERVICE_USERNAME, SERVICE_PASSWORD, requestPath)
    : await nextcloudJson<{
        ocs?: {
          data?: {
            users?: string[];
          };
        };
      }>(session, requestPath);

  const usernames = payload.ocs?.data?.users || [];
  const details = await Promise.all(
    usernames.map(async (username) => {
      try {
        const detailPath = `/ocs/v2.php/cloud/users/${encodeURIComponent(username)}?format=json`;
        const detail = SERVICE_USERNAME && SERVICE_PASSWORD
          ? await nextcloudJsonWithCredentials<{
              ocs?: {
                data?: {
                  id?: string;
                  displayname?: string;
                  email?: string | null;
                };
              };
            }>(SERVICE_USERNAME, SERVICE_PASSWORD, detailPath)
          : await nextcloudJson<{
              ocs?: {
                data?: {
                  id?: string;
                  displayname?: string;
                  email?: string | null;
                };
              };
            }>(session, detailPath);

        const data = detail.ocs?.data;
        return {
          id: String(data?.id || username),
          username,
          displayName: String(data?.displayname || username),
          email: data?.email ? String(data.email) : null,
        } satisfies NextcloudDirectoryUser;
      } catch {
        return {
          id: username,
          username,
          displayName: username,
          email: null,
        } satisfies NextcloudDirectoryUser;
      }
    }),
  );

  return details.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function listFiles(session: NextcloudSession, parentPath: string) {
  const response = await nextcloudFetch(session, toDavUrl(session.username, parentPath), {
    method: "PROPFIND",
    headers: {
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <d:displayname />
    <d:getcontentlength />
    <d:getcontenttype />
    <d:getlastmodified />
    <d:resourcetype />
    <oc:favorite />
  </d:prop>
</d:propfind>`,
  });

  if (response.status === 404) return [];
  if (response.status !== 207) {
    throw new Error(`WebDAV PROPFIND failed: ${response.status}`);
  }

  return parseDavResponses(await response.text(), session.username, parentPath);
}

function isMediaMime(mimeType: string | null) {
  if (!mimeType) return false;
  return mimeType.startsWith("image/") || mimeType.startsWith("video/");
}

async function collectFilesRecursive(
  session: NextcloudSession,
  parentPath: string,
  depth: number,
  limit: number,
  results: DavFile[],
) {
  if (depth < 0 || results.length >= limit) return;

  const entries = await listFiles(session, parentPath);
  for (const entry of entries) {
    if (entry.type === "file") {
      results.push(entry);
      if (results.length >= limit) return;
      continue;
    }

    if (entry.type === "folder" && depth > 0) {
      await collectFilesRecursive(session, entry.path, depth - 1, limit, results);
      if (results.length >= limit) return;
    }
  }
}

export async function listMediaFiles(
  session: NextcloudSession,
  options?: { rootPath?: string; maxDepth?: number; limit?: number },
) {
  const rootPath = normalizeCloudPath(options?.rootPath || "/");
  const maxDepth = options?.maxDepth ?? 4;
  const limit = options?.limit ?? 300;
  const allFiles: DavFile[] = [];

  await collectFilesRecursive(session, rootPath, maxDepth, limit, allFiles);

  return allFiles
    .filter((file) => isMediaMime(file.mimeType))
    .map((file) => ({
      ...file,
      mediaKind: file.mimeType?.startsWith("video/") ? "video" : "image",
    })) satisfies CloudMediaFile[];
}

// Server-generated thumbnail via Nextcloud's core preview endpoint (much smaller
// than the full file, so the gallery grid doesn't download originals).
export async function getMediaThumbnail(session: NextcloudSession, cloudPath: string, size = 256) {
  const clamped = Math.min(Math.max(size, 32), 1024);
  const file = encodeURIComponent(normalizeCloudPath(cloudPath));
  const response = await nextcloudFetch(
    session,
    `/index.php/core/preview.png?file=${file}&x=${clamped}&y=${clamped}&a=1&mode=cover`,
  );
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType: response.headers.get("content-type") || "image/png" };
}

// Toggle Nextcloud's native favorite flag (oc:favorite) on a file via PROPPATCH.
export async function setFileFavorite(session: NextcloudSession, cloudPath: string, favorite: boolean) {
  const response = await nextcloudFetch(session, toDavUrl(session.username, cloudPath), {
    method: "PROPPATCH",
    headers: { "Content-Type": "application/xml; charset=utf-8" },
    body: `<?xml version="1.0"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:set><d:prop><oc:favorite>${favorite ? 1 : 0}</oc:favorite></d:prop></d:set>
</d:propertyupdate>`,
  });
  if (response.status !== 207 && !response.ok) {
    throw new Error(`Setting favorite failed: ${response.status}`);
  }
  return { favorite };
}

export async function createFolder(session: NextcloudSession, parentPath: string, name: string) {
  const parent = normalizeCloudPath(parentPath);
  const folderPath = parent === "/" ? `/${name}` : `${parent}/${name}`;
  const response = await nextcloudFetch(session, toDavUrl(session.username, folderPath), {
    method: "MKCOL",
  });

  if (!response.ok && response.status !== 405) {
    throw new Error(`WebDAV MKCOL failed: ${response.status}`);
  }

  return {
    id: hashToId(folderPath),
    name,
    path: folderPath,
    type: "folder" as const,
    mimeType: null,
    size: 0,
    modifiedAt: new Date().toISOString(),
    sharedWith: null,
    isFavourite: false,
    parentPath: parent,
    ownerId: 1,
  };
}

export async function uploadFile(
  session: NextcloudSession,
  parentPath: string,
  name: string,
  content: Buffer,
  contentType: string,
) {
  const parent = normalizeCloudPath(parentPath);
  const filePath = parent === "/" ? `/${name}` : `${parent}/${name}`;
  const response = await nextcloudFetch(session, toDavUrl(session.username, filePath), {
    method: "PUT",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
    },
    body: content,
  });

  if (!response.ok) {
    throw new Error(`WebDAV PUT failed: ${response.status}`);
  }

  const files = await listFiles(session, parent);
  const uploaded = files.find((file) => file.path === filePath || file.name === name);
  if (!uploaded) {
    throw new Error("Uploaded file could not be reloaded from Nextcloud.");
  }

  return uploaded;
}

export async function getFile(session: NextcloudSession, cloudPath: string) {
  const parent = getParentPath(cloudPath);
  const name = getBaseName(cloudPath);
  const files = await listFiles(session, parent);
  return files.find((file) => file.path === normalizeCloudPath(cloudPath) || file.name === name) || null;
}

export async function downloadFile(session: NextcloudSession, cloudPath: string) {
  const response = await nextcloudFetch(session, toDavUrl(session.username, cloudPath), {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`WebDAV GET failed: ${response.status}`);
  }

  const file = await getFile(session, cloudPath);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get("content-type") || file?.mimeType || "application/octet-stream",
    name: file?.name || getBaseName(cloudPath) || "download",
  };
}

export async function createPublicShareLink(session: NextcloudSession, cloudPath: string): Promise<string | null> {
  try {
    const response = await nextcloudJson<{ ocs: { data: { url?: string; token?: string } } }>(
      session,
      "/ocs/v2.php/apps/files_sharing/api/v1/shares",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: cloudPath,
          shareType: 3, // 3 = public link
          permissions: 1, // 1 = read only
        }),
      },
    );
    return response.ocs?.data?.url || null;
  } catch {
    return null;
  }
}

export type ShareRecord = {
  id: string;
  shareType: number; // 0 = registered user, 3 = public link
  shareWith: string | null;
  shareWithDisplayName: string | null;
  permissions: number;
  url: string | null;
  token: string | null;
  path: string;
};

function mapShare(raw: Record<string, any>): ShareRecord {
  return {
    id: String(raw.id),
    shareType: Number(raw.share_type),
    shareWith: raw.share_with != null ? String(raw.share_with) : null,
    shareWithDisplayName:
      raw.share_with_displayname != null
        ? String(raw.share_with_displayname)
        : raw.share_with != null
          ? String(raw.share_with)
          : null,
    permissions: Number(raw.permissions || 0),
    url: raw.url ? String(raw.url) : null,
    token: raw.token ? String(raw.token) : null,
    path: String(raw.path || ""),
  };
}

const SHARES_API = "/ocs/v2.php/apps/files_sharing/api/v1/shares";

export async function listShares(session: NextcloudSession, cloudPath: string): Promise<ShareRecord[]> {
  const response = await nextcloudJson<{ ocs?: { data?: Record<string, any>[] } }>(
    session,
    `${SHARES_API}?path=${encodeURIComponent(cloudPath)}&reshares=false&format=json`,
  );
  const data = response.ocs?.data;
  return Array.isArray(data) ? data.map(mapShare) : [];
}

export async function createShare(
  session: NextcloudSession,
  options: { path: string; shareType: number; shareWith?: string; permissions?: number },
): Promise<ShareRecord> {
  const body: Record<string, unknown> = {
    path: options.path,
    shareType: options.shareType,
  };
  if (options.shareWith) body.shareWith = options.shareWith;
  if (typeof options.permissions === "number") body.permissions = options.permissions;

  // Use the raw fetch so we can surface Nextcloud's OCS error message (e.g. "already shared").
  const response = await nextcloudFetch(session, `${SHARES_API}?format=json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OCS-APIRequest": "true",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | { ocs?: { data?: Record<string, any>; meta?: { message?: string } } }
    | null;

  if (!response.ok) {
    throw new Error(payload?.ocs?.meta?.message || `Unable to create share (${response.status}).`);
  }
  return mapShare(payload?.ocs?.data || {});
}

export type IncomingShare = {
  id: string;
  path: string; // location in the recipient's own file space (file_target)
  name: string;
  itemType: "file" | "folder";
  ownerId: string;
  ownerDisplayName: string;
  permissions: number;
  sharedAt: string;
};

export async function listIncomingShares(session: NextcloudSession): Promise<IncomingShare[]> {
  const response = await nextcloudJson<{ ocs?: { data?: Record<string, any>[] } }>(
    session,
    `${SHARES_API}?shared_with_me=true&format=json`,
  );
  const data = response.ocs?.data;
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const target = String(raw.file_target || raw.path || "");
    const name = target.split("/").filter(Boolean).at(-1) || target || "Shared item";
    return {
      id: String(raw.id),
      path: normalizeCloudPath(target),
      name,
      itemType: raw.item_type === "folder" ? "folder" : "file",
      ownerId: String(raw.uid_owner || ""),
      ownerDisplayName: String(raw.displayname_owner || raw.uid_owner || "Someone"),
      permissions: Number(raw.permissions || 0),
      sharedAt: raw.stime ? new Date(Number(raw.stime) * 1000).toISOString() : new Date().toISOString(),
    };
  });
}

export type OutgoingShare = {
  id: string;
  path: string;
  name: string;
  itemType: "file" | "folder";
  shareType: number; // 0 = registered user, 3 = public link
  shareWith: string | null;
  shareWithDisplayName: string | null;
  permissions: number;
  url: string | null;
  sharedAt: string;
};

export async function listOutgoingShares(session: NextcloudSession): Promise<OutgoingShare[]> {
  // No path + no shared_with_me => every share the current user has created.
  const response = await nextcloudJson<{ ocs?: { data?: Record<string, any>[] } }>(
    session,
    `${SHARES_API}?format=json`,
  );
  const data = response.ocs?.data;
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const p = String(raw.path || raw.file_target || "");
    const name = p.split("/").filter(Boolean).at(-1) || p || "Item";
    return {
      id: String(raw.id),
      path: normalizeCloudPath(p),
      name,
      itemType: raw.item_type === "folder" ? "folder" : "file",
      shareType: Number(raw.share_type),
      shareWith: raw.share_with != null ? String(raw.share_with) : null,
      shareWithDisplayName:
        raw.share_with_displayname != null
          ? String(raw.share_with_displayname)
          : raw.share_with != null
            ? String(raw.share_with)
            : null,
      permissions: Number(raw.permissions || 0),
      url: raw.url ? String(raw.url) : null,
      sharedAt: raw.stime ? new Date(Number(raw.stime) * 1000).toISOString() : new Date().toISOString(),
    };
  });
}

export async function deleteShare(session: NextcloudSession, shareId: string): Promise<void> {
  const response = await nextcloudFetch(session, `${SHARES_API}/${encodeURIComponent(shareId)}?format=json`, {
    method: "DELETE",
    headers: { "OCS-APIRequest": "true", Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Unable to remove share (${response.status}).`);
  }
}

export async function deleteFile(session: NextcloudSession, cloudPath: string) {
  const response = await nextcloudFetch(session, toDavUrl(session.username, cloudPath), {
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`WebDAV DELETE failed: ${response.status}`);
  }

  return { success: true };
}

export async function fetchNextcloudActivity(session: NextcloudSession, limit = 5) {
  const response = await nextcloudJson<{
    ocs?: {
      data?: Array<{
        activity_id: number;
        type: string;
        subject: string;
        datetime: string;
        icon?: string;
        link?: string;
      }>;
    };
  }>(session, `/ocs/v2.php/apps/activity/api/v2/activity?format=json&limit=${limit}`);

  const entries = response.ocs?.data || [];
  return entries.map((entry) => {
    let activityType = "system";
    const t = entry.type || "";
    if (t.includes("file") || t.includes("shared")) activityType = "file";
    else if (t.includes("share")) activityType = "share";
    else if (t.includes("comment")) activityType = "comment";
    else if (t.includes("spreed") || t.includes("call")) activityType = "talk";

    return {
      id: entry.activity_id,
      type: activityType,
      description: entry.subject,
      timestamp: entry.datetime || new Date().toISOString(),
    };
  });
}

export async function getDashboardData(
  session: NextcloudSession,
  options: { includeMockData: boolean },
) {
  const [user, rootFiles] = await Promise.all([
    getCurrentUser(session),
    listFiles(session, "/"),
  ]);

  const recentFiles = rootFiles
    .filter((file) => file.type === "file")
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, 5);

  const convos = options.includeMockData ? storage.getConversations() : [];
  const unreadMessages = convos.reduce((sum, conversation) => sum + (conversation.unreadCount || 0), 0);
  const recentConvos = convos
    .filter((conversation) => conversation.lastMessageAt)
    .sort((a, b) => (b.lastMessageAt || "").localeCompare(a.lastMessageAt || ""))
    .slice(0, 2);
  const recentMessages = recentConvos.map((conversation) => {
    const messages = storage.getMessages(conversation.id);
    return {
      conversation,
      message: messages[messages.length - 1],
    };
  });

  const now = new Date().toISOString();
  const upcomingEvents = options.includeMockData
    ? storage
        .getEvents()
        .filter((event) => event.startAt >= now || event.allDay)
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
        .slice(0, 3)
    : [];

  return {
    displayName: user.name || session.username,
    recentFiles,
    upcomingEvents,
    unreadMessages,
    recentMessages,
    storageUsed: user.storageUsed || 0,
    storageQuota: user.storageQuota || 0,
    recentActivity: options.includeMockData ? storage.getActivities().slice(0, 5) : [],
    integrationMode: options.includeMockData ? "mixed" : "nextcloud-only",
  };
}
