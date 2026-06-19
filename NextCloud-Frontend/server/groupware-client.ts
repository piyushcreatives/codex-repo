import { createHash, randomUUID } from "node:crypto";
import type { NextcloudSession } from "./credential-provider";
import { nextcloudWebSessionJson } from "./nextcloud-web-session";

const NC_BASE_URL = process.env.NC_BASE_URL || "http://localhost:8090";
const NOTES_ROOT = process.env.NEXTCLOUD_NOTES_PATH || "/Notes";

type JsonObject = Record<string, unknown>;

type DavCollection = {
  href: string;
  displayName: string;
  color?: string;
};

type TalkConversationRecord = {
  id: number;
  token: string;
  name: string;
  type: "dm" | "group";
  avatar: null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  members: string;
  isMuted: boolean;
  isFavorite: boolean;
  adminId: number | null;
  createdBy: number | null;
};

type TalkMessageRecord = {
  id: number;
  conversationId: number;
  senderId: number;
  senderName: string;
  content: string;
  sentAt: string;
  reactions: string | null;
  replyToId: number | null;
  systemMessage: string | null;
};

export type TalkParticipantRecord = {
  attendeeId: number;
  actorId: string;
  actorType: string;
  displayName: string;
  email: string | null;
  isModerator: boolean;
  inCall: boolean;
  sessionIds: string[];
  status: string | null;
  statusMessage: string | null;
  lastPing: number;
};

export type TalkSignalingSettings = {
  mode: string;
  helloAuthParams: Record<string, unknown> | null;
  stunServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  turnServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
};

type CalendarEventRecord = {
  id: number;
  href: string;
  etag: string | null;
  calendarHref: string;
  uid: string | null;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  calendar: string;
  color: string;
  location: string | null;
};

type ContactRecord = {
  id: number;
  href: string;
  etag: string | null;
  uid: string | null;
  addressBookHref: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  group: string | null;
  avatar: null;
  tags: string;
};

// Nextcloud contact "groups" are vCard CATEGORIES. CloudSpace's UI offers a fixed
// single-select group plus free-form tags; we persist both as CATEGORIES and, on
// read, treat the first category matching a known group name as the group and the
// rest as tags. This round-trips cleanly with the native Contacts app.
const KNOWN_CONTACT_GROUPS = ["Work", "Personal", "Friends", "Family"];

type NoteRecord = {
  id: number;
  stableId: string;
  href: string;
  title: string;
  content: string;
  tags: string;
  updatedAt: string;
  createdAt: string;
  isPinned: boolean;
};

// Notes are plain WebDAV markdown files, which carry no pin/tag metadata. CloudSpace
// stores that (plus a stable id) in a leading HTML comment so it travels with the file
// and survives in the native Files/Notes apps. Legacy `cloudspace-id:` comments are
// still read and auto-migrated to the richer `cloudspace-meta:` form on next save.
const NOTE_META_PATTERN = /^<!--\s*cloudspace-meta:(\{[\s\S]*?\})\s*-->\r?\n?/;
const NOTE_LEGACY_PATTERN = /^<!--\s*cloudspace-id:([a-zA-Z0-9-]+)\s*-->\r?\n?/;

// title is authoritative in metadata so it can hold spaces/punctuation that the
// filename can't (the filename is just a sanitized, human-friendly mirror).
type NoteMeta = { id: string; title?: string; pinned: boolean; tags: string[] };

function normalizeNoteTitle(rawTitle: string) {
  return rawTitle.replace(/\.md$/i, "").replace(/-\d{10,}$/i, "") || "Untitled";
}

function parseNoteMeta(content: string, href: string): NoteMeta {
  const m = content.match(NOTE_META_PATTERN);
  if (m) {
    try {
      const j = JSON.parse(m[1]) as Partial<NoteMeta>;
      return {
        id: typeof j.id === "string" && j.id ? j.id : `href:${href}`,
        title: typeof j.title === "string" ? j.title : undefined,
        pinned: Boolean(j.pinned),
        tags: Array.isArray(j.tags) ? j.tags.filter((t): t is string => typeof t === "string") : [],
      };
    } catch { /* malformed — fall through to legacy/default */ }
  }
  const legacy = content.match(NOTE_LEGACY_PATTERN);
  if (legacy) return { id: legacy[1], pinned: false, tags: [] };
  return { id: `href:${href}`, pinned: false, tags: [] };
}

function stripNoteMetadata(content: string) {
  return content.replace(NOTE_META_PATTERN, "").replace(NOTE_LEGACY_PATTERN, "");
}

function serializeNoteContent(meta: NoteMeta, content: string) {
  const json = JSON.stringify({ id: meta.id, title: meta.title, pinned: meta.pinned, tags: meta.tags });
  return `<!-- cloudspace-meta:${json} -->\n${stripNoteMetadata(content)}`;
}

type DeckLabel = {
  id: number;
  title?: string;
  color?: string;
};

type DeckUser = {
  uid?: string;
  displayname?: string;
};

type DeckCardRecord = {
  id: number;
  stackId: number;
  boardId: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  assignee: string | null;
  priority: "low" | "medium" | "high";
  labels: string;
  order: number;
};

type DeckStackRecord = {
  id: number;
  boardId: number;
  title: string;
  order: number;
  cards: DeckCardRecord[];
};

type MailAccount = {
  accountId: number;
  emailAddress?: string;
  email?: string;
  name?: string;
};

type Mailbox = {
  id: number;
  accountId?: number;
  name?: string;
  specialRole?: string;
  total?: number;
  unseen?: number;
};

type CloudMailMessage = {
  id: number;
  folder: string;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  preview: string;
  body: string;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  hasAttachment: boolean;
};

function toBasicAuth(session: NextcloudSession) {
  return Buffer.from(`${session.username}:${session.credential.secret}`).toString("base64");
}

function hashToId(value: string) {
  const digest = createHash("sha1").update(value).digest("hex").slice(0, 8);
  return parseInt(digest, 16);
}

function normalizeCloudPath(input: string | undefined) {
  if (!input || input === "/") return "/";
  const withLeadingSlash = input.startsWith("/") ? input : `/${input}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

function joinCloudPath(basePath: string, child: string) {
  const base = normalizeCloudPath(basePath);
  const cleanChild = child.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleanChild) return base;
  return base === "/" ? `/${cleanChild}` : `${base}/${cleanChild}`;
}

function cloudPathToDavUrl(prefix: "files" | "addressbooks" | "calendars", username: string, cloudPath = "/") {
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
  if (prefix === "addressbooks") {
    return `/remote.php/dav/addressbooks/users/${encodeURIComponent(username)}${suffix}`;
  }
  return `/remote.php/dav/${prefix}/${encodeURIComponent(username)}${suffix}`;
}

function buildHeaders(session: NextcloudSession, headers?: HeadersInit) {
  const nextHeaders = new Headers(headers);
  nextHeaders.set("Authorization", `Basic ${toBasicAuth(session)}`);
  return nextHeaders;
}

async function nextcloudFetch(session: NextcloudSession, path: string, init?: RequestInit) {
  const headers = buildHeaders(session, init?.headers);
  return fetch(`${NC_BASE_URL}${path}`, { ...init, headers });
}

async function nextcloudJson<T>(session: NextcloudSession, path: string, init?: RequestInit) {
  const headers = buildHeaders(session, init?.headers);
  headers.set("Accept", "application/json");
  headers.set("OCS-APIRequest", "true");

  const response = await fetch(`${NC_BASE_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(`Nextcloud JSON request failed: ${response.status} ${path}`);
  }

  return response.json() as Promise<T>;
}

