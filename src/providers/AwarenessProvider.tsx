import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness";

interface AwarenessUser {
  id: string;
  name: string;
  color: string;
  avatarSeed: string;
}

export interface AwarenessSelectionRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface AwarenessEditingState {
  cellId?: string;
  isMonaco?: boolean;
  origin?: string;
}

export interface AwarenessCursorState {
  cellId?: string;
  selections: AwarenessSelectionRange[];
}

export interface AwarenessPayload {
  user: AwarenessUser;
  editing?: AwarenessEditingState;
  cursor?: AwarenessCursorState;
  ts: number;
}

export interface AwarenessPeer {
  clientId: number;
  user: AwarenessUser;
  editing?: AwarenessEditingState;
  cursor?: AwarenessCursorState;
  ts: number;
}

interface AwarenessContextValue {
  awareness: Awareness | null;
  localUser: AwarenessUser;
  peers: AwarenessPeer[];
  updateLocalState: (updater: (prev: AwarenessPayload) => AwarenessPayload) => void;
  setEditingState: (editing: AwarenessEditingState | null) => void;
  setCursorState: (cursor: AwarenessCursorState | null) => void;
  getLocalState: () => AwarenessPayload;
}

const AwarenessContext = createContext<AwarenessContextValue | null>(null);

const COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#FFD93D",
  "#5A6FE2",
  "#FF9F1C",
  "#9D4EDD",
  "#2EC4B6",
  "#F06595",
];

const ADJECTIVES = ["Swift", "Brave", "Calm", "Clever", "Bright", "Nimble", "Bold", "Misty"];
const ANIMALS = ["Falcon", "Otter", "Fox", "Panda", "Tiger", "Hawk", "Koala", "Dolphin"];

const randomOf = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

const createMockUser = (): AwarenessUser => {
  const name = `${randomOf(ADJECTIVES)} ${randomOf(ANIMALS)}`;
  const color = randomOf(COLORS);
  const avatarSeed = Math.random().toString(36).slice(2, 10);
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `user-${Math.random().toString(36).slice(2, 11)}`;
  return { id, name, color, avatarSeed };
};

const sanitizePayload = (payload: AwarenessPayload): AwarenessPayload => {
  const next: AwarenessPayload = {
    ...payload,
    ts: payload.ts ?? Date.now(),
  };

  if (!next.editing || !next.editing.cellId) {
    delete next.editing;
  }
  if (!next.cursor || !next.cursor.cellId || !next.cursor.selections?.length) {
    delete next.cursor;
  } else {
    next.cursor = {
      cellId: next.cursor.cellId,
      selections: next.cursor.selections.map((r) => ({
        startLineNumber: r.startLineNumber,
        startColumn: r.startColumn,
        endLineNumber: r.endLineNumber,
        endColumn: r.endColumn,
      })),
    };
  }

  return next;
};

const readPeers = (awareness: Awareness, selfId: number): AwarenessPeer[] => {
  const peers: AwarenessPeer[] = [];
  awareness.getStates().forEach((state: any, clientId) => {
    if (clientId === selfId) return;
    if (!state?.user) return;
    const sanitized = sanitizePayload({
      user: state.user,
      editing: state.editing,
      cursor: state.cursor,
      ts: state.ts ?? Date.now(),
    });
    peers.push({ clientId, ...sanitized });
  });
  return peers;
};

export function AwarenessProvider({ awareness, children }: { awareness: Awareness | null; children: React.ReactNode }) {
  const [localUser] = useState<AwarenessUser>(() => createMockUser());
  const [peers, setPeers] = useState<AwarenessPeer[]>([]);
  const localStateRef = useRef<AwarenessPayload>({ user: localUser, ts: Date.now() });

  const pushLocalState = useCallback(
    (next: AwarenessPayload) => {
      localStateRef.current = sanitizePayload({ ...next, ts: Date.now() });
      awareness?.setLocalState(localStateRef.current);
    },
    [awareness],
  );

  const getLocalState = useCallback(() => localStateRef.current, []);

  const updateLocalState = useCallback(
    (updater: (prev: AwarenessPayload) => AwarenessPayload) => {
      const next = updater(localStateRef.current);
      pushLocalState(next);
    },
    [pushLocalState],
  );

  const setEditingState = useCallback(
    (editing: AwarenessEditingState | null) => {
      updateLocalState((prev) => {
        const next = { ...prev };
        if (editing) next.editing = editing;
        else delete next.editing;
        return next;
      });
    },
    [updateLocalState],
  );

  const setCursorState = useCallback(
    (cursor: AwarenessCursorState | null) => {
      updateLocalState((prev) => {
        const next = { ...prev };
        if (cursor) next.cursor = cursor;
        else delete next.cursor;
        return next;
      });
    },
    [updateLocalState],
  );

  useEffect(() => {
    if (!awareness) return undefined;

    awareness.setLocalState(localStateRef.current);
    const syncPeers = () => {
      setPeers(readPeers(awareness, awareness.clientID));
    };

    syncPeers();
    awareness.on("change", syncPeers);

    const hasWindow = typeof window !== "undefined";
    const handleUnload = () => {
      try {
        awareness.setLocalState(null);
      } catch {}
    };
    if (hasWindow) window.addEventListener("beforeunload", handleUnload);

    return () => {
      awareness.off("change", syncPeers);
      if (hasWindow) window.removeEventListener("beforeunload", handleUnload);
      try {
        awareness.setLocalState(null);
      } catch {}
      setPeers([]);
    };
  }, [awareness]);

  const value = useMemo<AwarenessContextValue>(
    () => ({
      awareness,
      localUser,
      peers,
      updateLocalState,
      setEditingState,
      setCursorState,
      getLocalState,
    }),
    [awareness, localUser, peers, updateLocalState, setEditingState, setCursorState, getLocalState],
  );

  return <AwarenessContext.Provider value={value}>{children}</AwarenessContext.Provider>;
}

export function useAwarenessContext(): AwarenessContextValue {
  const ctx = useContext(AwarenessContext);
  if (!ctx) throw new Error("useAwarenessContext must be used inside AwarenessProvider");
  return ctx;
}

export function useCellPeers(cellId?: string) {
  const { peers } = useAwarenessContext();
  return useMemo(() => {
    if (!cellId) return [];
    return peers.filter((peer) => peer.editing?.cellId === cellId);
  }, [peers, cellId]);
}

export function useOptionalAwarenessContext() {
  return useContext(AwarenessContext);
}
