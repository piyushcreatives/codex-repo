import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import Redis from "ioredis";
import { getSessionFromCookieHeader } from "./session-store";
import type { NextcloudSession } from "./credential-provider";
import { listNotifications, getNotifyPushEndpoint } from "./groupware-client";

type Client = { ws: WebSocket; username: string; session: NextcloudSession; subs: Set<number> };

const clients = new Set<Client>();

const CONV_CHANNEL = "cloudspace:conv";
const USER_CHANNEL = "cloudspace:user";
let redisPub: Redis | null = null;
let redisSub: Redis | null = null;

// ─── Local delivery (this instance's connected clients) ─────────────────────────
function deliverConvLocal(conversationId: number, event: Record<string, unknown>, exceptUsername?: string) {
  const payload = JSON.stringify({ ...event, conversationId });
  for (const c of clients) {
    if (!c.subs.has(conversationId)) continue;
    if (exceptUsername && c.username === exceptUsername) continue;
    if (c.ws.readyState === c.ws.OPEN) {
      try { c.ws.send(payload); } catch { /* noop */ }
    }
  }
}

function deliverUserLocal(username: string, event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  for (const c of clients) {
    if (c.username !== username) continue;
    if (c.ws.readyState === c.ws.OPEN) {
      try { c.ws.send(payload); } catch { /* noop */ }
    }
  }
}

// ─── Public broadcast API (Redis fan-out when configured, else in-memory) ───────
export function broadcastToConversation(conversationId: number, event: Record<string, unknown>, exceptUsername?: string) {
  if (redisPub) {
    redisPub.publish(CONV_CHANNEL, JSON.stringify({ conversationId, event, exceptUsername: exceptUsername ?? null }));
  } else {
    deliverConvLocal(conversationId, event, exceptUsername);
  }
}

export function broadcastToUser(username: string, event: Record<string, unknown>) {
  if (redisPub) {
    redisPub.publish(USER_CHANNEL, JSON.stringify({ username, event }));
  } else {
    deliverUserLocal(username, event);
  }
}

// ─── Optional Redis pub/sub for horizontal scale ────────────────────────────────
function initRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log("[realtime] REDIS_URL not set — single-instance in-memory mode");
    return;
  }
  try {
    redisPub = new Redis(url, { maxRetriesPerRequest: 2 });
    redisSub = new Redis(url, { maxRetriesPerRequest: 2 });
    redisPub.on("error", (e) => console.warn("[realtime] redis pub error:", e.message));
    redisSub.on("error", (e) => console.warn("[realtime] redis sub error:", e.message));
    redisSub.subscribe(CONV_CHANNEL, USER_CHANNEL);
    redisSub.on("message", (channel, raw) => {
      try {
        const data = JSON.parse(raw);
        if (channel === CONV_CHANNEL) {
          deliverConvLocal(data.conversationId, data.event, data.exceptUsername ?? undefined);
        } else if (channel === USER_CHANNEL) {
          deliverUserLocal(data.username, data.event);
        }
      } catch {
        /* ignore malformed pub/sub payloads */
      }
    });
    console.log("[realtime] Redis pub/sub enabled for horizontal scale");
  } catch (e) {
    console.warn("[realtime] Redis init failed, falling back to in-memory:", e instanceof Error ? e.message : e);
    redisPub = null;
    redisSub = null;
  }
}

// ─── Per-user watcher: real Nextcloud push (notify_push HPB) with a polling fallback ─
const NOTIF_POLL_MS = Number(process.env.NOTIF_POLL_MS || 15_000);
type Watcher = {
  refs: number;
  session: NextcloudSession;
  closed: boolean;
  lastKey: string;
  pushWs?: WebSocket;
  pollTimer?: ReturnType<typeof setInterval>;
};
const watchers = new Map<string, Watcher>();

async function startUserWatcher(client: Client) {
  const existing = watchers.get(client.username);
  if (existing) {
    existing.refs++;
    existing.session = client.session; // keep the freshest session
    return;
  }
  const watcher: Watcher = { refs: 1, session: client.session, closed: false, lastKey: "__init__" };
  watchers.set(client.username, watcher);

  // Prefer the High Performance Backend (notify_push) for true server push; else poll.
  const endpoint = await getNotifyPushEndpoint(client.session).catch(() => null);
  if (watcher.closed) return;
  if (endpoint) connectNotifyPush(client.username, watcher, endpoint);
  else startPolling(client.username, watcher);
}

