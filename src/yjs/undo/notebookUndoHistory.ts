import * as Y from "yjs";
import type { UndoManager } from "yjs";
import type { YNotebook } from "@/yjs/schema/core/types";
import {
  CELL_META,
  CELL_SOURCE,
  NB_CELL_MAP,
  NB_CELL_ORDER,
  NB_TOMBSTONE_META,
  NB_TOMBSTONES,
} from "@/yjs/schema/core/keys";
import { USER_ACTION_ORIGIN } from "@/yjs/schema/core/origins";

const STACK_META_KEY = "rw:notebook:scope";

type StackItemLike = UndoManager["undoStack"][number];

type StackItemEventLike = {
  stackItem: StackItemLike;
  origin: unknown;
  type: "undo" | "redo";
  changedParentTypes: Map<Y.AbstractType<Y.YEvent<any>>, Y.YEvent<any>[]>;
};

type OriginSummary = {
  label: string;
  type: string;
};

export type UndoScopeChange = {
  id: string;
  kind: "map" | "array" | "text" | "unknown";
  target: string;
  path: string[];
  description: string;
};

export type UndoScopeTransaction = {
  id: string;
  timestamp: number;
  origin: OriginSummary;
  changeCount: number;
  changes: UndoScopeChange[];
};

export type UndoScopeSummary = {
  id: string;
  createdAt: number;
  updatedAt: number;
  origin: OriginSummary;
  transactionCount: number;
  changeCount: number;
  transactions: UndoScopeTransaction[];
};

export type UndoHistorySnapshot = {
  undo: UndoScopeSummary[];
  redo: UndoScopeSummary[];
  canUndo: boolean;
  canRedo: boolean;
};

type ScopeMeta = {
  id: string;
  createdAt: number;
  updatedAt: number;
  origin?: OriginSummary;
  transactions: UndoScopeTransaction[];
};

type Dispose = () => void;

let scopeCounter = 0;

const nextId = (prefix: string): string => {
  scopeCounter = (scopeCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${scopeCounter.toString(36)}`;
};

const SEGMENT_LABELS: Record<string, string> = {
  [NB_CELL_ORDER]: "Order",
  [NB_CELL_MAP]: "Cells",
  [NB_TOMBSTONES]: "Tombstones",
  [NB_TOMBSTONE_META]: "Tombstone Meta",
  [CELL_SOURCE]: "Source",
  [CELL_META]: "Metadata",
};

const describeOrigin = (origin: unknown): OriginSummary => {
  if (origin === USER_ACTION_ORIGIN) {
    return { label: "USER_ACTION", type: "symbol" };
  }
  if (origin == null) {
    return { label: "(default)", type: "null" };
  }
  if (typeof origin === "string") {
    return { label: origin, type: "string" };
  }
  if (typeof origin === "symbol") {
    return { label: origin.description ?? origin.toString(), type: "symbol" };
  }
  if (typeof origin === "function") {
    return { label: origin.name || "(fn)", type: "function" };
  }
  if (typeof origin === "object") {
    const ctor = origin.constructor?.name || "Object";
    const tag = (origin as { type?: string; kind?: string; tag?: string }).type
      ?? (origin as { type?: string; kind?: string; tag?: string }).kind
      ?? (origin as { type?: string; kind?: string; tag?: string }).tag;
    return { label: tag ? `${ctor}:${tag}` : ctor, type: "object" };
  }
  return { label: String(origin), type: typeof origin };
};

const formatSegment = (segment: string | number): string => {
  if (typeof segment === "number") {
    return `#${segment}`;
  }
  return SEGMENT_LABELS[segment] ?? segment;
};

const truncate = (value: string, max = 32): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
};