async function nextcloudJsonMaybe<T>(session: NextcloudSession, path: string, init?: RequestInit) {
  const headers = buildHeaders(session, init?.headers);
  headers.set("Accept", "application/json");
  headers.set("OCS-APIRequest", "true");

  const response = await fetch(`${NC_BASE_URL}${path}`, { ...init, headers });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Nextcloud JSON request failed: ${response.status} ${path}`);
  }

  return (await response.json()) as T;
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
    .replace(/&#39;/g, "'")
    .replace(/&#13;/g, "\r")
    .replace(/&#10;/g, "\n");
}

function extractProp(block: string, tagName: string) {
  return decodeXml(extractTagValue(block, tagName));
}

function xmlBlocks(xml: string, tagName: string) {
  return xml.match(new RegExp(`<(?:\\w+:)?${tagName}\\b[\\s\\S]*?<\\/(?:\\w+:)?${tagName}>`, "gi")) || [];
}

function stripIcsValue(value: string) {
  return value.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function unfoldIcs(content: string) {
  return content.replace(/\r?\n[ \t]/g, "");
}

function getIcsLine(content: string, key: string) {
  const normalized = unfoldIcs(content);
  const line = normalized
    .split(/\r?\n/)
    .find((entry) => entry.toUpperCase().startsWith(`${key.toUpperCase()};`) || entry.toUpperCase().startsWith(`${key.toUpperCase()}:`));

  if (!line) return null;
  const separatorIndex = line.indexOf(":");
  if (separatorIndex < 0) return null;
  return {
    raw: line,
    value: stripIcsValue(line.slice(separatorIndex + 1)),
    params: line.slice(key.length, separatorIndex),
  };
}

function parseIcsDate(line: { value: string; params: string } | null) {
  if (!line) return null;
  const isDateOnly = /VALUE=DATE/i.test(line.params);
  if (isDateOnly) {
    const year = Number(line.value.slice(0, 4));
    const month = Number(line.value.slice(4, 6));
    const day = Number(line.value.slice(6, 8));
    return {
      iso: new Date(Date.UTC(year, month - 1, day)).toISOString(),
      allDay: true,
    };
  }

  const compact = line.value.replace(/Z$/, "");
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const hour = Number(compact.slice(9, 11));
  const minute = Number(compact.slice(11, 13));
  const second = Number(compact.slice(13, 15) || 0);
  const asUtc = line.value.endsWith("Z");
  const date = asUtc
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    : new Date(year, month - 1, day, hour, minute, second);

  return {
    iso: date.toISOString(),
    allDay: false,
  };
}

function formatIcsDate(dateIso: string, allDay: boolean) {
  const date = new Date(dateIso);
  if (allDay) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `;VALUE=DATE:${y}${m}${d}`;
  }

  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `:${y}${m}${d}T${h}${min}${s}Z`;
}

function escapeIcs(value: string) {
  // Escape backslash first, then collapse any CR/LF combination into the literal \n token
  // BEFORE escaping commas/semicolons — prevents CRLF line-injection of extra ICS properties.
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function parseVcardValue(content: string, key: string) {
  const normalized = content.replace(/\r?\n[ \t]/g, "");
  const line = normalized
    .split(/\r?\n/)
    .find((entry) => entry.toUpperCase().startsWith(`${key.toUpperCase()};`) || entry.toUpperCase().startsWith(`${key.toUpperCase()}:`));
  if (!line) return null;
  const separatorIndex = line.indexOf(":");
  if (separatorIndex < 0) return null;
  return line.slice(separatorIndex + 1).replace(/\\n/g, "\n").replace(/\r/g, "").trim();
}

function extractEmailFromMailField(value: string | null) {
  if (!value) return null;
  const match = /<([^>]+)>/.exec(value);
  if (match?.[1]) return match[1];
  return value.trim();
}

function parseMailDisplayName(value: string | null) {
  if (!value) return "";
  const beforeEmail = value.split("<")[0]?.trim();
  if (beforeEmail) return beforeEmail.replace(/^"|"$/g, "");
  return value;
}

async function davPropfind(session: NextcloudSession, path: string, depth: "0" | "1", body: string) {
  const response = await nextcloudFetch(session, path, {
    method: "PROPFIND",
    headers: {
      Depth: depth,
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
  });

  if (response.status !== 207) {
    throw new Error(`PROPFIND failed: ${response.status} ${path}`);
  }

  return response.text();
}

async function davReport(session: NextcloudSession, path: string, depth: "0" | "1", body: string) {
  const response = await nextcloudFetch(session, path, {
    method: "REPORT",
    headers: {
      Depth: depth,
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
  });

  if (response.status !== 207) {
    throw new Error(`REPORT failed: ${response.status} ${path}`);
  }

  return response.text();
}

async function listDavCollections(session: NextcloudSession, path: string) {
  const xml = await davPropfind(
    session,
    path,
    "1",
    `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:displayname />
    <oc:calendar-color />
    <cs:getctag />
  </d:prop>
</d:propfind>`,
  );

  const blocks = xmlBlocks(xml, "response");
  const currentPath = decodeURIComponent(path).replace(/\/+$/, "");

  return blocks
    .map((block) => {
      const href = decodeXml(extractTagValue(block, "href")).replace(/\/+$/, "");
      if (!href || href === currentPath) return null;

      return {
        href,
        displayName: extractProp(block, "displayname") || href.split("/").filter(Boolean).at(-1) || "Default",
        color: extractProp(block, "calendar-color") || undefined,
      } satisfies DavCollection;
    })
    .filter((value): value is DavCollection => Boolean(value));
}

function firstArrayItem<T>(value: T[] | null | undefined) {
  return Array.isArray(value) && value.length > 0 ? value[0] : null;
}

function toJsonString(value: unknown) {
  return JSON.stringify(value ?? []);
}

function normalizeTalkConversation(room: JsonObject) {
  const token = String(room.token || "");
  const roomType = Number(room.type || 0);
  const displayName = String(room.displayName || room.name || "Conversation");
  const members = Array.isArray(room.attendees)
    ? room.attendees
        .map((attendee) => String((attendee as JsonObject).displayName || (attendee as JsonObject).actorId || ""))
        .filter(Boolean)
    : [];
  const lastMessage = room.lastMessage as JsonObject | undefined;
  const lastActivity = Number(room.lastActivity || 0);
  const actorId = String(room.actorId || "");

  return {
    id: hashToId(`talk:${token}`),
    token,
    name: displayName,
    type: roomType === 1 ? "dm" : "group",
    avatar: null,
    lastMessage: typeof lastMessage?.message === "string" ? String(lastMessage.message) : null,
    lastMessageAt: lastActivity ? new Date(lastActivity * 1000).toISOString() : null,
    unreadCount: Number(room.unreadMessages || 0),
    members: toJsonString(members),
    isMuted: Number(room.notificationLevel || 0) === 0,
    isFavorite: Boolean(room.isFavorite),
    adminId: actorId ? hashToId(`user:${actorId}`) : null,
    createdBy: actorId ? hashToId(`user:${actorId}`) : null,
  } satisfies TalkConversationRecord;
}

async function listTalkConversationsInternal(session: NextcloudSession) {
  const payload = await nextcloudJson<{ ocs?: { data?: JsonObject[] } }>(
    session,
    "/ocs/v2.php/apps/spreed/api/v4/room?format=json&includeStatus=true",
  );

  return (payload.ocs?.data || []).map(normalizeTalkConversation);
}

async function findTalkConversation(session: NextcloudSession, conversationId: number) {
  const conversations = await listTalkConversationsInternal(session);
  return conversations.find((conversation) => conversation.id === conversationId) || null;
}

async function fetchTalkParticipantsByToken(session: NextcloudSession, token: string) {
  const payload = await nextcloudJson<{ ocs?: { data?: JsonObject[] } }>(
    session,
    `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(token)}/participants?format=json&includeStatus=true`,
  );

  return (payload.ocs?.data || []).map((participant) => ({
    attendeeId: Number(participant.attendeeId || 0),
    actorId: String(participant.actorId || ""),
    actorType: String(participant.actorType || ""),
    displayName: String(participant.displayName || participant.actorId || "Unknown"),
    email: typeof participant.email === "string" ? participant.email : null,
    isModerator: Number(participant.participantType || 0) <= 2 && Number(participant.participantType || 0) >= 1,
    inCall: Array.isArray(participant.sessionIds) && participant.sessionIds.length > 0,
    sessionIds: Array.isArray(participant.sessionIds)
      ? participant.sessionIds
          .map((value) => String(value || ""))
          .filter(Boolean)
      : [],
    status: typeof participant.status === "string" ? participant.status : null,
    statusMessage: typeof participant.statusMessage === "string" ? participant.statusMessage : null,
    lastPing: Number(participant.lastPing || 0),
  })) satisfies TalkParticipantRecord[];
}

export async function listConversations(session: NextcloudSession) {
  const conversations = await listTalkConversationsInternal(session);
  return conversations.sort((a, b) => (b.lastMessageAt || "").localeCompare(a.lastMessageAt || ""));
}

export async function getConversation(session: NextcloudSession, conversationId: number) {
  return findTalkConversation(session, conversationId);
}

export async function listConversationParticipants(session: NextcloudSession, conversationId: number) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) return [];
  return fetchTalkParticipantsByToken(session, conversation.token);
}

export async function getConversationToken(session: NextcloudSession, conversationId: number) {
  const conversation = await findTalkConversation(session, conversationId);
  return conversation?.token || null;
}

export async function getTalkSignalingSettings(session: NextcloudSession, conversationId: number) {
  const token = await getConversationToken(session, conversationId);
  if (!token) return null;

  const payload = await nextcloudJson<{
    ocs?: {
      data?: {
        signalingMode?: string;
        helloAuthParams?: Record<string, unknown> | null;
        stunservers?: Array<Record<string, unknown>>;
        turnservers?: Array<Record<string, unknown>>;
      };
    };
  }>(
    session,
    `/ocs/v2.php/apps/spreed/api/v3/signaling/settings?format=json&token=${encodeURIComponent(token)}`,
  );

  const data = payload.ocs?.data;
  return {
    mode: String(data?.signalingMode || "internal"),
    helloAuthParams: (data?.helloAuthParams as Record<string, unknown> | null | undefined) || null,
    stunServers: Array.isArray(data?.stunservers)
      ? data!.stunservers!.map((server) => ({
          urls: Array.isArray(server.urls) ? server.urls.map((value) => String(value)) : String(server.urls || ""),
          username: typeof server.username === "string" ? server.username : undefined,
          credential: typeof server.credential === "string" ? server.credential : undefined,
        }))
      : [],
    turnServers: Array.isArray(data?.turnservers)
      ? data!.turnservers!.map((server) => ({
          urls: Array.isArray(server.urls) ? server.urls.map((value) => String(value)) : String(server.urls || ""),
          username: typeof server.username === "string" ? server.username : undefined,
          credential: typeof server.credential === "string" ? server.credential : undefined,
        }))
      : [],
  } satisfies TalkSignalingSettings;
}

export async function markConversationParticipantActive(
  session: NextcloudSession,
  conversationId: number,
  force = true,
) {
  const token = await getConversationToken(session, conversationId);
  if (!token) return false;

  const path = `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(token)}/participants/active?format=json`;
  const requestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ force }),
  } satisfies RequestInit;

  if (session.webSession?.cookies?.length) {
    await nextcloudWebSessionJson(session, path, requestInit);
    return true;
  }

  await nextcloudJson(session, path, requestInit);

  return true;
}

export async function joinNativeTalkCall(session: NextcloudSession, conversationId: number, flags: number) {
  const token = await getConversationToken(session, conversationId);
  if (!token) return null;

  const payload = await nextcloudWebSessionJson<{ ocs?: { data?: JsonObject } }>(
    session,
    `/ocs/v2.php/apps/spreed/api/v4/call/${encodeURIComponent(token)}?format=json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ flags }),
    },
  );

  return {
    token,
    sessionId: typeof payload.ocs?.data?.sessionId === "string" ? payload.ocs?.data?.sessionId : null,
  };
}