function connectNotifyPush(username: string, watcher: Watcher, endpoint: string) {
  let ws: WebSocket;
  try {
    ws = new WebSocket(endpoint, { rejectUnauthorized: false } as never);
  } catch {
    startPolling(username, watcher);
    return;
  }
  watcher.pushWs = ws;
  let authenticated = false;

  ws.on("open", () => {
    // notify_push auth: send username, then the credential (app-password, or the
    // OAuth access token for SSO sessions). If notify_push rejects it, we fall back to polling.
    const secret = watcher.session.oauth?.accessToken || watcher.session.credential?.secret;
    if (!secret) { try { ws.close(); } catch { /* noop */ } startPolling(username, watcher); return; }
    try {
      ws.send(username);
      ws.send(secret);
    } catch {
      /* close handler falls back */
    }
  });

  ws.on("message", (raw) => {
    const text = raw.toString().trim();
    if (!authenticated) {
      if (text === "authenticated") {
        authenticated = true;
        console.log(`[realtime] notify_push connected for ${username}`);
      } else if (text.startsWith("err")) {
        try { ws.close(); } catch { /* noop */ }
        startPolling(username, watcher);
      }
      return;
    }
    if (text === "notify_notification") broadcastToUser(username, { type: "notifications" });
    else if (text === "notify_activity") broadcastToUser(username, { type: "activity" });
    else if (text.startsWith("notify_file")) broadcastToUser(username, { type: "files-changed" });
  });

  const onGone = () => {
    if (watcher.closed) return;
    watcher.pushWs = undefined;
    startPolling(username, watcher); // degrade to polling if push drops
  };
  ws.on("close", onGone);
  ws.on("error", () => { try { ws.close(); } catch { /* noop */ } });
}

function startPolling(username: string, watcher: Watcher) {
  if (watcher.pollTimer || watcher.closed) return;
  watcher.pollTimer = setInterval(async () => {
    if (watcher.closed) return;
    try {
      const notifs = await listNotifications(watcher.session);
      const key = notifs.map((n) => n.id).sort((a, b) => a - b).join(",");
      if (watcher.lastKey === "__init__") {
        watcher.lastKey = key; // baseline — don't push on connect
        return;
      }
      if (key !== watcher.lastKey) {
        watcher.lastKey = key;
        broadcastToUser(username, { type: "notifications" });
      }
    } catch {
      /* transient — try again next tick */
    }
  }, NOTIF_POLL_MS);
}

function stopUserWatcher(username: string) {
  const w = watchers.get(username);
  if (!w) return;
  w.refs--;
  if (w.refs <= 0) {
    w.closed = true;
    if (w.pollTimer) clearInterval(w.pollTimer);
    if (w.pushWs) { try { w.pushWs.close(); } catch { /* noop */ } }
    watchers.delete(username);
  }
}

// ─── WebSocket server ───────────────────────────────────────────────────────────
export function initRealtime(server: HttpServer | HttpsServer) {
  initRedis();
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) return;
    const session = getSessionFromCookieHeader(req.headers.cookie);
    if (!session) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, username: session.username, session, subs: new Set() };
      clients.add(client);
      void startUserWatcher(client);

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg?.type === "subscribe" && typeof msg.conversationId === "number") {
            client.subs.add(msg.conversationId);
          } else if (msg?.type === "unsubscribe" && typeof msg.conversationId === "number") {
            client.subs.delete(msg.conversationId);
          }
        } catch {
          /* ignore malformed frames */
        }
      });

      const cleanup = () => {
        if (clients.delete(client)) stopUserWatcher(client.username);
      };
      ws.on("close", cleanup);
      ws.on("error", () => { try { ws.close(); } catch { /* noop */ } cleanup(); });

      try { ws.send(JSON.stringify({ type: "connected" })); } catch { /* noop */ }
    });
  });

  const interval = setInterval(() => {
    for (const c of clients) {
      if (c.ws.readyState === c.ws.OPEN) {
        try { c.ws.ping(); } catch { /* noop */ }
      }
    }
  }, 30_000);
  wss.on("close", () => clearInterval(interval));

  console.log("Realtime WebSocket server attached at /ws");
}
