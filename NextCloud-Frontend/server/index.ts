import "./load-env";
import express from "express";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { storage } from "./storage";
import {
  bootstrapDelegatedSession,
  revokeDelegatedCredential,
} from "./credential-provider";
import { establishNextcloudWebSession } from "./nextcloud-web-session";
import {
  type CloudMediaFile,
  createFolder,
  createPublicShareLink,
  deleteFile,
  downloadFile,
  getFile,
  getCurrentUser,
  getDashboardData,
  listMediaFiles,
  listFiles,
  searchUsers,
  uploadFile,
} from "./nextcloud-client";
import {
  addConversationParticipant,
  removeConversationParticipant,
  createBoard,
  createCard,
  createContact,
  createConversation,
  createEmail,
  createEvent,
  createNote,
  createStack,
  deleteCard,
  deleteContact,
  deleteConversation,
  deleteEmail,
  deleteEvent,
  deleteNote,
  getBoard,
  getContact,
  getConversation,
  getEmail,
  getEmailCounts,
  getEvent,
  getNote,
  leaveConversation,
  listContacts,
  listConversationMessages,
  listConversationParticipants,
  listConversations,
  listEmails,
  listEvents,
  listNotes,
  listBoards,
  getTalkSignalingSettings,
  joinNativeTalkCall,
  leaveNativeTalkCall,
  markConversationParticipantActive,
  markConversationRead,
  sendConversationMessage,
  setConversationModerator,
  setConversationMute,
  updateNativeTalkCallFlags,
  updateCard,
  updateContact,
  updateEmail,
  updateEvent,
  updateNote,
} from "./groupware-client";
import {
  clearNextcloudSession,
  createNextcloudSession,
  getNextcloudSession,
  updateNextcloudSession,
} from "./session-store";
import { getCapabilities } from "./capability-store";

const app = express();
app.use(express.json());

const ALLOW_MOCK_SERVICES = process.env.ALLOW_MOCK_SERVICES === "true";

type ConversationCallState = {
  conversationId: number;
  type: "voice" | "video" | "screen";
  initiatorName: string;
  initiatorUsername: string;
  active: boolean;
  isScreenSharing: boolean;
  startedAt: string;
  updatedAt: string;
  participants: Array<{
    username: string;
    displayName: string;
    status: "ringing" | "joined" | "declined" | "left";
    joinedAt: string | null;
  }>;
  signals: Array<{
    id: string;
    kind: "offer" | "answer" | "ice";
    from: string;
    to: string;
    createdAt: string;
    payload: {
      type?: string;
      sdp?: string;
      candidate?: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
      usernameFragment?: string | null;
    };
  }>;
  nativeSessionId?: string | null;
  nativeAvailable: boolean;
  nativeSignalingMode: string;
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
};

const conversationCalls = new Map<number, ConversationCallState>();

// ——— In-memory typing indicator store ———
// Maps conversationId -> Map<username, { displayName, expiresAt }>
const typingIndicators = new Map<number, Map<string, { displayName: string; expiresAt: number }>>();

function setTyping(conversationId: number, username: string, displayName: string) {
  if (!typingIndicators.has(conversationId)) {
    typingIndicators.set(conversationId, new Map());
  }
  // Typing expires after 5 seconds
  typingIndicators.get(conversationId)!.set(username, {
    displayName,
    expiresAt: Date.now() + 5000,
  });
}

function getTypingUsers(conversationId: number, excludeUsername?: string): Array<{ username: string; displayName: string }> {
  const map = typingIndicators.get(conversationId);
  if (!map) return [];
  const now = Date.now();
  const result: Array<{ username: string; displayName: string }> = [];
  for (const [username, entry] of map) {
    if (entry.expiresAt < now) {
      map.delete(username);
      continue;
    }
    if (username !== excludeUsername) {
      result.push({ username, displayName: entry.displayName });
    }
  }
  return result;
}

function createCallSignalId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toNativeCallFlags(type: "voice" | "video" | "screen") {
  const IN_CALL = 1;
  const AUDIO = 2;
  const VIDEO = 4;

  if (type === "voice") {
    return IN_CALL | AUDIO;
  }

  return IN_CALL | AUDIO | VIDEO;
}

import { createHmac } from "node:crypto";

const TURN_URL = process.env.TURN_SERVER_URL || "";
const TURN_SECRET = process.env.TURN_SECRET || "";

/** Generate time-limited TURN REST API credentials (RFC 7635 / coturn --use-auth-secret) */
function generateTurnCredentials(username: string) {
  if (!TURN_URL || !TURN_SECRET) return null;
  // Credential expires in 24 hours
  const expiry = Math.floor(Date.now() / 1000) + 86400;
  const turnUsername = `${expiry}:${username}`;
  const turnCredential = createHmac("sha1", TURN_SECRET).update(turnUsername).digest("base64");
  return {
    urls: [TURN_URL, TURN_URL.replace("turn:", "turns:")].filter(Boolean),
    username: turnUsername,
    credential: turnCredential,
  };
}