export async function updateNativeTalkCallFlags(session: NextcloudSession, conversationId: number, flags: number) {
  const token = await getConversationToken(session, conversationId);
  if (!token) return null;

  const payload = await nextcloudWebSessionJson<{ ocs?: { data?: JsonObject } }>(
    session,
    `/ocs/v2.php/apps/spreed/api/v4/call/${encodeURIComponent(token)}?format=json`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ flags }),
    },
  );

  return {
    token,
    sessionId: typeof payload.ocs?.data?.sessionId === "string" ? payload.ocs?.data?.sessionId : null,
  };
}

export async function leaveNativeTalkCall(session: NextcloudSession, conversationId: number) {
  const token = await getConversationToken(session, conversationId);
  if (!token) return false;

  await nextcloudWebSessionJson(
    session,
    `/ocs/v2.php/apps/spreed/api/v4/call/${encodeURIComponent(token)}?format=json`,
    {
      method: "DELETE",
    },
  );

  return true;
}

export async function createConversation(
  session: NextcloudSession,
  input: {
    name: string;
    type: string;
    inviteUsername?: string;
    memberUsernames?: string[];
  },
) {
  const roomType = input.type === "dm" ? 1 : 2;
  const payload = await nextcloudJson<{ ocs?: { data?: JsonObject } }>(
    session,
    "/ocs/v2.php/apps/spreed/api/v4/room?format=json",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        roomType,
        ...(roomType === 1
          ? { invite: input.inviteUsername || input.name }
          : { roomName: input.name }),
      }),
    },
  );

  const conversation = normalizeTalkConversation((payload.ocs?.data || {}) as JsonObject);

  if (roomType === 2) {
    const invitees = (input.memberUsernames || []).filter(
      (username) => username && username !== session.username,
    );

    for (const username of invitees) {
      await nextcloudJson(
        session,
        `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(conversation.token)}/participants?format=json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            newParticipant: username,
            source: "users",
          }),
        },
      ).catch(() => undefined);
    }
  }

  return (await findTalkConversation(session, conversation.id)) || conversation;
}

export async function markConversationRead(session: NextcloudSession, conversationId: number) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) return false;

  // Try the v1 chat read-marker endpoint first (requires lastReadMessage param on newer Talk versions)
  try {
    // Fetch the latest message ID to use as lastReadMessage
    const messages = await listConversationMessages(session, conversationId);
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

    await nextcloudJson(
      session,
      `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(conversation.token)}/read?format=json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lastMessage ? { lastReadMessage: lastMessage.id } : {}),
      },
    );
    return true;
  } catch {
    // Fallback: some Talk versions may not support the read-marker endpoint — silently succeed
    return true;
  }
}

export async function setConversationMute(session: NextcloudSession, conversationId: number, muted: boolean) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) return null;

  await nextcloudJson(
    session,
    `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(conversation.token)}/notify?format=json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: muted ? 0 : 1 }),
    },
  );

  return { isMuted: muted };
}

export async function setConversationFavorite(session: NextcloudSession, conversationId: number, favorite: boolean) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) return null;

  await nextcloudJson(
    session,
    `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(conversation.token)}/favorite?format=json`,
    { method: favorite ? "POST" : "DELETE" },
  );

  return { isFavorite: favorite };
}

export async function listNotifications(session: NextcloudSession) {
  try {
    const payload = await nextcloudJson<{ ocs?: { data?: JsonObject[] } }>(
      session,
      "/ocs/v2.php/apps/notifications/api/v2/notifications?format=json",
    );
    return (payload.ocs?.data || []).map((n) => ({
      id: Number(n.notification_id || 0),
      app: String(n.app || ""),
      subject: String(n.subject || ""),
      message: String(n.message || ""),
      datetime: String(n.datetime || ""),
      link: typeof n.link === "string" ? n.link : null,
    }));
  } catch {
    return []; // notifications app not installed / unavailable
  }
}

export async function dismissNotification(session: NextcloudSession, id: number) {
  await nextcloudJson(session, `/ocs/v2.php/apps/notifications/api/v2/notifications/${id}?format=json`, { method: "DELETE" });
  return { success: true };
}

// notify_push (High Performance Backend) WebSocket endpoint, if the app is installed.
export async function getNotifyPushEndpoint(session: NextcloudSession): Promise<string | null> {
  try {
    const payload = await nextcloudJson<{
      ocs?: { data?: { capabilities?: { notify_push?: { endpoints?: { websocket?: string } } } } };
    }>(session, "/ocs/v2.php/cloud/capabilities?format=json");
    return payload.ocs?.data?.capabilities?.notify_push?.endpoints?.websocket || null;
  } catch {
    return null;
  }
}

export async function dismissAllNotifications(session: NextcloudSession) {
  await nextcloudJson(session, "/ocs/v2.php/apps/notifications/api/v2/notifications?format=json", { method: "DELETE" });
  return { success: true };
}

export type RawActivity = {
  id: number;
  type: string; // 'file' | 'share' | 'comment' | 'system' | 'talk'
  actor: string;
  actorAvatar: string | null;
  description: string;
  subject: string | null;
  timestamp: string;
  link: string | null;
};

// Map Nextcloud's many app/type combinations onto the five categories the
// Activity UI knows how to render (file / share / comment / talk / system).
function mapActivityType(app: string, type: string): string {
  const a = app.toLowerCase();
  const t = type.toLowerCase();
  if (a === "files") return "file";
  if (a === "files_sharing" || t.includes("share")) return "share";
  if (a === "comments" || t.includes("comment")) return "comment";
  if (a === "spreed" || a === "talk") return "talk";
  return "system";
}

// Resolve a Nextcloud user id → display name, cached (the provisioning endpoint
// is admin/subadmin-gated, so this gracefully falls back to the uid otherwise —
// no regression, an upgrade where permitted).
const displayNameCache = new Map<string, { name: string; ts: number }>();
const DISPLAY_NAME_TTL_MS = 10 * 60 * 1000;

async function resolveDisplayName(session: NextcloudSession, uid: string): Promise<string> {
  if (!uid) return "Someone";
  const cached = displayNameCache.get(uid);
  if (cached && Date.now() - cached.ts < DISPLAY_NAME_TTL_MS) return cached.name;
  let name = uid;
  try {
    const payload = await nextcloudJson<{ ocs?: { data?: { displayname?: string } } }>(
      session,
      `/ocs/v2.php/cloud/users/${encodeURIComponent(uid)}?format=json`,
    );
    name = payload.ocs?.data?.displayname || uid;
  } catch {
    name = uid; // not permitted / unknown — fall back to the id
  }
  displayNameCache.set(uid, { name, ts: Date.now() });
  return name;
}

export async function listActivities(session: NextcloudSession, opts?: { limit?: number }): Promise<RawActivity[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  try {
    // `/all` is the full stream visible to the user (matches the web UI's "All activity").
    const payload = await nextcloudJson<{ ocs?: { data?: JsonObject[] } }>(
      session,
      `/ocs/v2.php/apps/activity/api/v2/activity/all?format=json&limit=${limit}`,
    );
    const raw = payload.ocs?.data || [];

    // Resolve each unique actor id to a display name once (cached, in parallel).
    const uids = [...new Set(raw.map((a) => String(a.user || "")).filter(Boolean))];
    const nameByUid = new Map<string, string>();
    await Promise.all(uids.map(async (uid) => nameByUid.set(uid, await resolveDisplayName(session, uid))));

    return raw.map((a): RawActivity => {
      const app = String(a.app || "");
      const type = String(a.type || "");
      const uid = String(a.user || "");
      const objectName = typeof a.object_name === "string" && a.object_name ? a.object_name : null;
      return {
        id: Number(a.activity_id || 0),
        type: mapActivityType(app, type),
        actor: nameByUid.get(uid) || "Someone",
        actorAvatar: null,
        description: String(a.subject || ""),
        subject: objectName,
        timestamp: String(a.datetime || ""),
        link: typeof a.link === "string" && a.link ? String(a.link) : null,
      };
    });
  } catch {
    return []; // activity app not installed / unavailable
  }
}

export async function markConversationUnread(session: NextcloudSession, conversationId: number) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) return false;

  await nextcloudJson(
    session,
    `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(conversation.token)}/read?format=json`,
    { method: "DELETE" },
  );

  return true;
}

export async function setConversationModerator(session: NextcloudSession, conversationId: number, adminId: number) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) return null;

  await nextcloudJson(
    session,
    `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(conversation.token)}/moderators?format=json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeId: adminId }),
    },
  );

  return findTalkConversation(session, conversationId);
}

