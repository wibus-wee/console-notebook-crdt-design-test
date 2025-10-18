import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import {
  NotebookDevPanel,
  type AwarenessPanelData,
  type AwarenessPresence,
  type NotebookDevPanelProps,
  type DevPanelTrafficEntry,
} from ".";
import {
  useNotebookAtoms,
  useNotebookStatus,
  useNotebookUndoHistory,
  useNotebookYjs,
} from "@/providers/NotebookProvider";
import { useNotebookReport } from "./hooks";
import { useAwarenessContext, type AwarenessPayload } from "@/providers/AwarenessProvider";

type ProviderNotebookDevPanelProps = Pick<NotebookDevPanelProps, "resizableStorageKey" | "defaultSize" | "defaultOpen" | "isDev">;

export function ProviderNotebookDevPanel(props: ProviderNotebookDevPanelProps = {}) {
  const { notebook, doc, traffic, undoManager } = useNotebookYjs();
  const status = useNotebookStatus();
  const notebookAtoms = useNotebookAtoms();
  const snapshot = useAtomValue(notebookAtoms.snapshotAtom);
  const report = useNotebookReport(notebook, snapshot);
  const undoHistory = useNotebookUndoHistory();
  const awarenessData = useProviderAwarenessData();

  return (
    <NotebookDevPanel
      notebook={notebook}
      doc={doc}
      status={status}
      report={report}
      undoHistory={undoHistory}
      undoManager={undoManager}
      traffic={traffic as DevPanelTrafficEntry[]}
      awareness={awarenessData}
      {...props}
    />
  );
}

export type { ProviderNotebookDevPanelProps };

function useProviderAwarenessData(): AwarenessPanelData | undefined {
  const awarenessCtx = useAwarenessContext();
  const { awareness, peers, localUser, getLocalState } = awarenessCtx;
  const [selfPresence, setSelfPresence] = useState<AwarenessPresence | undefined>(undefined);

  useEffect(() => {
    if (!awareness) {
      setSelfPresence(undefined);
      return;
    }

    const sync = () => {
      setSelfPresence(mapLocalPresence(awareness.clientID, localUser, getLocalState()));
    };

    sync();
    awareness.on("change", sync);
    awareness.on("update", sync);

    return () => {
      awareness.off("change", sync);
      awareness.off("update", sync);
    };
  }, [awareness, getLocalState, localUser]);

  const peerPresence = useMemo<AwarenessPresence[]>(() => {
    return [...peers]
      .map((peer) => ({
        clientId: peer.clientId,
        user: peer.user,
        editing: peer.editing,
        cursor: peer.cursor,
        ts: peer.ts,
      }))
      .sort((a, b) => b.ts - a.ts);
  }, [peers]);

  if (!selfPresence && peerPresence.length === 0) {
    return undefined;
  }

  return {
    self: selfPresence,
    peers: peerPresence,
  };
}

function mapLocalPresence(clientId: number, user: AwarenessPresence["user"], payload: AwarenessPayload): AwarenessPresence {
  return {
    clientId,
    user,
    editing: payload.editing,
    cursor: payload.cursor,
    ts: payload.ts ?? Date.now(),
  };
}
