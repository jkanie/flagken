import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface FlagChanged {
  projectKey: string;
  environmentKey: string | null;
  flagKey: string;
  version: number;
  summary: string;
}

export interface AuditCreated {
  id: string;
  action: string;
  environmentKey: string | null;
  resourceKey: string;
  actorLabel: string;
  at: string;
}

type Handler = (event: string, data: unknown) => void;

/**
 * The console's WebSocket. It reconnects with exponential back-off and passes server events to the open pages.
 */
export const useLive = defineStore('live', () => {
  const connected = ref(false);
  const lastAudit = ref<AuditCreated | null>(null);
  const handlers = new Set<Handler>();
  let socket: WebSocket | null = null;
  let project = '';
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;

  function url(): string {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}/ws`;
  }

  function connect(): void {
    stopped = false;
    clearTimeout(timer);
    socket?.close();
    const ws = new WebSocket(url());
    socket = ws;
    ws.onmessage = (message) => {
      let parsed: { event: string; data: unknown };
      try {
        parsed = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (parsed.event === 'ready') {
        attempt = 0;
        if (project) ws.send(JSON.stringify({ event: 'subscribe', data: { project } }));
      }
      if (parsed.event === 'subscribed') connected.value = true;
      if (parsed.event === 'audit.created') lastAudit.value = parsed.data as AuditCreated;
      for (const handler of handlers) handler(parsed.event, parsed.data);
    };
    ws.onclose = (event) => {
      if (socket !== ws) return;
      connected.value = false;
      // 4401: the session ended. Signing in again starts a new socket.
      if (stopped || event.code === 4401) return;
      const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
      timer = setTimeout(connect, delay);
    };
  }

  function watch(projectKey: string): void {
    if (project === projectKey && socket && socket.readyState <= 1) return;
    project = projectKey;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ event: 'subscribe', data: { project } }));
    } else {
      connect();
    }
  }

  function stop(): void {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
    socket = null;
    connected.value = false;
  }

  function on(handler: Handler): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  return { connected, lastAudit, watch, stop, on };
});
