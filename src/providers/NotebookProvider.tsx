import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Doc as YDoc } from "yjs";
import { createNotebookAtoms, type NotebookAtoms } from "@/yjs/jotai/notebookAtoms";
import { ensureNotebookInDoc } from "@/yjs/schema/bootstrap";
import type { YNotebook } from "@/yjs/schema/core/types";
import { useYProvider, type WsTrafficEntry } from "./WebsocketProvider";
import { AwarenessProvider } from "./AwarenessProvider";
import { createNotebookUndoManager } from "@/yjs/schema/quality/undo";
import { MonacoBinding } from "y-monaco";
import type { UndoManager } from "yjs";
import { NotebookUndoHistory } from "@/yjs/undo/notebookUndoHistory";
import { CELL_ID_GUARD_ORIGIN, EXECUTION_ORIGIN, MAINT_ORIGIN, USER_ACTION_ORIGIN, VACUUM_ORIGIN } from "@/yjs/schema";

const NotebookAtomsContext = createContext<NotebookAtoms | null>(null);
const NotebookStatusContext = createContext<"connecting" | "connected" | "disconnected">("connecting");
interface NotebookYjsContextValue {
  notebook: YNotebook;
  doc: YDoc;
  traffic: WsTrafficEntry[];
  synced: boolean;
  syncedOnce: boolean;
  undoManager: UndoManager;
  undoHistory: NotebookUndoHistory;
}

const NotebookYjsContext = createContext<NotebookYjsContextValue | null>(null);

export function NotebookProvider({
  room,
  serverUrl,
  connect = true,
  children,
}: {
  room: string;
  serverUrl: string;
  connect?: boolean;
  children: React.ReactNode;
}) {
  const { doc, status, awareness, traffic, synced, syncedOnce } = useYProvider({ room, serverUrl, connect });
  const [notebook, setNotebook] = useState<YNotebook | null>(null);

  useEffect(() => {
    if (notebook) return;

    const ready = !connect || syncedOnce || (!syncedOnce && status === "disconnected");
    if (!ready) return;

    const root = ensureNotebookInDoc(doc);
    setNotebook(root);
  }, [doc, connect, syncedOnce, status, notebook]);

  const undoManager = useMemo(
    () =>
      notebook
        ? createNotebookUndoManager(notebook, {
            trackedOrigins: new Set([
              null,
              USER_ACTION_ORIGIN,
              MonacoBinding, // MonacoBinding uses its own origin, we need to track it to make editor changes undoable
              VACUUM_ORIGIN,
              MAINT_ORIGIN,
              CELL_ID_GUARD_ORIGIN,
              EXECUTION_ORIGIN,
            ]),
          })
        : null,
    [notebook]
  );

  useEffect(() => () => {
    undoManager?.destroy();
  }, [undoManager]);

  const undoHistory = useMemo(
    () => (notebook && undoManager ? new NotebookUndoHistory(undoManager, notebook) : null),
    [notebook, undoManager]
  );

  useEffect(() => () => {
    undoHistory?.destroy();
  }, [undoHistory]);

  const atoms = useMemo(() => (notebook ? createNotebookAtoms(notebook) : null), [notebook]);
  const isReady = notebook != null && atoms != null && undoManager != null && undoHistory != null;

  return (
    <AwarenessProvider awareness={awareness}>
      <NotebookStatusContext.Provider value={status}>
        {isReady && notebook && atoms && undoManager && undoHistory ? (
          <NotebookYjsContext.Provider value={{ notebook, doc, traffic, synced, syncedOnce, undoManager, undoHistory }}>
            <NotebookAtomsContext.Provider value={atoms}>{children}</NotebookAtomsContext.Provider>
          </NotebookYjsContext.Provider>
        ) : (
          <NotebookBootstrapFallback status={status} />
        )}
      </NotebookStatusContext.Provider>
    </AwarenessProvider>
  );
}

export function useNotebookAtoms() {
  const ctx = useContext(NotebookAtomsContext);
  if (!ctx) throw new Error("useNotebookAtoms must be used within NotebookProvider");
  return ctx;
}

export function useNotebookStatus() {
  return useContext(NotebookStatusContext);
}

export function useNotebookYjs() {
  const ctx = useContext(NotebookYjsContext);
  if (!ctx) throw new Error("useNotebookYjs must be used within NotebookProvider");
  return ctx;
}

export function useNotebookUndoManager() {
  return useNotebookYjs().undoManager;
}

export function useNotebookUndoHistory() {
  const { undoHistory } = useNotebookYjs();
  return useSyncExternalStore(
    (listener) => undoHistory.subscribe(listener),
    () => undoHistory.getSnapshot(),
    () => undoHistory.getSnapshot()
  );
}

function NotebookBootstrapFallback({ status }: { status: "connecting" | "connected" | "disconnected" }) {
  const message =
    status === "connecting"
      ? "Connecting to notebook…"
      : "Preparing local notebook state…";
  return (
    <div className="flex h-full w-full items-center justify-center py-12 text-sm text-muted-foreground">
      {message}
    </div>
  );
}