function buildFallbackIceServers(username = "cloudspace") {
  const servers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: "stun:stun.l.google.com:19302" },
  ];
  const turnCreds = generateTurnCredentials(username);
  if (turnCreds) servers.push(turnCreds);
  return servers;
}

function toIceServers(settings: Awaited<ReturnType<typeof getTalkSignalingSettings>>, username = "cloudspace") {
  if (!settings) return buildFallbackIceServers(username);
  const combined = [...settings.stunServers, ...settings.turnServers].filter(
    (server) => Array.isArray(server.urls) ? server.urls.length > 0 : Boolean(server.urls),
  );
  return combined.length > 0 ? combined : buildFallbackIceServers(username);
}

function dedupeSignals(signals: ConversationCallState["signals"]) {
  return signals.slice(-500);
}

async function syncConversationCallParticipants(
  session: NonNullable<ReturnType<typeof getNextcloudSession>>,
  call: ConversationCallState,
) {
  const records = await listConversationParticipants(session, call.conversationId);
  const nextParticipants = new Map(
    call.participants.map((participant) => [participant.username, participant]),
  );

  for (const record of records) {
    if (record.actorType !== "users") continue;
    const existing = nextParticipants.get(record.actorId);
    // IMPORTANT: Once the adapter marks a user as "left" or "declined",
    // never override back to "joined" from Nextcloud session data.
    // Nextcloud sessions persist after users leave the custom call.
    const adapterSaysGone = existing?.status === "left" || existing?.status === "declined";
    const status = adapterSaysGone
      ? existing.status
      : record.sessionIds.length > 0
        ? "joined"
        : existing?.status === "joined"
          ? "joined"
          : record.actorId === call.initiatorUsername
            ? "joined"
            : "ringing";
    if (existing) {
      nextParticipants.set(record.actorId, {
        ...existing,
        displayName: record.displayName || existing.displayName,
        status,
        joinedAt: status === "joined" ? existing.joinedAt || call.startedAt : null,
      });
      continue;
    }

    nextParticipants.set(record.actorId, {
      username: record.actorId,
      displayName: record.displayName || record.actorId,
      status,
      joinedAt: status === "joined" ? call.startedAt : null,
    });
  }

  call.participants = Array.from(nextParticipants.values());
  call.updatedAt = new Date().toISOString();
  conversationCalls.set(call.conversationId, call);
  return call;
}

function requireNextcloudSession(req: express.Request, res: express.Response) {
  const session = getNextcloudSession(req);
  if (!session) {
    res.status(401).json({ ok: false, message: "Please sign in to Nextcloud." });
    return null;
  }
  return session;
}

async function requireCapability(
  session: NonNullable<ReturnType<typeof getNextcloudSession>>,
  res: express.Response,
  feature: "talk" | "deck" | "calendar" | "contacts" | "notes" | "mail" | "activity",
) {
  const snapshot = await getCapabilities(session);
  if (!snapshot.capabilities[feature]) {
    res.status(404).json({
      error: "This feature is not available on the connected Nextcloud instance.",
      code: "feature_unavailable",
      feature,
    });
    return false;
  }

  return true;
}

function blockMockRoutes(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (ALLOW_MOCK_SERVICES) {
    next();
    return;
  }

  res.status(501).json({
    ok: false,
    error: "This endpoint still uses mock data and is disabled until it is wired to Nextcloud.",
    code: "feature_unavailable",
  });
}

// Activity routes use local storage — no longer blocked since the Nextcloud activity app is installed
// app.use(/^\/api\/(activity|activities)(?:\/.*)?$/, blockMockRoutes);

// Auth
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ ok: false, message: "Username/email and password are required." });
  }

  try {
    const { session, user } = await bootstrapDelegatedSession(email, password);
    const webSession = await establishNextcloudWebSession(user.username, password).catch(() => undefined);
    createNextcloudSession(res, {
      ...session,
      webSession,
    });
    res.json({ ok: true, user });
  } catch {
    res.status(401).json({ ok: false, message: "Invalid Nextcloud credentials." });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const session = getNextcloudSession(req);
  if (session) {
    try {
      await revokeDelegatedCredential(session);
    } catch {
      // Keep local logout resilient even if remote token revocation fails.
    }
  }

  clearNextcloudSession(req, res);
  res.json({ ok: true });
});

app.get("/api/auth/session", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  try {
    const user = await getCurrentUser(session);
    res.json({ ok: true, user });
  } catch {
    clearNextcloudSession(req, res);
    res.status(401).json({ ok: false, message: "Nextcloud session expired." });
  }
});

app.get("/api/capabilities", async (req, res) => {
  const session = getNextcloudSession(req);
  const snapshot = await getCapabilities(session || undefined);

  res.json({
    ...snapshot.capabilities,
    source: snapshot.source,
    checkedAt: snapshot.checkedAt,
    apps: snapshot.apps,
  });
});

