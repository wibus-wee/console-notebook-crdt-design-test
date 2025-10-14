import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import { useAtomValue } from "jotai";
import { useNotebookAtoms, useNotebookStatus, useNotebookYjs } from "@/providers/NotebookProvider";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
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
import { YjsTreeViewer } from "./YjsTreeViewer";

/** Utility Hooks **/
type LocalStorageOptions<T> = {
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
};

function useLocalStorageState<T>(
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

type PanelSize = {
  width: number;
  height: number;
};

type ResizerState = {
  startX: number;
  startY: number;
  initialWidth: number;
  initialHeight: number;
};

function useResizablePanel(storageKey: string, defaultSize: PanelSize) {
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

function useNotebookReport(nb, snapshot) {
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
      reconcile: { options, classification, orphans, deleteRanges, wouldChange: deleteRanges.length > 0 || orphans.length > 0 },
      validationIssues,
    };
  }, [snapshot, nb]);
}

type PanelHeaderProps = {
  onClose: () => void;
  status: ReturnType<typeof useNotebookStatus>;
  doc: ReturnType<typeof useNotebookYjs>["doc"];
};

function PanelHeader({ onClose, status, doc }: PanelHeaderProps) {
  const metaItems = [
    { label: "Status", value: String(status ?? "unknown"), accent: true },
    { label: "Doc", value: String(doc.guid ?? "unknown") },
    { label: "Client", value: String(doc.clientID) },
  ];

  return (
    <div
      className={cn(
        "relative flex items-center justify-between border-b border-border/50",
        "bg-gradient-to-r from-emerald-500/10 via-muted/20 to-background/95 px-4 py-3",
        "dark:border-border/60 dark:from-emerald-500/15 dark:via-muted/40 dark:to-background/80",
        "shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.08)] dark:shadow-none"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span>Notebook Dev Panel</span>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-500/15 dark:text-emerald-200">Dev</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase text-muted-foreground/80">
            {metaItems.map((item) => (
              <span
                key={item.label}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 tracking-[0.15em]",
                  item.accent
                    ? "border-emerald-500/40 bg-emerald-100 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-200"
                    : "border-border/60 bg-background/80 text-muted-foreground dark:bg-background/60"
                )}
              >
                <span>{item.label}</span>
                <span className="font-normal tracking-normal">{item.value}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          title="Minimize"
          onClick={onClose}
          className="rounded-md border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border/60 hover:bg-background/80 hover:text-emerald-600 dark:hover:text-emerald-200"
        >
          <MinusIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}


function TabBar({ activeTab, onChange }) {
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "structure", label: "Structure" },
    { id: "traffic", label: "Traffic" },
    { id: "validation", label: "Validation" },
  ];
  return (
    <div className="flex border-b border-border/70 text-xs bg-muted/30">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "px-4 py-2 transition-colors",
            activeTab === tab.id
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="rounded border border-border/50 bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function OverviewTab({ report, snapshot }) {
  return (
    <div className="space-y-6">
      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Notebook Stats</h4>
        <div className="grid grid-cols-4 gap-2">
          <StatTile label="Order" value={report.orderLength} />
          <StatTile label="Cells" value={report.cellCount} />
          <StatTile label="Tombstones" value={report.tombstoneCount} />
          <StatTile label="Snapshot" value={report.snapshotCount} />
        </div>
      </section>

      <section>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Reconcile Preview</h4>
        <div className="rounded border border-border/50 bg-muted/30 p-3 text-xs">
          <div className="flex justify-between">
            <span>Would Change</span>
            <span className={report.reconcile.wouldChange ? "text-amber-500" : "text-muted-foreground"}>
              {report.reconcile.wouldChange ? "Yes" : "No"}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>Delete Ops: {report.reconcile.deleteRanges.length}</div>
            <div>Orphans: {report.reconcile.orphans.length}</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function StructureTab({ nb, doc }) {
  return (
    <div className="p-2 border border-border/50 bg-muted/30 rounded">
      <YjsTreeViewer notebook={nb} doc={doc} />
    </div>
  );
}

function TrafficTab({ traffic }) {
  return (
    <ul className="space-y-2 text-xs">
      {[...traffic].reverse().map((entry) => (
        <li key={entry.id} className="rounded border border-border/50 bg-muted/30 p-2">
          {/* Header */}
          <div className="flex justify-between text-muted-foreground">
            <span>
              {entry.direction === "incoming" ? "← Incoming" : "→ Outgoing"}
            </span>
            <span>{new Date(entry.ts).toLocaleTimeString()}</span>
          </div>

          {/* Type */}
          <div className="font-mono text-foreground mt-1">{entry.type}</div>

          {/* Details */}
          {entry.details && (
            <p className="text-muted-foreground mt-1 font-mono break-words">
              {entry.details}
            </p>
          )}

          {/* Preview */}
          {entry.preview && (
            <p className="mt-1 text-[11px] text-muted-foreground font-mono">
              {entry.preview}
            </p>
          )}

          {/* Decoded update details */}
          {entry.decoded && entry.type === "update" && (
            <details
              className="mt-2 rounded border border-border/40 bg-background/80 px-2 py-2"
              open={entry.decoded.structs.length <= 12}
            >
              <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Decoded Update · {entry.decoded.structs.length} structs
                {entry.decoded.deletes.length > 0
                  ? ` · deletes ${entry.decoded.deletes.length}`
                  : ""}
              </summary>

              <div className="mt-2 space-y-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Structs
                  </div>
                  <ul className="mt-1 space-y-1">
                    {entry.decoded.structs.map((struct) => (
                      <li
                        key={`${struct.index}-${struct.summary}`}
                        className="rounded border border-border/30 bg-muted/60 px-2 py-1"
                      >
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="font-mono">#{struct.index}</span>
                          <span className="font-semibold text-foreground">
                            {struct.type}
                          </span>
                        </div>
                        <p className="mt-1 break-words font-mono text-[10px] text-foreground">
                          {struct.summary}
                        </p>
                        {struct.details?.map((line, idx) => (
                          <p
                            key={`${struct.index}-${idx}`}
                            className="break-words font-mono text-[10px] text-muted-foreground"
                          >
                            {line}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>

                {entry.decoded.deletes.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Delete Set
                    </div>
                    <div className="mt-1 grid gap-1">
                      {entry.decoded.deletes.map((del, idx) => (
                        <span
                          key={`${del.client}-${del.clock}-${idx}`}
                          className="font-mono text-[10px] text-muted-foreground"
                        >
                          client:{del.client} · clock:{del.clock} · len:{del.len}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}


function ValidationTab({ issues }) {
  if (issues.length === 0)
    return <p className="text-xs text-emerald-500">No validation issues.</p>;
  return (
    <ul className="space-y-1 text-xs">
      {issues.map((i, idx) => (
        <li key={idx} className={cn("rounded border p-2", i.level === "error" ? "border-red-500 text-red-500" : "border-amber-500 text-amber-500")}> 
          <div className="font-mono">{i.path}</div>
          <div>{i.message}</div>
        </li>
      ))}
    </ul>
  );
}

export function NotebookDevPanel() {
  const { notebook: nb, doc, traffic } = useNotebookYjs();
  const notebook = useNotebookAtoms();
  const snapshot = useAtomValue(notebook.snapshotAtom);
  const status = useNotebookStatus();
  const { size, handleResizeStart, isResizing } = useResizablePanel("notebook-dev-panel-size", { width: 720, height: 420 });
  const [open, setOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const report = useNotebookReport(nb, snapshot);

  if (!import.meta.env.DEV) return null;

  return (
    <div
      className="fixed right-4 bottom-4 z-50 flex flex-col"
      style={open ? { width: size.width, height: size.height } : undefined}
    >
      {open ? (
        <Card
          className={cn(
            "relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/70 bg-background/50 shadow-lg backdrop-blur",
            isResizing && "select-none"
          )}
        >
          <PanelHeader onClose={() => setOpen(false)} status={status} doc={doc} />
          <TabBar activeTab={activeTab} onChange={setActiveTab} />
          <CardContent className="flex-1 overflow-hidden p-4 pb-8">
            <div className="h-full overflow-y-auto">
              {activeTab === "overview" && <OverviewTab report={report} snapshot={snapshot} />}
              {activeTab === "structure" && <StructureTab nb={nb} doc={doc} />}
              {activeTab === "traffic" && <TrafficTab traffic={traffic} />}
              {activeTab === "validation" && <ValidationTab issues={report.validationIssues} />}
            </div>
          </CardContent>
          <div
            onMouseDown={handleResizeStart}
            role="presentation"
            className="absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize rounded-sm border border-border/40 bg-muted/50"
          >
            <svg
              aria-hidden
              viewBox="0 0 8 8"
              className="h-full w-full text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.8"
              strokeLinecap="round"
            >
              <path d="M0 8 L8 0" />
              <path d="M2 8 L8 2" />
              <path d="M4 8 L8 4" />
            </svg>
          </div>
        </Card>
      ) : (
        <button onClick={() => setOpen(true)} className="rounded-lg border border-border/70 bg-background/95 backdrop-blur p-3 flex items-center gap-2 shadow hover:shadow-lg transition-all">
          <DotsGridIcon className="w-4 h-4 opacity-70" />
          <span className="text-xs font-medium">Dev</span>
        </button>
      )}
    </div>
  );
}

function DotsGridIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="9" cy="5" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="19" r="1" />
      <circle cx="15" cy="5" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="19" r="1" />
    </svg>
  );
}

function MinusIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M19 12H5" />
    </svg>
  );
}