export async function addConversationParticipant(session: NextcloudSession, conversationId: number, username: string) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) return null;

  await nextcloudJson(
    session,
    `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(conversation.token)}/participants?format=json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newParticipant: username,
        source: "users",
      }),
    },
  );

  return fetchTalkParticipantsByToken(session, conversation.token);
}

export async function removeConversationParticipant(session: NextcloudSession, conversationId: number, attendeeId: number) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) return null;

  await nextcloudJson(
    session,
    `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(conversation.token)}/attendees?format=json`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeId }),
    },
  );

  return fetchTalkParticipantsByToken(session, conversation.token);
}

export async function leaveConversation(session: NextcloudSession, conversationId: number) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) return false;

  await nextcloudJson(
    session,
    `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(conversation.token)}/participants/self?format=json`,
    { method: "DELETE" },
  );
  return true;
}

export async function deleteConversation(session: NextcloudSession, conversationId: number) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) return false;

  await nextcloudJson(
    session,
    `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(conversation.token)}?format=json`,
    { method: "DELETE" },
  );
  return true;
}

export async function listConversationMessages(session: NextcloudSession, conversationId: number) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) return [];

  const payload = await nextcloudJson<{ ocs?: { data?: JsonObject[] } }>(
    session,
    `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(conversation.token)}?format=json&lookIntoFuture=0&limit=200`,
  );

  return (payload.ocs?.data || [])
    .map((message) => {
      const actorId = String(message.actorId || message.actorDisplayName || "unknown");
      const reactions = message.reactions && typeof message.reactions === "object"
        ? JSON.stringify(message.reactions)
        : null;
      const timestamp = Number(message.timestamp || 0);
      const sysMsg = typeof message.systemMessage === "string" && message.systemMessage !== ""
        ? message.systemMessage
        : null;
      return {
        id: Number(message.id || 0),
        conversationId,
        senderId: hashToId(`user:${actorId}`),
        senderName: String(message.actorDisplayName || message.actorId || "Unknown"),
        content: String(message.message || ""),
        sentAt: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
        reactions,
        replyToId: message.parent && typeof message.parent === "object"
          ? Number((message.parent as JsonObject).id || 0) || null
          : null,
        systemMessage: sysMsg,
      } satisfies TalkMessageRecord;
    })
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export async function sendConversationMessage(session: NextcloudSession, conversationId: number, content: string) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) throw new Error("Conversation not found");

  const payload = await nextcloudJson<{ ocs?: { data?: JsonObject } }>(
    session,
    `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(conversation.token)}?format=json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: content }),
    },
  );

  const message = (payload.ocs?.data || {}) as JsonObject;
  const actorId = String(message.actorId || message.actorDisplayName || session.username);
  const timestamp = Number(message.timestamp || 0);

  return {
    id: Number(message.id || 0),
    conversationId,
    senderId: hashToId(`user:${actorId}`),
    senderName: String(message.actorDisplayName || message.actorId || session.username),
    content: String(message.message || content),
    sentAt: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
    reactions: message.reactions ? JSON.stringify(message.reactions) : null,
    replyToId: null,
    systemMessage: null,
  } satisfies TalkMessageRecord;
}

export async function addReaction(session: NextcloudSession, conversationId: number, messageId: number, reaction: string) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) throw new Error("Conversation not found");
  await nextcloudJson(
    session,
    `/ocs/v2.php/apps/spreed/api/v1/reaction/${encodeURIComponent(conversation.token)}/${messageId}?format=json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction }),
    },
  );
  return { success: true };
}

export async function removeReaction(session: NextcloudSession, conversationId: number, messageId: number, reaction: string) {
  const conversation = await findTalkConversation(session, conversationId);
  if (!conversation) throw new Error("Conversation not found");
  await nextcloudJson(
    session,
    `/ocs/v2.php/apps/spreed/api/v1/reaction/${encodeURIComponent(conversation.token)}/${messageId}?reaction=${encodeURIComponent(reaction)}&format=json`,
    { method: "DELETE" },
  );
  return { success: true };
}

async function listCalendars(session: NextcloudSession) {
  return listDavCollections(session, cloudPathToDavUrl("calendars", session.username, "/"));
}

async function listCalendarEventsInternal(session: NextcloudSession) {
  const calendars = await listCalendars(session);
  const eventLists = await Promise.all(
    calendars.map(async (calendar) => {
      const xml = await davReport(
        session,
        calendar.href,
        "1",
        `<?xml version="1.0"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT" />
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`,
      );

      return xmlBlocks(xml, "response").map((block) => {
        const href = decodeXml(extractTagValue(block, "href"));
        const calendarData = extractProp(block, "calendar-data");
        const startLine = getIcsLine(calendarData, "DTSTART");
        const endLine = getIcsLine(calendarData, "DTEND");
        const start = parseIcsDate(startLine);
        const end = parseIcsDate(endLine) || start;
        if (!href || !start || !end) return null;

        return {
          id: hashToId(`cal:${href}`),
          href,
          etag: extractProp(block, "getetag") || null,
          calendarHref: calendar.href,
          uid: stripIcsValue(getIcsLine(calendarData, "UID")?.value || "") || null,
          title: stripIcsValue(getIcsLine(calendarData, "SUMMARY")?.value || "Untitled"),
          description: stripIcsValue(getIcsLine(calendarData, "DESCRIPTION")?.value || "") || null,
          startAt: start.iso,
          endAt: end.iso,
          allDay: start.allDay,
          calendar: calendar.displayName,
          color: calendar.color || "#4F46E5",
          location: stripIcsValue(getIcsLine(calendarData, "LOCATION")?.value || "") || null,
        } satisfies CalendarEventRecord;
      }).filter((event): event is CalendarEventRecord => Boolean(event));
    }),
  );

  return eventLists.flat().sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function mapCalendarEvent(record: CalendarEventRecord) {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    startAt: record.startAt,
    endAt: record.endAt,
    allDay: record.allDay,
    calendar: record.calendar,
    color: record.color,
    location: record.location,
  };
}

export async function listEvents(session: NextcloudSession) {
  const events = await listCalendarEventsInternal(session);
  return events.map(mapCalendarEvent);
}

export async function getEvent(session: NextcloudSession, eventId: number) {
  const events = await listCalendarEventsInternal(session);
  const event = events.find((entry) => entry.id === eventId);
  return event ? mapCalendarEvent(event) : null;
}

function buildEventIcs(event: {
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  allDay?: boolean | null;
  location?: string | null;
  uid?: string;
}) {
  const uid = event.uid || `cloudspace-${Date.now()}-${Math.random().toString(36).slice(2)}@cloudspace.local`;
  const allDay = Boolean(event.allDay);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CloudSpace//Nextcloud Adapter//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP${formatIcsDate(new Date().toISOString(), false)}`,
    `DTSTART${formatIcsDate(event.startAt, allDay)}`,
    `DTEND${formatIcsDate(event.endAt, allDay)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
  ];

  if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);

  lines.push("END:VEVENT", "END:VCALENDAR", "");
  return lines.join("\r\n");
}

export async function createEvent(session: NextcloudSession, input: {
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  calendar?: string;
  location?: string | null;
}) {
  const calendars = await listCalendars(session);
  const calendar =
    calendars.find((entry) => entry.displayName === input.calendar) ||
    firstArrayItem(calendars);

  if (!calendar) {
    throw new Error("No writable Nextcloud calendar found");
  }

  const fileName = `cloudspace-${Date.now()}.ics`;
  const href = `${calendar.href.replace(/\/+$/, "")}/${fileName}`;
  const response = await nextcloudFetch(session, href, {
    method: "PUT",
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
    body: buildEventIcs(input),
  });

  if (!response.ok) {
    throw new Error(`Creating event failed: ${response.status}`);
  }

  const created = (await listCalendarEventsInternal(session)).find((event) => event.href === href);
  if (!created) {
    throw new Error("Event was created but could not be reloaded");
  }

  return mapCalendarEvent(created);
}

export async function updateEvent(session: NextcloudSession, eventId: number, patch: Partial<{
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
}>) {
  const events = await listCalendarEventsInternal(session);
  const existing = events.find((event) => event.id === eventId);
  if (!existing) return null;

  const response = await nextcloudFetch(session, existing.href, {
    method: "PUT",
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      ...(existing.etag ? { "If-Match": existing.etag } : {}),
    },
    body: buildEventIcs({
      title: patch.title ?? existing.title,
      description: patch.description ?? existing.description,
      startAt: patch.startAt ?? existing.startAt,
      endAt: patch.endAt ?? existing.endAt,
      allDay: patch.allDay ?? existing.allDay,
      location: patch.location ?? existing.location,
      uid: existing.uid,
    }),
  });

  if (!response.ok) {
    throw new Error(`Updating event failed: ${response.status}`);
  }

  const refreshed = (await listCalendarEventsInternal(session)).find((event) => event.id === eventId);
  return refreshed ? mapCalendarEvent(refreshed) : null;
}

export async function deleteEvent(session: NextcloudSession, eventId: number) {
  const events = await listCalendarEventsInternal(session);
  const existing = events.find((event) => event.id === eventId);
  if (!existing) return false;

  const response = await nextcloudFetch(session, existing.href, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Deleting event failed: ${response.status}`);
  }
  return true;
}

async function listAddressBooks(session: NextcloudSession) {
  return listDavCollections(session, cloudPathToDavUrl("addressbooks", session.username, "/"));
}

async function ensureWritableAddressBook(session: NextcloudSession) {
  const preferredHref = `${cloudPathToDavUrl("addressbooks", session.username, "/").replace(/\/+$/, "")}/cloudspace-contacts`;
  const addressBooks = await listAddressBooks(session);
  const existing = addressBooks.find((book) => !/recent/i.test(book.displayName) && !/z-app-generated/i.test(book.href));
  if (existing) {
    return existing;
  }

  const response = await nextcloudFetch(session, `${preferredHref}/`, {
    method: "MKCOL",
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: `<?xml version="1.0"?>
<d:mkcol xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:set>
    <d:prop>
      <d:displayname>CloudSpace Contacts</d:displayname>
      <d:resourcetype>
        <d:collection />
        <card:addressbook />
      </d:resourcetype>
    </d:prop>
  </d:set>
</d:mkcol>`,
  });

  if (!response.ok && response.status !== 405) {
    throw new Error(`Creating address book failed: ${response.status}`);
  }

  const refreshed = await listAddressBooks(session);
  const created = refreshed.find((book) => book.href.replace(/\/+$/, "") === preferredHref);
  if (!created) {
    throw new Error("Writable address book could not be reloaded");
  }

  return created;
}