// User
app.get("/api/user", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  try {
    const user = await getCurrentUser(session);
    res.json({ data: user });
  } catch {
    res.status(502).json({ error: "Unable to load user from Nextcloud." });
  }
});

app.patch("/api/user", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  const nextName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!nextName) {
    return res.status(400).json({ error: "Display name is required." });
  }

  updateNextcloudSession(req, { displayNameOverride: nextName });

  try {
    const user = await getCurrentUser(getNextcloudSession(req) || session);
    res.json({ data: user });
  } catch {
    res.status(502).json({ error: "Unable to update user profile." });
  }
});

// Dashboard aggregate
app.get("/api/dashboard", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  try {
    const data = await getDashboardData(session, { includeMockData: ALLOW_MOCK_SERVICES });
    res.json({ data });
  } catch {
    res.status(502).json({ error: "Unable to load dashboard data from Nextcloud." });
  }
});

// Files
app.get("/api/files", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  const parentPath = (req.query.path as string) || "/";
  try {
    const files = await listFiles(session, parentPath);
    res.json({ data: files });
  } catch {
    res.status(502).json({ error: "Unable to load files from Nextcloud." });
  }
});

// Simple file download by path (used by Talk attachment bubbles) — must be before :id route
app.get("/api/files/download", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  const cloudPath = typeof req.query.path === "string" ? req.query.path : "";
  if (!cloudPath) {
    return res.status(400).json({ error: "File path is required." });
  }

  try {
    const file = await downloadFile(session, cloudPath);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.name)}"`);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(file.buffer);
  } catch {
    res.status(502).json({ error: "Unable to download file from Nextcloud." });
  }
});

// Proxy endpoint for downloading files via public share token — works for any
// authenticated user, not just the file owner.  The client sends the Nextcloud
// share URL; we extract the token and fetch the file from Nextcloud on the
// server side, avoiding CORS and mixed-content issues.
app.get("/api/files/share-download", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  const shareUrl = typeof req.query.url === "string" ? req.query.url : "";
  // Extract the share token from URLs like http://host/s/TOKEN or http://host/index.php/s/TOKEN
  const tokenMatch = shareUrl.match(/\/s\/([A-Za-z0-9]+)/);
  if (!tokenMatch) {
    return res.status(400).json({ error: "Invalid share URL." });
  }
  const token = tokenMatch[1];
  const NC_BASE_URL = process.env.NC_BASE_URL || "http://localhost:8090";

  try {
    const downloadRes = await fetch(`${NC_BASE_URL}/s/${token}/download`, {
      redirect: "follow",
    });
    if (!downloadRes.ok) {
      return res.status(downloadRes.status).json({ error: "Share download failed." });
    }
    const contentType = downloadRes.headers.get("content-type") || "application/octet-stream";
    const disposition = downloadRes.headers.get("content-disposition");
    res.setHeader("Content-Type", contentType);
    if (disposition) res.setHeader("Content-Disposition", disposition);
    res.setHeader("Cache-Control", "public, max-age=3600");
    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    res.send(buffer);
  } catch {
    res.status(502).json({ error: "Unable to download shared file from Nextcloud." });
  }
});

app.get("/api/files/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  const cloudPath = typeof req.query.path === "string" ? req.query.path : "";
  if (!cloudPath) {
    return res.status(400).json({ error: "File path is required." });
  }

  try {
    if (req.query.download === "1") {
      const file = await downloadFile(session, cloudPath);
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
      res.send(file.buffer);
      return;
    }

    const file = await getFile(session, cloudPath);
    if (!file) return res.status(404).json({ error: "Not found" });
    res.json({ data: file });
  } catch {
    res.status(502).json({ error: "Unable to load file from Nextcloud." });
  }
});

app.get("/api/media", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  const rootPath = typeof req.query.path === "string" ? req.query.path : "/";
  try {
    const media = await listMediaFiles(session, { rootPath, maxDepth: 5, limit: 400 });
    res.json({ data: media satisfies CloudMediaFile[] });
  } catch {
    res.status(502).json({ error: "Unable to load media from Nextcloud." });
  }
});

app.get("/api/users/search", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";

  try {
    const users = await searchUsers(session, query);
    res.json({
      data: users.filter((user) => user.username !== session.username),
    });
  } catch {
    res.status(502).json({ error: "Unable to load Nextcloud users." });
  }
});

