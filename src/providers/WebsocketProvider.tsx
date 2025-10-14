import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";

const MAX_TRAFFIC_LOG = 40;

export interface DecodedStructInfo {
  index: number;
  type: string;
  summary: string;
  details?: string[];
}

export interface DecodedDeleteEntry {
  client: number;
  clock: number;
  len: number;
}

export interface DecodedUpdateDetails {
  structs: DecodedStructInfo[];
  deletes: DecodedDeleteEntry[];
}

export interface WsTrafficEntry {
  id: number;
  ts: number;
  type: "update" | "awareness";
  direction: "incoming" | "outgoing";
  size?: number;
  details: string;
  preview?: string;
  decoded?: DecodedUpdateDetails;
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
  const [synced, setSynced] = useState(false);
  const [syncedOnce, setSyncedOnce] = useState(false);

  useEffect(() => {
    setSynced(false);

    if (!connect) {
      providerRef.current = null;
      setStatus("disconnected");
      setAwareness(null);
      setSyncedOnce(false);
      return;
    }

    setStatus("connecting");
    setSyncedOnce(false);
    const provider = new WebsocketProvider(serverUrl, room, doc, { connect });
    providerRef.current = provider;
    setAwareness(provider.awareness);

    const isDev = import.meta.env.DEV;
    let disposed = false;
    let nextId = 1;

    const handleSync = (isSynced: boolean) => {
      setSynced(isSynced);
      if (isSynced) setSyncedOnce(true);
    };

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

    const summarizeUpdate = (buf: Uint8Array): { summary: string; decoded?: DecodedUpdateDetails } => {
      const describeId = (id: any): string | undefined => {
        if (!id) return undefined;
        if (typeof id === "string") return id;
        if (typeof id === "object") {
          const client = (id as any).client;
          const clock = (id as any).clock;
          if (typeof client === "number" && typeof clock === "number") {
            return `${client}:${clock}`;
          }
          if ("id" in id && (id as any).id) {
            return describeId((id as any).id);
          }
          const guid = (id as any).guid;
          if (typeof guid === "string") {
            return guid;
          }
        }
        return String(id);
      };

      const describeValue = (value: unknown): string => {
        if (value == null) return "null";
        if (typeof value === "string") return JSON.stringify(value.length > 120 ? `${value.slice(0, 117)}…` : value);
        if (typeof value === "number" || typeof value === "boolean") return String(value);
        if (Array.isArray(value)) {
          return `[${value.map(describeValue).join(", ")}]`;
        }
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      };

      const describeContent = (content: any): string | undefined => {
        if (!content) return undefined;
        const ctor = content.constructor?.name ?? typeof content;
        switch (ctor) {
          case "ContentString":
            if (typeof content.str === "string") {
              const str = content.str.length > 140 ? `${content.str.slice(0, 137)}…` : content.str;
              return `String(${JSON.stringify(str)})`;
            }
            return "String";
          case "ContentType": {
            const typeName = content.type?.constructor?.name ?? "UnknownType";
            const guid = typeof content.type?.guid === "string" ? content.type.guid : undefined;
            return `Type(${typeName}${guid ? `:${guid}` : ""})`;
          }
          case "ContentAny":
            if (Array.isArray(content.arr)) {
              return `Any(${content.arr.map(describeValue).join(", ")})`;
            }
            return "Any";
          case "ContentJSON":
            if (Array.isArray(content.arr)) {
              try {
                return `JSON(${JSON.stringify(content.arr)})`;
              } catch {
                return "JSON";
              }
            }
            return "JSON";
          case "ContentBinary": {
            const len = content.buf?.length ?? content.content?.length ?? 0;
            return `Binary(${len} bytes)`;
          }
          case "ContentEmbed":
            return `Embed(${describeValue(content.embed)})`;
          default:
            return ctor;
        }
      };

      const describeStruct = (struct: any, index: number): DecodedStructInfo => {
        const type = struct.constructor?.name ?? "Struct";
        if (type === "Item") {
          const parts: string[] = [];
          const id = describeId(struct.id);
          if (id) parts.push(`id=${id}`);
          parts.push(`len=${struct.length}`);
          if (typeof struct.deleted === "boolean") parts.push(`deleted=${struct.deleted}`);
          const parent = describeId(struct.parent) ?? struct.parent?.constructor?.name;
          if (parent) parts.push(`parent=${parent}`);
          if (struct.parentSub != null) parts.push(`parentSub=${String(struct.parentSub)}`);
          const origin = describeId(struct.origin);
          if (origin) parts.push(`origin=${origin}`);
          const left = describeId(struct.left);
          if (left) parts.push(`left=${left}`);
          const right = describeId(struct.right);
          if (right) parts.push(`right=${right}`);

          const details: string[] = [];
          const contentSummary = describeContent(struct.content);
          if (contentSummary) details.push(`content=${contentSummary}`);
          if (typeof struct.info === "number") {
            const binary = struct.info.toString(2).padStart(8, "0");
            details.push(`info=0b${binary} (${struct.info})`);
          }

          return {
            index,
            type,
            summary: parts.join(" · "),
            details: details.length > 0 ? details : undefined,
          };
        }

        if (type === "GC" || type === "Skip") {
          const parts: string[] = [];
          const id = describeId(struct.id);
          if (id) parts.push(`id=${id}`);
          if (typeof struct.len === "number") parts.push(`len=${struct.len}`);
          return {
            index,
            type,
            summary: parts.join(" · ") || type,
          };
        }

        let summary = type;
        try {
          summary = JSON.stringify(struct, (_key, value) =>
            typeof value === "bigint" ? value.toString() : value
          );
        } catch {
          summary = type;
        }
        return {
          index,
          type,
          summary,
        };
      };

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

        const decodedStructs = structs.map((struct: any, index: number) => describeStruct(struct, index));
        const deletes: DecodedDeleteEntry[] = [];
        ds.clients.forEach((items, client) => {
          items.forEach((item: any) => {
            deletes.push({ client, clock: item.clock, len: item.len });
          });
        });

        const parts = [`structs:${structs.length}`];
        if (typeSummary.length > 0) parts.push(typeSummary);
        if (deleteCount > 0) parts.push(`deletes:${deleteCount}`);
        return { summary: parts.join(" · "), decoded: { structs: decodedStructs, deletes } };
      } catch (err) {
        return { summary: `${toHexPreview(buf)}${buf.byteLength > 24 ? " …" : ""}` };
      }
    };

    const handleStatus = (e: { status: string }) => {
      setStatus(e.status === "connected" ? "connected" : "disconnected");
    };
    provider.on("status", handleStatus);
    provider.on("sync", handleSync);

    const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (!isDev) return;
      const direction = origin === provider ? "incoming" : "outgoing";
      const analyzed = summarizeUpdate(update);
      appendTraffic({
        ts: Date.now(),
        type: "update",
        direction,
        size: update.byteLength,
        details: analyzed.summary,
        decoded: analyzed.decoded,
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
      provider.off("sync", handleSync);
      doc.off("update", handleDocUpdate);
      provider.awareness.off("update", handleAwarenessUpdate);
      try {
        provider.awareness.setLocalState(null);
      } catch {}
      provider.destroy();
      providerRef.current = null;
      setAwareness(null);
      setStatus("disconnected");
      setSynced(false);
      if (isDev) {
        setTraffic([]);
      }
    };
  }, [room, serverUrl, connect, doc]);

  return { doc, provider: providerRef.current, status, awareness, traffic, synced, syncedOnce };
}