async function listContactsInternal(session: NextcloudSession) {
  const books = await listAddressBooks(session);
  const contactLists = await Promise.all(
    books.map(async (book) => {
      const xml = await davReport(
        session,
        book.href,
        "1",
        `<?xml version="1.0"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag />
    <card:address-data />
  </d:prop>
</card:addressbook-query>`,
      );

      return xmlBlocks(xml, "response").map((block) => {
        const href = decodeXml(extractTagValue(block, "href"));
        const vcard = extractProp(block, "address-data");
        if (!href || !vcard) return null;
        const name = parseVcardValue(vcard, "FN") || parseVcardValue(vcard, "N") || "Unnamed contact";
        const categories = (parseVcardValue(vcard, "CATEGORIES") || "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
        const isGroupCard = parseVcardValue(vcard, "X-ADDRESSBOOKSERVER-KIND") === "group";
        const groupCategory = categories.find((c) => KNOWN_CONTACT_GROUPS.includes(c)) || null;
        const group = isGroupCard ? "Group" : (groupCategory || "All");
        // Tags are the remaining categories (everything that isn't the chosen group).
        const tags = categories.filter((c) => c !== groupCategory);

        return {
          id: hashToId(`card:${href}`),
          href,
          etag: extractProp(block, "getetag") || null,
          uid: parseVcardValue(vcard, "UID") || null,
          addressBookHref: book.href,
          name,
          email: parseVcardValue(vcard, "EMAIL"),
          phone: parseVcardValue(vcard, "TEL"),
          company: parseVcardValue(vcard, "ORG"),
          group,
          avatar: null,
          tags: toJsonString(tags),
        } satisfies ContactRecord;
      }).filter((contact): contact is ContactRecord => Boolean(contact));
    }),
  );

  return contactLists.flat().sort((a, b) => a.name.localeCompare(b.name));
}

function mapContact(record: ContactRecord) {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    company: record.company,
    group: record.group,
    avatar: null,
    tags: record.tags,
  };
}

function buildVcard(contact: {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  group?: string | null;
  tags?: string[] | null;
  uid?: string | null;
}) {
  // Preserve the existing UID on edit so the contact keeps its sync identity.
  const uid = contact.uid || randomUUID();
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${contact.name.replace(/\r?\n/g, " ").trim()}`,
    `N:${contact.name.replace(/\r?\n/g, " ").trim()};;;;`,
    `UID:${uid}`,
  ];
  if (contact.email) lines.push(`EMAIL;TYPE=INTERNET:${contact.email.replace(/\r?\n/g, "").trim()}`);
  if (contact.phone) lines.push(`TEL;TYPE=CELL:${contact.phone.replace(/\r?\n/g, " ").trim()}`);
  if (contact.company) lines.push(`ORG:${contact.company.replace(/\r?\n/g, " ").trim()}`);
  // The group is just another category (Nextcloud-native), merged with tags and de-duped.
  const categories = [
    ...(contact.group && contact.group !== "All" && contact.group !== "Group" ? [contact.group] : []),
    ...(contact.tags || []),
  ].map((c) => c.replace(/\r?\n/g, " ").trim()).filter(Boolean);
  const uniqueCategories = [...new Set(categories)];
  if (uniqueCategories.length) lines.push(`CATEGORIES:${uniqueCategories.join(",")}`);
  lines.push("END:VCARD", "");
  return lines.join("\r\n");
}

export async function listContacts(session: NextcloudSession) {
  const contacts = await listContactsInternal(session);
  return contacts.map(mapContact);
}

export async function getContact(session: NextcloudSession, contactId: number) {
  const contacts = await listContactsInternal(session);
  const contact = contacts.find((entry) => entry.id === contactId);
  return contact ? mapContact(contact) : null;
}

export async function createContact(session: NextcloudSession, input: {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  group?: string | null;
  tags?: string | string[] | null;
}) {
  const addressBook = await ensureWritableAddressBook(session);

  const tags = Array.isArray(input.tags)
    ? input.tags
    : typeof input.tags === "string"
      ? (() => {
          try {
            return JSON.parse(input.tags) as string[];
          } catch {
            return [];
          }
        })()
      : [];

  const fileName = `cloudspace-${Date.now()}.vcf`;
  const href = `${addressBook.href.replace(/\/+$/, "")}/${fileName}`;
  const response = await nextcloudFetch(session, href, {
    method: "PUT",
    headers: { "Content-Type": "text/vcard; charset=utf-8" },
    body: buildVcard({ ...input, group: input.group ?? null, tags }),
  });

  if (!response.ok) {
    throw new Error(`Creating contact failed: ${response.status}`);
  }

  const created = (await listContactsInternal(session)).find((contact) => contact.href === href);
  if (!created) {
    throw new Error("Contact was created but could not be reloaded");
  }

  return mapContact(created);
}

export async function updateContact(session: NextcloudSession, contactId: number, patch: Partial<{
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  group: string | null;
  tags: string;
}>) {
  const contacts = await listContactsInternal(session);
  const existing = contacts.find((contact) => contact.id === contactId);
  if (!existing) return null;

  let tags = [];
  if (patch.tags) {
    try {
      tags = JSON.parse(patch.tags) as string[];
    } catch {
      tags = [];
    }
  } else {
    try {
      tags = JSON.parse(existing.tags) as string[];
    } catch {
      tags = [];
    }
  }

  const response = await nextcloudFetch(session, existing.href, {
    method: "PUT",
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      ...(existing.etag ? { "If-Match": existing.etag } : {}),
    },
    body: buildVcard({
      name: patch.name ?? existing.name,
      email: patch.email ?? existing.email,
      phone: patch.phone ?? existing.phone,
      company: patch.company ?? existing.company,
      group: patch.group ?? existing.group,
      tags,
      uid: existing.uid,
    }),
  });

  if (!response.ok) {
    throw new Error(`Updating contact failed: ${response.status}`);
  }

  const refreshed = (await listContactsInternal(session)).find((contact) => contact.id === contactId);
  return refreshed ? mapContact(refreshed) : null;
}

export async function deleteContact(session: NextcloudSession, contactId: number) {
  const contacts = await listContactsInternal(session);
  const existing = contacts.find((contact) => contact.id === contactId);
  if (!existing) return false;

  const response = await nextcloudFetch(session, existing.href, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Deleting contact failed: ${response.status}`);
  }
  return true;
}

// Export every contact as a single .vcf, preserving the raw vCards (so fields we
// don't model — addresses, birthdays, photos — survive the round-trip).
export async function exportContactsVcf(session: NextcloudSession): Promise<string> {
  const books = await listAddressBooks(session);
  const cards: string[] = [];
  for (const book of books) {
    const xml = await davReport(
      session,
      book.href,
      "1",
      `<?xml version="1.0"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <card:address-data />
  </d:prop>
</card:addressbook-query>`,
    );
    for (const block of xmlBlocks(xml, "response")) {
      const vcard = extractProp(block, "address-data");
      if (vcard && /BEGIN:VCARD/i.test(vcard)) cards.push(vcard.trim());
    }
  }
  return cards.join("\r\n") + (cards.length ? "\r\n" : "");
}