app.post("/api/files", express.raw({ type: "application/octet-stream", limit: "100mb" }), async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  const headerContentType = Array.isArray(req.headers["content-type"])
    ? req.headers["content-type"][0] ?? ""
    : req.headers["content-type"] ?? "";
  const fileName = typeof req.headers["x-file-name"] === "string" ? req.headers["x-file-name"] : "";
  const uploadParentPath = typeof req.headers["x-parent-path"] === "string" ? req.headers["x-parent-path"] : "/";
  const uploadContentType =
    typeof req.headers["x-file-content-type"] === "string" ? req.headers["x-file-content-type"] : "application/octet-stream";
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  const isBinaryUpload =
    Boolean(fileName) ||
    Boolean(rawBody) ||
    (typeof headerContentType === "string" && headerContentType.startsWith("application/octet-stream"));

  if (isBinaryUpload) {
    if (!fileName || !rawBody) {
      return res.status(400).json({ error: "Upload file name and content are required." });
    }

    try {
      const file = await uploadFile(session, uploadParentPath, fileName, rawBody, uploadContentType);
      // For Talk uploads, create a public share link so other users can download
      let shareLink: string | null = null;
      if (uploadParentPath.startsWith("/Talk Uploads")) {
        shareLink = await createPublicShareLink(session, file.path).catch(() => null);
      }
      res.json({ data: { ...file, shareLink } });
    } catch {
      res.status(502).json({ error: "Unable to upload file to Nextcloud." });
    }
    return;
  }

  const requestBody = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const { name, type = "folder", parentPath: folderParentPath = "/" } = requestBody as {
    name?: string;
    type?: string;
    parentPath?: string;
  };
  if (type !== "folder") {
    return res.status(400).json({ error: "Unsupported file operation." });
  }

  try {
    const file = await createFolder(session, folderParentPath, name);
    res.json({ data: file });
  } catch {
    res.status(502).json({ error: "Unable to create folder in Nextcloud." });
  }
});

app.patch("/api/files/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = storage.getFile(id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const updated = storage.updateFile(id, req.body);
  res.json({ data: updated });
});

app.delete("/api/files/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  const cloudPath = typeof req.query.path === "string" ? req.query.path : "";
  if (!cloudPath) {
    return res.status(400).json({ error: "File path is required." });
  }

  try {
    const result = await deleteFile(session, cloudPath);
    res.json({ data: result });
  } catch {
    res.status(502).json({ error: "Unable to delete file from Nextcloud." });
  }
});

// Conversations
app.get("/api/conversations", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    res.json({ data: await listConversations(session) });
  } catch {
    res.status(502).json({ error: "Unable to load conversations from Nextcloud Talk." });
  }
});
app.get("/api/conversations/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    const conversation = await getConversation(session, Number(req.params.id));
    if (!conversation) return res.status(404).json({ error: "Not found" });
    res.json({ data: conversation });
  } catch {
    res.status(502).json({ error: "Unable to load conversation from Nextcloud Talk." });
  }
});
app.get("/api/conversations/:id/participants", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    res.json({ data: await listConversationParticipants(session, Number(req.params.id)) });
  } catch {
    res.status(502).json({ error: "Unable to load conversation participants from Nextcloud Talk." });
  }
});

// ——— Typing indicators ———
app.post("/api/conversations/:id/typing", (req, res) => {
  const session = getNextcloudSession(req);
  if (!session) return res.status(401).json({ error: "Not authenticated." });

  const conversationId = Number(req.params.id);
  const username = session.username;
  const displayName = session.displayNameOverride || session.username;
  setTyping(conversationId, username, displayName);
  res.json({ ok: true });
});

app.get("/api/conversations/:id/typing", (req, res) => {
  const session = getNextcloudSession(req);
  if (!session) return res.status(401).json({ error: "Not authenticated." });

  const conversationId = Number(req.params.id);
  const typingUsers = getTypingUsers(conversationId, session.username);
  res.json({ data: typingUsers });
});

app.post("/api/conversations", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    const memberUsernames = Array.isArray(req.body?.memberUsernames)
      ? req.body.memberUsernames.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const conversation = await createConversation(session, {
      name: req.body?.name || "New conversation",
      type: req.body?.type || "group",
      inviteUsername: typeof req.body?.inviteUsername === "string" ? req.body.inviteUsername : undefined,
      memberUsernames,
    });
    res.json({ data: conversation });
  } catch {
    res.status(502).json({ error: "Unable to create conversation in Nextcloud Talk." });
  }
});
app.post("/api/conversations/:id/participants", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (!username) {
    return res.status(400).json({ error: "Participant username is required." });
  }

  try {
    const participants = await addConversationParticipant(session, Number(req.params.id), username);
    if (!participants) return res.status(404).json({ error: "Conversation not found." });
    res.json({ data: participants });
  } catch {
    res.status(502).json({ error: "Unable to add participant to Nextcloud Talk conversation." });
  }
});
app.patch("/api/conversations/:id/read", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    const success = await markConversationRead(session, Number(req.params.id));
    res.json({ data: { success } });
  } catch {
    res.status(502).json({ error: "Unable to mark conversation as read." });
  }
});
app.patch("/api/conversations/:id/mute", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    const updated = await setConversationMute(session, Number(req.params.id), Boolean(req.body?.muted));
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ data: updated });
  } catch {
    res.status(502).json({ error: "Unable to update conversation notification level." });
  }
});
app.patch("/api/conversations/:id/admin", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    const updated = await setConversationModerator(session, Number(req.params.id), Number(req.body?.adminId));
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ data: updated });
  } catch {
    res.status(502).json({ error: "Unable to update conversation moderator." });
  }
});
app.delete("/api/conversations/:id/members/me", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    const success = await leaveConversation(session, Number(req.params.id));
    res.json({ data: { success } });
  } catch {
    res.status(502).json({ error: "Unable to leave conversation." });
  }
});
app.delete("/api/conversations/:id/members/:attendeeId", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    const result = await removeConversationParticipant(session, Number(req.params.id), Number(req.params.attendeeId));
    res.json({ data: { success: true, participants: result } });
  } catch {
    res.status(502).json({ error: "Unable to remove member from conversation." });
  }
});
app.delete("/api/conversations/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    const success = await deleteConversation(session, Number(req.params.id));
    res.json({ data: { success } });
  } catch {
    res.status(502).json({ error: "Unable to delete conversation." });
  }
});

