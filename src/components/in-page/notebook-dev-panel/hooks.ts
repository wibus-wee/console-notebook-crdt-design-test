import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { YNotebook } from "@/yjs/schema/core/types";
import type { NotebookSnapshot } from "@/yjs/jotai/notebook/snapshot";
import {
  buildTombstoneSet,
  classifyOrderEntries,
  findOrphansToAppend,
  mergeDeleteIndexesToRanges,
  resolveReconcileOptions,
} from "@/yjs/schema/quality/reconcile";
import { validateNotebook } from "@/yjs/schema/quality/validation";
import { getCellMap, getOrder } from "@/yjs/schema/access/accessors";
import { tombstonesMap } from "@/yjs/schema/access/tombstone";

export type PanelSize = {
  width: number;
  height: number;
};

type LocalStorageOptions<T> = {
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
};

export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  options: LocalStorageOptions<T> = {}
): [T, Dispatch<SetStateAction<T>>] {
  const { serialize = JSON.stringify, deserialize = JSON.parse } = options;
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") {
      return defaultValue;
    }
    try {
      const saved = window.localStorage.getItem(key);
      return saved ? (deserialize(saved) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(key, serialize(state));
    } catch {}
  }, [key, serialize, state]);

  return [state, setState];
}

type ResizerState = {
  startX: number;
  startY: number;
  initialWidth: number;
  initialHeight: number;
};

export function useResizablePanel(storageKey: string, defaultSize: PanelSize) {
  const [size, setSize] = useLocalStorageState<PanelSize>(storageKey, defaultSize);
  const resizerRef = useRef<ResizerState | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizerRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      initialWidth: size.width,
      initialHeight: size.height,
    };
    setIsResizing(true);
  }, [size.height, size.width]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const MIN_WIDTH = 480;
    const MIN_HEIGHT = 320;

    const handleMouseMove = (event: MouseEvent) => {
      if (!resizerRef.current) {
        return;
      }
      const { startX, startY, initialWidth, initialHeight } = resizerRef.current;
      const deltaX = event.clientX - startX;
      const deltaY = startY - event.clientY;
      const nextWidth = Math.max(MIN_WIDTH, initialWidth + deltaX);
      const nextHeight = Math.max(MIN_HEIGHT, initialHeight + deltaY);
      setSize({ width: nextWidth, height: nextHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizerRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "nwse-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing, setSize]);

  return { size, handleResizeStart, isResizing };
}

export function useNotebookReport(nb: YNotebook, snapshot: NotebookSnapshot) {
  return useMemo(() => {
    const orderArr = getOrder(nb).toArray();
    const map = getCellMap(nb);
    const tomb = tombstonesMap(nb);
    const tombSet = buildTombstoneSet(tomb);
    const options = resolveReconcileOptions();
    const classification = classifyOrderEntries(orderArr, options, (id) => map.has(id), tombSet);
    const keptSet = new Set(classification.kept);
    const orphans = findOrphansToAppend(map, keptSet, tombSet, options);
    const deleteRanges = mergeDeleteIndexesToRanges(classification.indexesToDelete);
    const validationIssues = validateNotebook(nb);

    return {
      orderLength: orderArr.length,
      cellCount: map.size,
      tombstoneCount: tombSet.size,
      snapshotCount: Object.keys(snapshot.cells).length,
      reconcile: {
        options,
        classification,
        orphans,
        deleteRanges,
        wouldChange: deleteRanges.length > 0 || orphans.length > 0,
      },
      validationIssues,
    };
  }, [snapshot, nb]);
}

export type NotebookReport = ReturnType<typeof useNotebookReport>;