// Import a .vcf blob: split into individual vCards and PUT each into the writable
// address book, preserving all fields. Returns how many were imported.
export async function importContactsVcf(session: NextcloudSession, vcardText: string): Promise<{ imported: number; failed: number }> {
  const addressBook = await ensureWritableAddressBook(session);
  const matches = vcardText.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || [];
  let imported = 0;
  let failed = 0;
  for (let i = 0; i < matches.length; i++) {
    let card = matches[i].replace(/\r?\n/g, "\r\n").trim();
    // Ensure a UID exists so re-imports stay stable.
    if (!/^UID:/im.test(card)) {
      card = card.replace(/BEGIN:VCARD/i, `BEGIN:VCARD\r\nUID:${randomUUID()}`);
    }
    const fileName = `cloudspace-import-${Date.now()}-${i}.vcf`;
    const href = `${addressBook.href.replace(/\/+$/, "")}/${fileName}`;
    try {
      const response = await nextcloudFetch(session, href, {
        method: "PUT",
        headers: { "Content-Type": "text/vcard; charset=utf-8" },
        body: card + "\r\n",
      });
      if (response.ok) imported++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { imported, failed };
}

async function ensureNotesFolder(session: NextcloudSession) {
  const response = await nextcloudFetch(session, cloudPathToDavUrl("files", session.username, NOTES_ROOT), {
    method: "MKCOL",
  });

  if (!response.ok && response.status !== 405) {
    throw new Error(`Unable to ensure Notes folder: ${response.status}`);
  }
}

async function listNotesInternal(session: NextcloudSession) {
  await ensureNotesFolder(session);
  const xml = await davPropfind(
    session,
    cloudPathToDavUrl("files", session.username, NOTES_ROOT),
    "1",
    `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname />
    <d:getlastmodified />
    <d:creationdate />
    <d:getcontenttype />
  </d:prop>
</d:propfind>`,
  );

  const currentHref = decodeURIComponent(cloudPathToDavUrl("files", session.username, NOTES_ROOT)).replace(/\/+$/, "");
  const blocks = xmlBlocks(xml, "response");
  const noteCandidates = await Promise.all(
    blocks.map(async (block) => {
      const href = decodeXml(extractTagValue(block, "href")).replace(/\/+$/, "");
      const contentType = extractProp(block, "getcontenttype");
      if (!href || href === currentHref || /collection/i.test(block) || contentType === "httpd/unix-directory") {
        return null;
      }

      const response = await nextcloudFetch(session, href, { method: "GET" });
      if (!response.ok) return null;
      const rawContent = await response.text();
      const meta = parseNoteMeta(rawContent, href);
      const content = stripNoteMetadata(rawContent);
      // Prefer the metadata title (preserves spaces/punctuation); fall back to the filename.
      const title = meta.title ?? normalizeNoteTitle(
        extractProp(block, "displayname") || href.split("/").at(-1) || "Untitled",
      );
      const updatedAt = extractProp(block, "getlastmodified")
        ? new Date(extractProp(block, "getlastmodified")).toISOString()
        : new Date().toISOString();
      const createdAt = extractProp(block, "creationdate")
        ? new Date(extractProp(block, "creationdate")).toISOString()
        : updatedAt;

      return {
        id: hashToId(`note:${meta.id}`),
        stableId: meta.id,
        href,
        title,
        content,
        tags: JSON.stringify(meta.tags),
        updatedAt,
        createdAt,
        isPinned: meta.pinned,
      } satisfies NoteRecord;
    }),
  );

  return noteCandidates.filter((note): note is NoteRecord => Boolean(note)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function mapNote(note: NoteRecord) {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    tags: note.tags,
    updatedAt: note.updatedAt,
    createdAt: note.createdAt,
    isPinned: note.isPinned,
  };
}

export async function listNotes(session: NextcloudSession) {
  const notes = await listNotesInternal(session);
  return notes.map(mapNote);
}

export async function getNote(session: NextcloudSession, noteId: number) {
  const notes = await listNotesInternal(session);
  const note = notes.find((entry) => entry.id === noteId);
  return note ? mapNote(note) : null;
}

export async function createNote(session: NextcloudSession, input: { title?: string; content?: string }) {
  await ensureNotesFolder(session);
  const fileBase = (input.title || "Untitled").trim() || "Untitled";
  const fileName = `${fileBase.replace(/[^\w.-]+/g, "-") || "note"}-${Date.now()}.md`;
  const cloudPath = joinCloudPath(NOTES_ROOT, fileName);
  const href = cloudPathToDavUrl("files", session.username, cloudPath);
  const stableId = randomUUID();
  const response = await nextcloudFetch(session, href, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
    body: serializeNoteContent({ id: stableId, title: fileBase, pinned: false, tags: [] }, input.content || ""),
  });

  if (!response.ok) {
    throw new Error(`Creating note failed: ${response.status}`);
  }

  const created = (await listNotesInternal(session)).find((note) => note.href === href);
  if (!created) {
    throw new Error("Note was created but could not be reloaded");
  }

  return mapNote(created);
}

export async function updateNote(session: NextcloudSession, noteId: number, patch: Partial<{
  title: string;
  content: string;
  isPinned: boolean;
  tags: string;
}>) {
  const notes = await listNotesInternal(session);
  const existing = notes.find((note) => note.id === noteId);
  if (!existing) return null;

  // Merge pin/tags metadata so every write (incl. content auto-save) preserves them.
  const existingTags = (() => { try { return JSON.parse(existing.tags) as string[]; } catch { return []; } })();
  const nextTags = patch.tags !== undefined
    ? (() => { try { const t = JSON.parse(patch.tags!); return Array.isArray(t) ? t.map(String) : existingTags; } catch { return existingTags; } })()
    : existingTags;
  const nextTitle = patch.title !== undefined && patch.title.trim() ? patch.title.trim() : existing.title;
  const meta: NoteMeta = {
    id: existing.stableId,
    title: nextTitle,
    pinned: patch.isPinned ?? existing.isPinned,
    tags: nextTags,
  };

  let href = existing.href;
  if (nextTitle !== existing.title) {
    // Keep the filename a sanitized, unique mirror of the title for the Files app.
    // The title itself lives in metadata, so a failed/colliding rename is non-fatal.
    const base = nextTitle.replace(/[^\w.-]+/g, "-") || "note";
    const renamedPath = joinCloudPath(NOTES_ROOT, `${base}-${Date.now()}.md`);
    const destination = `${NC_BASE_URL}${cloudPathToDavUrl("files", session.username, renamedPath)}`;
    const moveResponse = await nextcloudFetch(session, href, {
      method: "MOVE",
      headers: { Destination: destination },
    });
    if (moveResponse.ok) {
      href = cloudPathToDavUrl("files", session.username, renamedPath);
    }
    // else: keep the old href; the title is still correct via metadata.
  }

  const response = await nextcloudFetch(session, href, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
    body: serializeNoteContent(meta, patch.content ?? existing.content),
  });

  if (!response.ok) {
    throw new Error(`Updating note failed: ${response.status}`);
  }

  const refreshed = (await listNotesInternal(session)).find((note) => note.href === href);
  return refreshed ? mapNote(refreshed) : null;
}

export async function deleteNote(session: NextcloudSession, noteId: number) {
  const notes = await listNotesInternal(session);
  const existing = notes.find((note) => note.id === noteId);
  if (!existing) return false;

  const response = await nextcloudFetch(session, existing.href, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Deleting note failed: ${response.status}`);
  }
  return true;
}

// Nextcloud Deck has no native priority field, so CloudSpace persists priority as
// a reserved, color-coded Deck label ("Priority: High/Medium/Low"). These labels are
// derived back into the priority value on read and hidden from the normal label list.
const PRIORITY_LABEL_PREFIX = "Priority: ";
const PRIORITY_LABELS: Record<string, string> = {
  high: "Priority: High",
  medium: "Priority: Medium",
  low: "Priority: Low",
};
const PRIORITY_COLORS: Record<string, string> = { high: "E5484D", medium: "F5A623", low: "31CC7C" };

function priorityFromLabelTitle(title: string): string | null {
  if (!title.startsWith(PRIORITY_LABEL_PREFIX)) return null;
  const p = title.slice(PRIORITY_LABEL_PREFIX.length).trim().toLowerCase();
  return p === "high" || p === "medium" || p === "low" ? p : null;
}

function mapDeckCard(card: JsonObject, boardId: number, stackId: number, labelsById: Map<number, DeckLabel>) {
  // assignedUsers entries nest the user under `participant`: { participant: { uid, displayname } }.
  const assignedRaw = firstArrayItem((card.assignedUsers as JsonObject[] | undefined) || []);
  const assignedUser = (assignedRaw?.participant as DeckUser | undefined) || (assignedRaw as DeckUser | undefined);
  const assigneeUid = assignedUser?.uid || (assignedRaw?.participant as JsonObject | undefined)?.primaryKey || null;
  const labelTitles = Array.isArray(card.labels)
    ? (card.labels as JsonObject[]).map((label) => String(label.title || label.name || "")).filter(Boolean)
    : Array.isArray(card.labelIds)
      ? (card.labelIds as unknown[]).map((labelId) => labelsById.get(Number(labelId))?.title || "").filter(Boolean)
      : [];

  // Split the reserved priority label out of the normal labels.
  let priority = "medium";
  const normalLabels: string[] = [];
  for (const title of labelTitles) {
    const p = priorityFromLabelTitle(title);
    if (p) priority = p;
    else normalLabels.push(title);
  }

  return {
    id: Number(card.id || 0),
    stackId,
    boardId,
    title: String(card.title || "Untitled"),
    description: typeof card.description === "string" ? card.description : null,
    dueDate: card.duedate && typeof card.duedate === "string"
      ? new Date(String(card.duedate)).toISOString().slice(0, 10)
      : null,
    assignee: assigneeUid,
    priority,
    labels: JSON.stringify(normalLabels),
    order: Number(card.order || 0),
  } satisfies DeckCardRecord;
}

async function fetchDeckBoardDetail(session: NextcloudSession, boardId: number) {
  const [board, stacks] = await Promise.all([
    nextcloudJson<JsonObject>(session, `/index.php/apps/deck/api/v1.0/boards/${boardId}`),
    nextcloudJson<JsonObject[]>(session, `/index.php/apps/deck/api/v1.0/boards/${boardId}/stacks`),
  ]);

  const labelsById = new Map<number, DeckLabel>();
  if (Array.isArray(board.labels)) {
    for (const label of board.labels as JsonObject[]) {
      labelsById.set(Number(label.id || 0), {
        id: Number(label.id || 0),
        title: String(label.title || label.name || ""),
        color: typeof label.color === "string" ? label.color : undefined,
      });
    }
  }

  const mappedStacks = stacks
    .filter((stack) => !stack.deletedAt && !stack.archived)
    .map((stack) => {
      const stackId = Number(stack.id || 0);
      const cards = Array.isArray(stack.cards)
        ? (stack.cards as JsonObject[]).filter((card) => !card.archived).map((card) => mapDeckCard(card, boardId, stackId, labelsById))
        : [];

      return {
        id: stackId,
        boardId,
        title: String(stack.title || "Stack"),
        order: Number(stack.order || 0),
        cards: cards.sort((a, b) => a.order - b.order),
      } satisfies DeckStackRecord;
    })
    .sort((a, b) => a.order - b.order);

  // Assignable board members (owner + shared users). `board.users` already
  // includes the owner and any acl/group-expanded users; fall back to the owner.
  const memberSource = Array.isArray(board.users) && board.users.length
    ? (board.users as JsonObject[])
    : board.owner ? [board.owner as JsonObject] : [];
  const seenUids = new Set<string>();
  const members = memberSource
    .map((u) => ({
      uid: String(u.uid || u.primaryKey || ""),
      displayName: String(u.displayname || u.uid || u.primaryKey || ""),
    }))
    .filter((m) => m.uid && !seenUids.has(m.uid) && seenUids.add(m.uid));

  return {
    board: {
      id: Number(board.id || 0),
      title: String(board.title || "Board"),
      color: String(board.color || "#4F46E5"),
    },
    stacks: mappedStacks,
    members,
  };
}

export async function listBoards(session: NextcloudSession) {
  const boards = await nextcloudJson<JsonObject[]>(session, "/index.php/apps/deck/api/v1.0/boards");
  return boards.map((board) => ({
    id: Number(board.id || 0),
    title: String(board.title || "Board"),
    color: String(board.color || "#4F46E5"),
  }));
}

export async function getBoard(session: NextcloudSession, boardId: number) {
  return fetchDeckBoardDetail(session, boardId);
}

export async function createBoard(session: NextcloudSession, input: { title: string; color?: string }) {
  const board = await nextcloudJson<JsonObject>(session, "/index.php/apps/deck/api/v1.0/boards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      color: input.color || "#4F46E5",
    }),
  });

  return {
    id: Number(board.id || 0),
    title: String(board.title || input.title),
    color: String(board.color || input.color || "#4F46E5"),
  };
}

export async function createStack(session: NextcloudSession, boardId: number, title: string, order = 0) {
  const stack = await nextcloudJson<JsonObject>(session, `/index.php/apps/deck/api/v1.0/boards/${boardId}/stacks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, order }),
  });

  return {
    id: Number(stack.id || 0),
    boardId,
    title: String(stack.title || title),
    order: Number(stack.order || order),
  };
}