const formatInsertedValue = (value: unknown): string => {
  if (typeof value === "string") {
    return truncate(value.replace(/\s+/g, " "));
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  if (value instanceof Y.Map) {
    return "Map";
  }
  if (value instanceof Y.Array) {
    return "Array";
  }
  if (value instanceof Y.Text) {
    return "Text";
  }
  if (value instanceof Y.XmlElement) {
    return value.nodeName;
  }
  if (value && typeof value === "object") {
    return value.constructor?.name ?? "Object";
  }
  return typeof value === "undefined" ? "undefined" : String(value);
};

const summarizeMapChange = (event: Y.YMapEvent<any>): string => {
  const entries = Array.from(event.keys.entries());
  if (entries.length === 0) {
    return "map changed";
  }
  return entries
    .map(([key, change]) => {
      const actionLabel = change.action === "add"
        ? "+"
        : change.action === "update"
          ? "~"
          : "-";
      return `${actionLabel}${formatSegment(key)}`;
    })
    .join(", ");
};

const summarizeArrayChange = (event: Y.YArrayEvent<unknown>): string => {
  const delta = event.delta ?? [];
  let insertedCount = 0;
  let deletedCount = 0;
  const previews: string[] = [];

  delta.forEach((part) => {
    if (Array.isArray(part.insert)) {
      insertedCount += part.insert.length;
      part.insert.slice(0, 2).forEach((value) => {
        if (previews.length < 3) {
          previews.push(formatInsertedValue(value));
        }
      });
    } else if (typeof part.insert === "string") {
      insertedCount += 1;
      if (previews.length < 3) {
        previews.push(truncate(part.insert.replace(/\s+/g, " ")));
      }
    }
    if (part.delete) {
      deletedCount += part.delete;
    }
  });

  const bits = [];
  if (insertedCount) {
    bits.push(`+${insertedCount}${previews.length ? ` (${previews.join(" · ")}${insertedCount > previews.length ? "…" : ""})` : ""}`);
  }
  if (deletedCount) {
    bits.push(`-${deletedCount}`);
  }
  return bits.length > 0 ? bits.join(", ") : "order changed";
};

const summarizeTextChange = (event: Y.YTextEvent): string => {
  const delta = event.delta ?? [];
  let insertedChars = 0;
  let deletedChars = 0;
  const previews: string[] = [];

  delta.forEach((part) => {
    if (typeof part.insert === "string") {
      insertedChars += part.insert.length;
      if (previews.join(" ").length < 48 && part.insert.trim().length > 0) {
        previews.push(truncate(part.insert.replace(/\s+/g, " "), 24));
      }
    } else if (Array.isArray(part.insert)) {
      insertedChars += part.insert.length;
    }
    if (part.delete) {
      deletedChars += part.delete;
    }
  });

  const bits = [];
  if (insertedChars) bits.push(`+${insertedChars}`);
  if (deletedChars) bits.push(`-${deletedChars}`);
  if (previews.length) bits.push(`“${previews.join(" · ")}”`);
  return bits.length > 0 ? bits.join(" ") : "text changed";
};

const describeEvent = (event: Y.YEvent<any>): UndoScopeChange => {
  const target = event.target;
  const path = event.path.map(formatSegment);
  let kind: "map" | "array" | "text" | "unknown" = "unknown";
  let description = "changed";

  if (target instanceof Y.Text) {
    kind = "text";
    description = summarizeTextChange(event as Y.YTextEvent);
  } else if (target instanceof Y.Array) {
    kind = "array";
    description = summarizeArrayChange(event as Y.YArrayEvent<unknown>);
  } else if (target instanceof Y.Map) {
    kind = "map";
    description = summarizeMapChange(event as Y.YMapEvent<unknown>);
  }

  const targetLabel = path.length > 0 ? path.join(" › ") : target.constructor?.name ?? "unknown";

  return {
    id: nextId("chg"),
    kind,
    target: targetLabel,
    path,
    description,
  };
};

const collectChanges = (changedParentTypes: Map<Y.AbstractType<Y.YEvent<any>>, Y.YEvent<any>[]>): UndoScopeChange[] => {
  const changes: UndoScopeChange[] = [];
  changedParentTypes.forEach((events) => {
    events.forEach((event) => {
      changes.push(describeEvent(event));
    });
  });
  return changes;
};

const ensureScopeMeta = (item: StackItemLike): ScopeMeta => {
  let meta = item.meta.get(STACK_META_KEY) as ScopeMeta | undefined;
  if (!meta) {
    meta = {
      id: nextId("scope"),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      transactions: [],
    };
    item.meta.set(STACK_META_KEY, meta);
  }
  return meta;
};

const captureTransaction = (event: StackItemEventLike): void => {
  const meta = ensureScopeMeta(event.stackItem);
  const changes = collectChanges(event.changedParentTypes);
  if (changes.length === 0) {
    return;
  }

  const transaction: UndoScopeTransaction = {
    id: nextId("tx"),
    timestamp: Date.now(),
    origin: describeOrigin(event.origin),
    changeCount: changes.length,
    changes,
  };

  meta.transactions.push(transaction);
  meta.updatedAt = transaction.timestamp;
  if (!meta.origin) {
    meta.origin = transaction.origin;
  }
};

const toSummary = (item: StackItemLike): UndoScopeSummary => {
  const meta = ensureScopeMeta(item);
  const origin = meta.origin ?? { label: "(unknown)", type: "unknown" };
  const changeCount = meta.transactions.reduce((acc, tx) => acc + tx.changeCount, 0);
  return {
    id: meta.id,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    origin,
    transactionCount: meta.transactions.length,
    changeCount,
    transactions: meta.transactions.slice(),
  };
};

const buildSnapshot = (manager: UndoManager): UndoHistorySnapshot => ({
  undo: manager.undoStack.slice().reverse().map(toSummary),
  redo: manager.redoStack.slice().reverse().map(toSummary),
  canUndo: manager.canUndo(),
  canRedo: manager.canRedo(),
});

export class NotebookUndoHistory {
  private readonly listeners = new Set<() => void>();
  private readonly disposers: Dispose[];
  private snapshot: UndoHistorySnapshot;

  constructor(private readonly undoManager: UndoManager, _nb: YNotebook) {
    this.snapshot = buildSnapshot(this.undoManager);

    const notify = () => {
      this.snapshot = buildSnapshot(this.undoManager);
      this.listeners.forEach((listener) => listener());
    };

    const handleStackMutation = (event: StackItemEventLike) => {
      captureTransaction(event);
      notify();
    };

    const handleChangeOnly = () => {
      notify();
    };

    this.disposers = [
      () => this.undoManager.off("stack-item-added", handleStackMutation),
      () => this.undoManager.off("stack-item-updated", handleStackMutation),
      () => this.undoManager.off("stack-item-popped", handleChangeOnly),
      () => this.undoManager.off("stack-cleared", handleChangeOnly),
    ];

    this.undoManager.on("stack-item-added", handleStackMutation);
    this.undoManager.on("stack-item-updated", handleStackMutation);
    this.undoManager.on("stack-item-popped", handleChangeOnly);
    this.undoManager.on("stack-cleared", handleChangeOnly);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): UndoHistorySnapshot {
    return this.snapshot;
  }

  destroy(): void {
    this.disposers.forEach((dispose) => dispose());
    this.listeners.clear();
  }
}