// Messages
app.get("/api/conversations/:id/messages", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    res.json({ data: await listConversationMessages(session, Number(req.params.id)) });
  } catch {
    res.status(502).json({ error: "Unable to load messages from Nextcloud Talk." });
  }
});
app.post("/api/conversations/:id/messages", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  try {
    const message = await sendConversationMessage(session, Number(req.params.id), String(req.body?.content || ""));
    res.json({ data: message });
  } catch {
    res.status(502).json({ error: "Unable to send message to Nextcloud Talk." });
  }
});

// Call signaling
app.get("/api/conversations/:id/call", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  const conversationId = Number(req.params.id);
  const existing = conversationCalls.get(conversationId) || null;
  if (!existing) {
    res.json({ data: null });
    return;
  }

  // Clean up stale calls — if no one is joined, remove and return null
  const stillJoined = existing.participants.filter((p) => p.status === "joined");
  if (stillJoined.length === 0) {
    conversationCalls.delete(conversationId);
    res.json({ data: null });
    return;
  }

  try {
    const call = await syncConversationCallParticipants(session, existing);

    // Re-check after sync — native Nextcloud may have cleared participants
    const stillJoinedAfterSync = call.participants.filter((p) => p.status === "joined");
    if (stillJoinedAfterSync.length === 0) {
      conversationCalls.delete(conversationId);
      res.json({ data: null });
      return;
    }

    const signaling = await getTalkSignalingSettings(session, conversationId).catch(() => null);
    call.nativeSignalingMode = signaling?.mode || "internal";
    call.iceServers = toIceServers(signaling, session.username);
    res.json({ data: call });
  } catch {
    res.status(502).json({ error: "Unable to load call state from Nextcloud Talk." });
  }
});

app.post("/api/conversations/:id/call/start", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  const conversationId = Number(req.params.id);
  const now = new Date().toISOString();
  const type = req.body.type as "voice" | "video" | "screen";
  const initiatorName = (req.body.initiatorName as string) || session.username;

  try {
    await markConversationParticipantActive(session, conversationId).catch(() => false);
    const conversationParticipants = await listConversationParticipants(session, conversationId);
    const userParticipants = conversationParticipants.filter((participant) => participant.actorType === "users");
    if (userParticipants.length < 2) {
      return res.status(409).json({ error: "This conversation does not support calls." });
    }
    const signaling = await getTalkSignalingSettings(session, conversationId).catch(() => null);
    const nativeJoin = await joinNativeTalkCall(session, conversationId, toNativeCallFlags(type)).catch(() => null);
    if (!nativeJoin) {
      return res.status(502).json({ error: "Unable to join the native Nextcloud Talk call." });
    }
    const next: ConversationCallState = {
      conversationId,
      type,
      initiatorName,
      initiatorUsername: session.username,
      active: true,
      isScreenSharing: type === "screen",
      startedAt: now,
      updatedAt: now,
      participants: userParticipants
        .map((participant) => ({
          username: participant.actorId,
          displayName: participant.displayName || participant.actorId,
          // Only the initiator starts as "joined" — everyone else starts as
          // "ringing" until they explicitly accept the call.  Previously we
          // checked sessionIds.length > 0 which caused users with an active
          // Nextcloud web session to appear "joined" immediately, preventing
          // the ringing timeout from ever firing.
          status:
            participant.actorId === session.username
              ? "joined"
              : "ringing",
          joinedAt:
            participant.actorId === session.username
              ? now
              : null,
        })),
      signals: [],
      nativeSessionId: nativeJoin?.sessionId ?? null,
      nativeAvailable: Boolean(nativeJoin),
      nativeSignalingMode: signaling?.mode || "internal",
      iceServers: toIceServers(signaling),
    };
    conversationCalls.set(conversationId, next);
    res.json({ data: next });
  } catch {
    res.status(502).json({ error: "Unable to start call for this conversation." });
  }
});

