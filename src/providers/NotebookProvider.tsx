import { createContext, useContext, useMemo } from "react";
import type { Doc as YDoc } from "yjs";
import { createNotebookAtoms, type NotebookAtoms } from "@/yjs/jotai/notebookAtoms";
import { ensureNotebookInDoc } from "@/yjs/schema/bootstrap";
import type { YNotebook } from "@/yjs/schema/core/types";
import { useYProvider, type WsTrafficEntry } from "./WebsocketProvider";
import { AwarenessProvider } from "./AwarenessProvider";

const NotebookAtomsContext = createContext<NotebookAtoms | null>(null);
const NotebookStatusContext = createContext<"connecting" | "connected" | "disconnected">("connecting");
interface NotebookYjsContextValue {
  notebook: YNotebook;
  doc: YDoc;
  traffic: WsTrafficEntry[];
}

const NotebookYjsContext = createContext<NotebookYjsContextValue | null>(null);

export function NotebookProvider({
  room,
  serverUrl,
  children,
}: {
  room: string;
  serverUrl: string;
  children: React.ReactNode;
}) {
  const { doc, status, awareness, traffic } = useYProvider({ room, serverUrl });
  const nb = useMemo(() => ensureNotebookInDoc(doc), [doc]);
  const atoms = useMemo(() => createNotebookAtoms(nb), [nb]);

  return (
    <AwarenessProvider awareness={awareness}>
      <NotebookYjsContext.Provider value={{ notebook: nb, doc, traffic }}>
        <NotebookAtomsContext.Provider value={atoms}>
          <NotebookStatusContext.Provider value={status}>
            {children}
          </NotebookStatusContext.Provider>
        </NotebookAtomsContext.Provider>
      </NotebookYjsContext.Provider>
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
