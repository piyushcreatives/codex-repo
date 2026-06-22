import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Additive real-time layer for Talk. Opens a WebSocket to /ws, subscribes to the user's
 * conversations, and on server events triggers an immediate React Query refetch — so the
 * active conversation feels instant. Existing polling stays as a fallback; if the socket
 * drops, nothing breaks. Auto-reconnects with backoff.
 */
export function useRealtime(conversationIds: number[], queryClient: QueryClient) {
  const wsRef = useRef<WebSocket | null>(null);
  const idsRef = useRef<number[]>([]);
  idsRef.current = conversationIds;
  const idsKey = conversationIds.join(",");

  // Connect once; reconnect on drop.
  useEffect(() => {
    let closedByUs = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closedByUs) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      } catch {
        reconnectTimer = setTimeout(connect, 3000);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        for (const id of idsRef.current) {
          ws.send(JSON.stringify({ type: "subscribe", conversationId: id }));
        }
      };

      ws.onmessage = (event) => {
        let msg: { type?: string; conversationId?: number };
        try { msg = JSON.parse(event.data); } catch { return; }
        const cid = msg.conversationId;
        if (msg.type === "message" || msg.type === "message-changed") {
          if (cid) queryClient.invalidateQueries({ queryKey: ["/api/conversations/messages", cid] });
          queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        } else if (msg.type === "typing") {
          if (cid) queryClient.invalidateQueries({ queryKey: ["/api/conversations/typing", cid] });
        } else if (msg.type === "notifications") {
          queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
        } else if (msg.type === "activity") {
          queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
        } else if (msg.type === "files-changed") {
          queryClient.invalidateQueries({ queryKey: ["files-browser"] });
          queryClient.invalidateQueries({ queryKey: ["/api/files"] });
        }
      };

      ws.onclose = () => {
        if (!closedByUs) reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        try { ws.close(); } catch { /* noop */ }
      };
    };

    connect();
    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { wsRef.current?.close(); } catch { /* noop */ }
    };
  }, [queryClient]);

  // Re-subscribe when the set of conversations changes.
  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      for (const id of conversationIds) {
        ws.send(JSON.stringify({ type: "subscribe", conversationId: id }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return wsRef;
}