app.post("/api/conversations/:id/call/accept", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  const conversationId = Number(req.params.id);
  const existing = conversationCalls.get(conversationId);
  if (!existing || !existing.active) return res.status(404).json({ error: "No active call" });

  await markConversationParticipantActive(session, conversationId).catch(() => false);
  const nativeJoin = await joinNativeTalkCall(session, conversationId, toNativeCallFlags(existing.type)).catch(() => null);
  if (!nativeJoin) {
    return res.status(502).json({ error: "Unable to join the native Nextcloud Talk call." });
  }
  const signaling = await getTalkSignalingSettings(session, conversationId).catch(() => null);
  const current = await syncConversationCallParticipants(session, existing);
  current.participants = current.participants.map((participant) =>
    participant.username === session.username
      ? {
          ...participant,
          status: "joined",
          joinedAt: participant.joinedAt || new Date().toISOString(),
        }
      : participant,
  );
  current.updatedAt = new Date().toISOString();
  current.nativeSessionId = nativeJoin?.sessionId ?? current.nativeSessionId ?? null;
  current.nativeAvailable = current.nativeAvailable || Boolean(nativeJoin);
  current.nativeSignalingMode = signaling?.mode || current.nativeSignalingMode || "internal";
  current.iceServers = toIceServers(signaling);
  conversationCalls.set(conversationId, current);
  res.json({ data: current });
});

app.post("/api/conversations/:id/call/decline", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  const conversationId = Number(req.params.id);
  const existing = conversationCalls.get(conversationId);
  if (!existing || !existing.active) return res.status(404).json({ error: "No active call" });

  const current = await syncConversationCallParticipants(session, existing);
  current.participants = current.participants.map((participant) =>
    participant.username === session.username
      ? {
          ...participant,
          status: "declined",
          joinedAt: null,
        }
      : participant,
  );
  current.updatedAt = new Date().toISOString();
  conversationCalls.set(conversationId, current);
  res.json({ data: current });
});

app.patch("/api/conversations/:id/call", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  const conversationId = Number(req.params.id);
  const existing = conversationCalls.get(conversationId);
  if (!existing || !existing.active) return res.status(404).json({ error: "No active call" });

  const current = await syncConversationCallParticipants(session, existing);

  if (typeof req.body.isScreenSharing === "boolean") {
    current.isScreenSharing = req.body.isScreenSharing;
    if (current.nativeAvailable) {
      await updateNativeTalkCallFlags(
        session,
        conversationId,
        toNativeCallFlags(req.body.isScreenSharing ? "screen" : current.type),
      ).catch(() => null);
    }
  }

  const signalTargets = new Set(
    current.participants
      .filter((participant) => participant.username !== session.username)
      .map((participant) => participant.username),
  );

  if (req.body.offer && typeof req.body.offerTo === "string" && signalTargets.has(req.body.offerTo)) {
    current.signals.push({
      id: createCallSignalId(),
      kind: "offer",
      from: session.username,
      to: req.body.offerTo,
      createdAt: new Date().toISOString(),
      payload: req.body.offer as { type?: string; sdp?: string },
    });
  }

  if (req.body.answer && typeof req.body.answerTo === "string" && signalTargets.has(req.body.answerTo)) {
    current.signals.push({
      id: createCallSignalId(),
      kind: "answer",
      from: session.username,
      to: req.body.answerTo,
      createdAt: new Date().toISOString(),
      payload: req.body.answer as { type?: string; sdp?: string },
    });
  }

  if (req.body.iceCandidate && typeof req.body.iceTo === "string" && signalTargets.has(req.body.iceTo)) {
    current.signals.push({
      id: createCallSignalId(),
      kind: "ice",
      from: session.username,
      to: req.body.iceTo,
      createdAt: new Date().toISOString(),
      payload: req.body.iceCandidate as {
        candidate?: string;
        sdpMid?: string | null;
        sdpMLineIndex?: number | null;
        usernameFragment?: string | null;
      },
    });
  }

  current.signals = dedupeSignals(current.signals);
  current.updatedAt = new Date().toISOString();
  conversationCalls.set(conversationId, current);
  res.json({ data: current });
});

app.post("/api/conversations/:id/call/end", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "talk"))) return;

  const conversationId = Number(req.params.id);
  await leaveNativeTalkCall(session, conversationId).catch(() => false);

  const existing = conversationCalls.get(conversationId);
  if (existing) {
    // Mark this user as "left" instead of deleting the entire call
    existing.participants = existing.participants.map((p) =>
      p.username === session.username
        ? { ...p, status: "left" as const, joinedAt: null }
        : p
    );
    existing.updatedAt = new Date().toISOString();

    // Only delete the call if no one else is still joined
    const stillJoined = existing.participants.filter((p) => p.status === "joined");
    if (stillJoined.length === 0) {
      conversationCalls.delete(conversationId);
    } else {
      conversationCalls.set(conversationId, existing);
    }
  }

  res.json({ data: { success: true } });
});