export async function updateStack(session: NextcloudSession, boardId: number, stackId: number, title: string) {
  // Deck's stack PUT requires the order too, so look up the current order first.
  const detail = await fetchDeckBoardDetail(session, boardId);
  const current = detail.stacks.find((s) => s.id === stackId);
  const stack = await nextcloudJson<JsonObject>(session, `/index.php/apps/deck/api/v1.0/boards/${boardId}/stacks/${stackId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, order: current?.order ?? 0 }),
  });
  return {
    id: Number(stack.id || stackId),
    boardId,
    title: String(stack.title || title),
    order: Number(stack.order ?? current?.order ?? 0),
  };
}

export async function deleteStack(session: NextcloudSession, boardId: number, stackId: number) {
  const response = await nextcloudFetch(session, `/index.php/apps/deck/api/v1.0/boards/${boardId}/stacks/${stackId}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Deleting deck stack failed: ${response.status}`);
  }
  return true;
}

export async function createCard(session: NextcloudSession, boardId: number, stackId: number, input: Partial<DeckCardRecord> & { title: string }) {
  const card = await nextcloudJson<JsonObject>(
    session,
    `/index.php/apps/deck/api/v1.0/boards/${boardId}/stacks/${stackId}/cards`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        description: input.description || "",
        order: input.order || 0,
      }),
    },
  );

  return mapDeckCard(card, boardId, stackId, new Map());
}

async function findCardLocation(session: NextcloudSession, cardId: number) {
  const boards = await listBoards(session);
  for (const board of boards) {
    const detail = await fetchDeckBoardDetail(session, board.id);
    for (const stack of detail.stacks) {
      const card = stack.cards.find((entry) => entry.id === cardId);
      if (card) {
        return { board: detail.board, stack, card };
      }
    }
  }
  return null;
}

export async function updateCard(session: NextcloudSession, cardId: number, patch: Partial<DeckCardRecord>) {
  const location = await findCardLocation(session, cardId);
  if (!location) return null;

  const { board, stack, card } = location;
  const labels = patch.labels ? (() => {
    try {
      return JSON.parse(patch.labels) as string[];
    } catch {
      return [];
    }
  })() : [];

  // Deck's card PUT REQUIRES `type` and `owner`; omitting them returns 400. Fetch
  // the raw card once to carry them through (and reuse it for label diffing below).
  const cardPath = `/index.php/apps/deck/api/v1.0/boards/${board.id}/stacks/${stack.id}/cards/${cardId}`;
  const rawCard = await nextcloudJson<JsonObject>(session, cardPath).catch(() => null);
  const cardType = (rawCard && typeof rawCard.type === "string" && rawCard.type) || "plain";
  const ownerRaw = rawCard?.owner as string | JsonObject | undefined;
  const ownerUid =
    (typeof ownerRaw === "string" ? ownerRaw : ownerRaw && typeof ownerRaw === "object" ? String(ownerRaw.uid || "") : "") ||
    session.username;

  const updated = await nextcloudJson<JsonObject>(
    session,
    cardPath,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: patch.title ?? card.title,
        type: cardType,
        owner: ownerUid,
        description: patch.description ?? card.description ?? "",
        order: patch.order ?? card.order,
        duedate: patch.dueDate ? new Date(patch.dueDate).toISOString() : null,
      }),
    },
  );

  if (patch.stackId && patch.stackId !== stack.id) {
    await nextcloudJson(
      session,
      `/index.php/apps/deck/api/v1.0/boards/${board.id}/stacks/${stack.id}/cards/${cardId}/reorder`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stackId: patch.stackId, order: patch.order ?? 0 }),
      },
    );
  }

  if (patch.assignee !== undefined) {
    const aPath = `/index.php/apps/deck/api/v1.0/boards/${board.id}/stacks/${patch.stackId || stack.id}/cards/${cardId}`;
    const target = patch.assignee || null;
    const currentAssignees = (Array.isArray(rawCard?.assignedUsers) ? (rawCard!.assignedUsers as JsonObject[]) : [])
      .map((a) => String((a.participant as JsonObject | undefined)?.uid || ""))
      .filter(Boolean);
    // Single-assignee model: drop anyone who isn't the target, then assign the target.
    for (const uid of currentAssignees) {
      if (uid === target) continue;
      await nextcloudJson(session, `${aPath}/unassignUser`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: uid }),
      }).catch(() => undefined);
    }
    if (target && !currentAssignees.includes(target)) {
      await nextcloudJson(session, `${aPath}/assignUser`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: target }),
      }).catch(() => undefined);
    }
  }

  // Sync the card's labels — both user labels AND the reserved priority label.
  // Runs when either labels or priority change. Creates missing board labels,
  // assigns newly-added ones, and removes dropped ones.
  if (patch.labels !== undefined || patch.priority !== undefined) {
    const rawBoard = await nextcloudJson<JsonObject>(session, `/index.php/apps/deck/api/v1.0/boards/${board.id}`).catch(() => null);
    const boardLabels = Array.isArray(rawBoard?.labels)
      ? (rawBoard!.labels as JsonObject[]).map((l) => ({ id: Number(l.id || 0), title: String(l.title || "") }))
      : [];
    const currentLabels = Array.isArray(rawCard?.labels)
      ? (rawCard!.labels as JsonObject[]).map((l) => ({ id: Number(l.id || 0), title: String(l.title || "") }))
      : [];

    // Desired normal labels: from the patch if provided, else keep the card's current normal labels.
    const desiredNormal = patch.labels !== undefined
      ? labels
      : currentLabels.map((l) => l.title).filter((t) => !priorityFromLabelTitle(t));
    // Desired priority label: from the patch if provided, else keep the existing one.
    const desiredPriorityTitle = patch.priority !== undefined
      ? (PRIORITY_LABELS[patch.priority] ?? null)
      : (currentLabels.map((l) => l.title).find((t) => priorityFromLabelTitle(t)) ?? null);

    const desired = new Set([...desiredNormal, ...(desiredPriorityTitle ? [desiredPriorityTitle] : [])]);
    const current = new Set(currentLabels.map((l) => l.title));

    for (const title of desired) {
      if (current.has(title)) continue;
      const priorityKey = priorityFromLabelTitle(title);
      let labelId = boardLabels.find((l) => l.title === title)?.id;
      if (!labelId) {
        const color = priorityKey ? PRIORITY_COLORS[priorityKey] : "31CC7C";
        const created = await nextcloudJson<JsonObject>(
          session,
          `/index.php/apps/deck/api/v1.0/boards/${board.id}/labels`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, color }) },
        ).catch(() => null);
        labelId = created ? Number(created.id || 0) : undefined;
      }
      if (labelId) {
        await nextcloudJson(session, `${cardPath}/assignLabel`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ labelId }),
        }).catch(() => undefined);
      }
    }
    for (const lbl of currentLabels) {
      if (desired.has(lbl.title)) continue;
      await nextcloudJson(session, `${cardPath}/removeLabel`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ labelId: lbl.id }),
      }).catch(() => undefined);
    }
  }

  return mapDeckCard(updated, board.id, patch.stackId || stack.id, new Map());
}

export async function deleteCard(session: NextcloudSession, cardId: number) {
  const location = await findCardLocation(session, cardId);
  if (!location) return false;

  const response = await nextcloudFetch(
    session,
    `/index.php/apps/deck/api/v1.0/boards/${location.board.id}/stacks/${location.stack.id}/cards/${cardId}`,
    { method: "DELETE" },
  );

  if (!response.ok && response.status !== 404) {
    throw new Error(`Deleting deck card failed: ${response.status}`);
  }
  return true;
}

async function listMailAccounts(session: NextcloudSession) {
  return nextcloudJson<MailAccount[]>(session, "/index.php/apps/mail/api/accounts");
}

function isMailNotReadyError(error: unknown) {
  return error instanceof Error && /Nextcloud JSON request failed: 412 /.test(error.message);
}

async function listMailAccountsSafe(session: NextcloudSession) {
  try {
    return await listMailAccounts(session);
  } catch (error) {
    if (isMailNotReadyError(error)) {
      return [];
    }
    throw error;
  }
}

async function listMailboxes(session: NextcloudSession, accountId: number) {
  return nextcloudJson<{
    id: number;
    email?: string;
    mailboxes?: Mailbox[];
  }>(session, `/index.php/apps/mail/api/mailboxes?accountId=${accountId}`);
}

function normalizeFolderKey(mailbox: Mailbox) {
  const special = String(mailbox.specialRole || "").toLowerCase();
  const name = String(mailbox.name || "").toLowerCase();
  if (special.includes("sent") || name.includes("sent")) return "sent";
  if (special.includes("draft") || name.includes("draft")) return "drafts";
  if (special.includes("spam") || name.includes("junk") || name.includes("spam")) return "spam";
  if (special.includes("trash") || name.includes("trash") || name.includes("bin")) return "trash";
  if (special.includes("archive") || name.includes("archive")) return "archive";
  return "inbox";
}

async function findMailboxForFolder(session: NextcloudSession, folder: string) {
  const accounts = await listMailAccountsSafe(session);
  for (const account of accounts) {
    const mailboxResponse = await listMailboxes(session, account.accountId);
    const mailboxes = mailboxResponse.mailboxes || [];
    const exact = mailboxes.find((mailbox) => normalizeFolderKey(mailbox) === folder);
    if (exact) {
      return { account, mailbox: exact };
    }
  }
  return null;
}

async function listMailMessages(session: NextcloudSession, mailboxId: number) {
  return nextcloudJson<JsonObject[]>(
    session,
    `/index.php/apps/mail/api/messages?mailboxId=${mailboxId}&limit=100`,
  );
}

function mapMailMessage(message: JsonObject, folder: string, body: string) {
  const fromValue = String(message.from || message.fromAddress || "");
  const toValue = Array.isArray(message.to)
    ? (message.to as JsonObject[]).map((entry) => String(entry.label || entry.email || "")).join(", ")
    : String(message.to || "");

  return {
    id: Number(message.id || 0),
    folder,
    from: parseMailDisplayName(fromValue) || String(message.sender || "Unknown"),
    fromEmail: extractEmailFromMailField(fromValue) || "",
    to: toValue,
    subject: String(message.subject || "(no subject)"),
    preview: String(message.previewText || message.snippet || ""),
    body,
    receivedAt: message.dateInt ? new Date(Number(message.dateInt) * 1000).toISOString() : new Date().toISOString(),
    isRead: Boolean(message.seen),
    isStarred: Boolean(message.flagged),
    hasAttachment: Boolean(message.hasAttachments),
  } satisfies CloudMailMessage;
}

export async function listEmails(session: NextcloudSession, folder: string) {
  if (folder === "drafts") {
    const drafts = await nextcloudJson<{ data?: JsonObject[]; ocs?: { data?: JsonObject[] } } | JsonObject[]>(
      session,
      "/index.php/apps/mail/api/drafts",
    ).catch(() => []);
    const items = Array.isArray(drafts) ? drafts : Array.isArray((drafts as JsonObject).data) ? ((drafts as JsonObject).data as JsonObject[]) : [];
    return items.map((draft) =>
      mapMailMessage(
        {
          id: draft.id,
          from: "",
          to: draft.to || [],
          subject: draft.subject,
          previewText: draft.body,
          dateInt: draft.updatedAt,
          seen: true,
          flagged: false,
          hasAttachments: Array.isArray(draft.attachments) && (draft.attachments as unknown[]).length > 0,
        },
        "drafts",
        String(draft.body || draft.editorBody || ""),
      ),
    );
  }

  const mapping = await findMailboxForFolder(session, folder);
  if (!mapping) return [];

  const messages = await listMailMessages(session, mapping.mailbox.id);
  const bodies = await Promise.all(
    messages.map(async (message) => {
      const bodyPayload = await nextcloudJsonMaybe<JsonObject>(session, `/index.php/apps/mail/api/messages/${Number(message.id || 0)}/body`);
      const body = bodyPayload ? String(bodyPayload.body || bodyPayload.text || bodyPayload.html || "") : "";
      return mapMailMessage(message, folder, body);
    }),
  );

  return bodies.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export async function getEmail(session: NextcloudSession, emailId: number) {
  const message = await nextcloudJsonMaybe<JsonObject>(session, `/index.php/apps/mail/api/messages/${emailId}`);
  if (!message) return null;
  const bodyPayload = await nextcloudJsonMaybe<JsonObject>(session, `/index.php/apps/mail/api/messages/${emailId}/body`);

  const mailboxId = Number(message.mailboxId || 0);
  let folder = "inbox";
  if (mailboxId) {
    const accounts = await listMailAccountsSafe(session);
    for (const account of accounts) {
      const mailboxResponse = await listMailboxes(session, account.accountId);
      const mailbox = (mailboxResponse.mailboxes || []).find((entry) => entry.id === mailboxId);
      if (mailbox) {
        folder = normalizeFolderKey(mailbox);
        break;
      }
    }
  }

  return mapMailMessage(message, folder, bodyPayload ? String(bodyPayload.body || bodyPayload.text || bodyPayload.html || "") : "");
}

export async function getEmailCounts(session: NextcloudSession) {
  const accounts = await listMailAccountsSafe(session).catch(() => []);
  let inbox = 0;
  let drafts = 0;
  let spam = 0;

  for (const account of accounts) {
    const mailboxResponse = await listMailboxes(session, account.accountId).catch(() => ({ mailboxes: [] as Mailbox[] }));
    for (const mailbox of mailboxResponse.mailboxes || []) {
      const folder = normalizeFolderKey(mailbox);
      if (folder === "inbox") inbox += Number(mailbox.unseen || mailbox.total || 0);
      if (folder === "drafts") drafts += Number(mailbox.total || 0);
      if (folder === "spam") spam += Number(mailbox.unseen || mailbox.total || 0);
    }
  }

  return { inbox, drafts, spam };
}

function toRecipientList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((email) => ({ label: email, email }));
}

export async function createEmail(session: NextcloudSession, input: {
  folder: string;
  subject: string;
  body: string;
  to: string;
  cc?: string;
  bcc?: string;
}) {
  const accounts = await listMailAccountsSafe(session);
  const account = firstArrayItem(accounts);
  if (!account) {
    throw new Error("Nextcloud Mail has no configured account for this user");
  }

  const recipients = toRecipientList(input.to);
  const ccList = toRecipientList(input.cc);
  const bccList = toRecipientList(input.bcc);

  if (input.folder === "drafts") {
    const draft = await nextcloudJson<JsonObject>(session, "/index.php/apps/mail/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.accountId,
        subject: input.subject,
        body: input.body,
        editorBody: input.body,
        isHtml: false,
        smimeSign: false,
        smimeEncrypt: false,
        to: recipients,
        cc: ccList,
        bcc: bccList,
        attachments: [],
      }),
    });

    return mapMailMessage(
      {
        id: draft.id,
        subject: draft.subject,
        to: draft.to || recipients,
        previewText: input.body.slice(0, 100),
        dateInt: Math.floor(Date.now() / 1000),
        seen: true,
        flagged: false,
        hasAttachments: false,
      },
      "drafts",
      input.body,
    );
  }

  const outbox = await nextcloudJson<JsonObject>(session, "/index.php/apps/mail/api/outbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: account.accountId,
      subject: input.subject,
      body: input.body,
      editorBody: input.body,
      isHtml: false,
      smimeSign: false,
      smimeEncrypt: false,
      to: recipients,
      cc: ccList,
      bcc: bccList,
      attachments: [],
    }),
  });

  const outboxId = Number(outbox.id || 0);
  if (outboxId) {
    await nextcloudJson(session, `/index.php/apps/mail/api/outbox/${outboxId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  }

  return {
    id: outboxId || hashToId(`mail:${Date.now()}`),
    folder: "sent",
    from: account.name || session.username,
    fromEmail: account.emailAddress || account.email || "",
    to: input.to,
    subject: input.subject,
    preview: input.body.slice(0, 100),
    body: input.body,
    receivedAt: new Date().toISOString(),
    isRead: true,
    isStarred: false,
    hasAttachment: false,
  } satisfies CloudMailMessage;
}

export async function updateEmail(session: NextcloudSession, emailId: number, patch: Partial<{
  isRead: boolean;
  isStarred: boolean;
}>) {
  const body: Record<string, boolean> = {};
  if (typeof patch.isRead === "boolean") body.seen = patch.isRead;
  if (typeof patch.isStarred === "boolean") body.flagged = patch.isStarred;
  if (Object.keys(body).length === 0) {
    return getEmail(session, emailId);
  }

  await nextcloudJson(
    session,
    `/index.php/apps/mail/api/messages/${emailId}/flags`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  return getEmail(session, emailId);
}

export async function deleteEmail(session: NextcloudSession, emailId: number) {
  const response = await nextcloudFetch(session, `/index.php/apps/mail/api/thread/${emailId}`, {
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Deleting email failed: ${response.status}`);
  }
  return true;
}

// Move a message to another folder (real Nextcloud Mail move). The message id
// changes after a move, so callers should treat the prior id as stale.
// NOTE: not live-verified — needs an IMAP account configured on Nextcloud Mail.
export async function moveEmail(session: NextcloudSession, emailId: number, folder: string) {
  const target = await findMailboxForFolder(session, folder);
  if (!target) {
    throw new Error(`No Nextcloud Mail mailbox found for folder "${folder}"`);
  }
  await nextcloudJson(session, `/index.php/apps/mail/api/messages/${emailId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destMailboxId: target.mailbox.id }),
  });
  return { success: true };
}
