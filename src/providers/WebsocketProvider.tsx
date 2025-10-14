import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";

const MAX_TRAFFIC_LOG = 40;

export interface WsTrafficEntry {
  id: number;
  ts: number;
  type: "update" | "awareness";
  direction: "incoming" | "outgoing";
  size?: number;
  details: string;
  preview?: string;
}

interface UseYProviderOptions {
  room: string
  serverUrl: string
  connect?: boolean
}

/**
 * Hook to manage Yjs WebsocketProvider lifecycle.
 * Handles auto connect/disconnect, status tracking, and cleanup.
 */
export function useYProvider({ room, serverUrl, connect = true }: UseYProviderOptions) {
  const [doc] = useState(() => new Y.Doc());
  const providerRef = useRef<WebsocketProvider | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [traffic, setTraffic] = useState<WsTrafficEntry[]>([]);

  useEffect(() => {
    if (!connect) return;
    const provider = new WebsocketProvider(serverUrl, room, doc, { connect });
    providerRef.current = provider;
    setAwareness(provider.awareness);

    const isDev = import.meta.env.DEV;
    let disposed = false;
    let nextId = 1;

    const appendTraffic = (entry: Omit<WsTrafficEntry, "id">) => {
      if (!isDev || disposed) return;
      setTraffic((prev) => {
        const nextEntry = { ...entry, id: nextId++ };
        const merged = [...prev, nextEntry];
        if (merged.length > MAX_TRAFFIC_LOG) {
          return merged.slice(merged.length - MAX_TRAFFIC_LOG);
        }
        return merged;
      });
    };

    const toHexPreview = (buf: Uint8Array) =>
      Array.from(buf.slice(0, 24))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");

    const summarizeUpdate = (buf: Uint8Array) => {
      try {
        const { structs, ds } = Y.decodeUpdate(buf);
        const typeCount = structs.reduce<Record<string, number>>((acc, struct: any) => {
          const name = struct.constructor?.name ?? "Struct";
          acc[name] = (acc[name] ?? 0) + 1;
          return acc;
        }, {});
        const typeSummary = Object.entries(typeCount)
          .map(([name, count]) => `${name}:${count}`)
          .join(" ");

        let deleteCount = 0;
        ds.clients.forEach((items) => {
          deleteCount += items.length;
        });

        const parts = [`structs:${structs.length}`];
        if (typeSummary.length > 0) parts.push(typeSummary);
        if (deleteCount > 0) parts.push(`deletes:${deleteCount}`);
        return parts.join(" · ");
      } catch (err) {
        return `${toHexPreview(buf)}${buf.byteLength > 24 ? " …" : ""}`;
      }
    };

    const handleStatus = (e: { status: string }) => {
      setStatus(e.status === "connected" ? "connected" : "disconnected");
    };
    provider.on("status", handleStatus);

    const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (!isDev) return;
      const direction = origin === provider ? "incoming" : "outgoing";
      appendTraffic({
        ts: Date.now(),
        type: "update",
        direction,
        size: update.byteLength,
        details: summarizeUpdate(update),
        preview: `${toHexPreview(update)}${update.byteLength > 24 ? " …" : ""}`,
      });
    };
    doc.on("update", handleDocUpdate);

    const handleAwarenessUpdate = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      if (!isDev) return;
      const direction = origin === provider ? "incoming" : "outgoing";
      appendTraffic({
        ts: Date.now(),
        type: "awareness",
        direction,
        details: `added:${added.length} · updated:${updated.length} · removed:${removed.length}`,
      });
    };
    provider.awareness.on("update", handleAwarenessUpdate);

    return () => {
      disposed = true;
      provider.off("status", handleStatus);
      doc.off("update", handleDocUpdate);
      provider.awareness.off("update", handleAwarenessUpdate);
      try {
        provider.awareness.setLocalState(null);
      } catch {}
      provider.destroy();
      providerRef.current = null;
      setAwareness(null);
      setStatus("disconnected");
      if (isDev) {
        setTraffic([]);
      }
    };
  }, [room, serverUrl, connect, doc]);

  return { doc, provider: providerRef.current, status, awareness, traffic };
}