// Events
app.get("/api/events", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "calendar"))) return;

  try {
    res.json({ data: await listEvents(session) });
  } catch {
    res.status(502).json({ error: "Unable to load events from Nextcloud Calendar." });
  }
});
app.get("/api/events/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "calendar"))) return;

  try {
    const event = await getEvent(session, Number(req.params.id));
    if (!event) return res.status(404).json({ error: "Not found" });
    res.json({ data: event });
  } catch {
    res.status(502).json({ error: "Unable to load event from Nextcloud Calendar." });
  }
});
app.post("/api/events", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "calendar"))) return;

  try {
    res.json({ data: await createEvent(session, req.body) });
  } catch {
    res.status(502).json({ error: "Unable to create event in Nextcloud Calendar." });
  }
});
app.patch("/api/events/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "calendar"))) return;

  try {
    const updated = await updateEvent(session, Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ data: updated });
  } catch {
    res.status(502).json({ error: "Unable to update event in Nextcloud Calendar." });
  }
});
app.delete("/api/events/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "calendar"))) return;

  try {
    const success = await deleteEvent(session, Number(req.params.id));
    res.json({ data: { success } });
  } catch {
    res.status(502).json({ error: "Unable to delete event from Nextcloud Calendar." });
  }
});

// Notes
app.get("/api/notes", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "notes"))) return;

  try {
    res.json({ data: await listNotes(session) });
  } catch {
    res.status(502).json({ error: "Unable to load notes from Nextcloud WebDAV." });
  }
});
app.get("/api/notes/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "notes"))) return;

  try {
    const note = await getNote(session, Number(req.params.id));
    if (!note) return res.status(404).json({ error: "Not found" });
    res.json({ data: note });
  } catch {
    res.status(502).json({ error: "Unable to load note from Nextcloud WebDAV." });
  }
});
app.post("/api/notes", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "notes"))) return;

  try {
    res.json({ data: await createNote(session, req.body) });
  } catch {
    res.status(502).json({ error: "Unable to create note in Nextcloud WebDAV." });
  }
});
app.patch("/api/notes/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "notes"))) return;

  try {
    const updated = await updateNote(session, Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ data: updated });
  } catch {
    res.status(502).json({ error: "Unable to update note in Nextcloud WebDAV." });
  }
});
app.delete("/api/notes/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "notes"))) return;

  try {
    const success = await deleteNote(session, Number(req.params.id));
    res.json({ data: { success } });
  } catch {
    res.status(502).json({ error: "Unable to delete note from Nextcloud WebDAV." });
  }
});

// Contacts
app.get("/api/contacts", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "contacts"))) return;

  try {
    res.json({ data: await listContacts(session) });
  } catch {
    res.status(502).json({ error: "Unable to load contacts from Nextcloud CardDAV." });
  }
});
app.get("/api/contacts/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "contacts"))) return;

  try {
    const contact = await getContact(session, Number(req.params.id));
    if (!contact) return res.status(404).json({ error: "Not found" });
    res.json({ data: contact });
  } catch {
    res.status(502).json({ error: "Unable to load contact from Nextcloud CardDAV." });
  }
});
app.post("/api/contacts", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "contacts"))) return;

  try {
    res.json({ data: await createContact(session, req.body) });
  } catch {
    res.status(502).json({ error: "Unable to create contact in Nextcloud CardDAV." });
  }
});
app.patch("/api/contacts/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "contacts"))) return;

  try {
    const contact = await updateContact(session, Number(req.params.id), req.body);
    if (!contact) return res.status(404).json({ error: "Not found" });
    res.json({ data: contact });
  } catch {
    res.status(502).json({ error: "Unable to update contact in Nextcloud CardDAV." });
  }
});
app.delete("/api/contacts/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "contacts"))) return;

  try {
    const success = await deleteContact(session, Number(req.params.id));
    res.json({ data: { success } });
  } catch {
    res.status(502).json({ error: "Unable to delete contact from Nextcloud CardDAV." });
  }
});

// Boards
app.get("/api/boards", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "deck"))) return;

  try {
    res.json({ data: await listBoards(session) });
  } catch {
    res.status(502).json({ error: "Unable to load boards from Nextcloud Deck." });
  }
});
app.get("/api/boards/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "deck"))) return;

  try {
    res.json({ data: await getBoard(session, Number(req.params.id)) });
  } catch {
    res.status(502).json({ error: "Unable to load board from Nextcloud Deck." });
  }
});
app.post("/api/boards", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "deck"))) return;

  try {
    res.json({ data: await createBoard(session, req.body) });
  } catch {
    res.status(502).json({ error: "Unable to create board in Nextcloud Deck." });
  }
});
app.post("/api/boards/:id/stacks", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "deck"))) return;

  try {
    res.json({ data: await createStack(session, Number(req.params.id), String(req.body?.title || "Stack"), Number(req.body?.order || 0)) });
  } catch {
    res.status(502).json({ error: "Unable to create stack in Nextcloud Deck." });
  }
});
app.post("/api/boards/:boardId/stacks/:stackId/cards", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "deck"))) return;

  try {
    res.json({ data: await createCard(session, Number(req.params.boardId), Number(req.params.stackId), req.body) });
  } catch {
    res.status(502).json({ error: "Unable to create card in Nextcloud Deck." });
  }
});

// Cards
app.patch("/api/cards/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "deck"))) return;

  try {
    const card = await updateCard(session, Number(req.params.id), req.body);
    if (!card) return res.status(404).json({ error: "Not found" });
    res.json({ data: card });
  } catch {
    res.status(502).json({ error: "Unable to update card in Nextcloud Deck." });
  }
});
app.delete("/api/cards/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;
  if (!(await requireCapability(session, res, "deck"))) return;

  try {
    const success = await deleteCard(session, Number(req.params.id));
    res.json({ data: { success } });
  } catch {
    res.status(502).json({ error: "Unable to delete card from Nextcloud Deck." });
  }
});

// Emails — counts MUST be before :id route
app.get("/api/emails/counts", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  try {
    res.json({ data: await getEmailCounts(session) });
  } catch {
    res.status(502).json({ error: "Unable to load Nextcloud Mail counts." });
  }
});
app.get("/api/emails", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  const folder = (req.query.folder as string) || "inbox";
  try {
    res.json({ data: await listEmails(session, folder) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load mail from Nextcloud Mail.";
    res.status(502).json({ error: message });
  }
});
app.get("/api/emails/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  try {
    const email = await getEmail(session, Number(req.params.id));
    if (!email) return res.status(404).json({ error: "Not found" });
    if (!email.isRead) {
      await updateEmail(session, email.id, { isRead: true }).catch(() => undefined);
      const refreshed = await getEmail(session, Number(req.params.id));
      return res.json({ data: refreshed || email });
    }
    res.json({ data: email });
  } catch {
    res.status(502).json({ error: "Unable to load message from Nextcloud Mail." });
  }
});
app.post("/api/emails", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  try {
    res.json({ data: await createEmail(session, req.body) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create message in Nextcloud Mail.";
    res.status(502).json({ error: message });
  }
});
app.patch("/api/emails/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  try {
    const email = await updateEmail(session, Number(req.params.id), req.body);
    if (!email) return res.status(404).json({ error: "Not found" });
    res.json({ data: email });
  } catch {
    res.status(502).json({ error: "Unable to update message flags in Nextcloud Mail." });
  }
});
app.delete("/api/emails/:id", async (req, res) => {
  const session = requireNextcloudSession(req, res);
  if (!session) return;

  try {
    const success = await deleteEmail(session, Number(req.params.id));
    res.json({ data: { success } });
  } catch {
    res.status(502).json({ error: "Unable to delete message from Nextcloud Mail." });
  }
});

// Activities
app.get("/api/activity", (req, res) => {
  const limit = Number(req.query.limit) || 50;
  const type = (req.query.type as string) || "all";
  let all = storage.getActivities();
  if (type && type !== "all") {
    all = all.filter(a => a.type === type);
  }
  all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  res.json({ data: all.slice(0, limit) });
});
app.patch("/api/activity/:id/read", (req, res) => {
  storage.updateActivity(Number(req.params.id), { isRead: true });
  res.json({ data: { success: true } });
});
app.post("/api/activity/read-all", (_req, res) => {
  storage.markAllActivitiesRead();
  res.json({ data: { success: true } });
});
app.get("/api/activities", (_req, res) => res.json({ data: storage.getActivities() }));

const PORT = Number(process.env.PORT || 5000);

// Try HTTPS first (needed for WebRTC camera/mic on LAN), fall back to HTTP
const certsDir = path.resolve(import.meta.dirname || ".", "certs");
const certPath = path.join(certsDir, "cert.pem");
const keyPath = path.join(certsDir, "key.pem");

// Also check project root certs/
const rootCertsDir = path.resolve(import.meta.dirname || ".", "..", "certs");
const rootCertPath = path.join(rootCertsDir, "cert.pem");
const rootKeyPath = path.join(rootCertsDir, "key.pem");

const finalCert = fs.existsSync(certPath) ? certPath : fs.existsSync(rootCertPath) ? rootCertPath : null;
const finalKey = fs.existsSync(keyPath) ? keyPath : fs.existsSync(rootKeyPath) ? rootKeyPath : null;

if (finalCert && finalKey) {
  const sslOptions = {
    key: fs.readFileSync(finalKey),
    cert: fs.readFileSync(finalCert),
  };
  https.createServer(sslOptions, app).listen(PORT, "0.0.0.0", () => {
    console.log(`CloudSpace API server running on https://0.0.0.0:${PORT}`);
    console.log(`Nextcloud upstream: ${process.env.NC_BASE_URL || "http://localhost:8090"}`);
    console.log(`Mock-backed endpoints: ${ALLOW_MOCK_SERVICES ? "enabled" : "disabled"}`);
  });
} else {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CloudSpace API server running on http://0.0.0.0:${PORT}`);
    console.log(`Nextcloud upstream: ${process.env.NC_BASE_URL || "http://localhost:8090"}`);
    console.log(`Mock-backed endpoints: ${ALLOW_MOCK_SERVICES ? "enabled" : "disabled"}`);
    console.log(`WARNING: No SSL certs found. WebRTC calls will not work on LAN.`);
  });
}
