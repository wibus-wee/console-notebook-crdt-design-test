import { useState, useRef, useMemo, useEffect, useCallback } from "react";
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
function useLocalStoragePosition(key, defaultPos) {
  const [position, setPosition] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : defaultPos;
    } catch {
      return defaultPos;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(position));
    } catch {}
  }, [key, position]);
  return [position, setPosition];
}

function useDraggablePanel(storageKey) {
  const [position, setPosition] = useLocalStoragePosition(storageKey, { x: window.innerWidth - 760, y: 16 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef(null);
  const panelRef = useRef(null);

  const handleMouseDown = useCallback((e) => {
    if ((e.target.closest("[data-drag-handle]"))) {
      e.preventDefault();
      setIsDragging(true);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialX: position.x,
        initialY: position.y,
      };
    }
  }, [position]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging || !dragRef.current) return;
      const { startX, startY, initialX, initialY } = dragRef.current;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      const newX = initialX + deltaX;
      const newY = initialY + deltaY;
      const panelWidth = panelRef.current?.offsetWidth || 720;
      const panelHeight = panelRef.current?.offsetHeight || 400;
      const padding = 16;
      const constrainedX = Math.max(padding, Math.min(newX, window.innerWidth - panelWidth - padding));
      const constrainedY = Math.max(padding, Math.min(newY, window.innerHeight - panelHeight - padding));
      setPosition({ x: constrainedX, y: constrainedY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging, position]);

  return { position, setPosition, isDragging, handleMouseDown, panelRef };
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

function PanelHeader({ onClose, status, doc }) {
  return (
    <div
      data-drag-handle
      className={cn(
        "flex items-center justify-between border-b border-border/60 bg-muted/30 backdrop-blur-sm",
        "px-4 py-3 select-none"
      )}
    >
      {/* 左侧标题区域 */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <DotsGridIcon className="w-4 h-4 opacity-60" />
          <span>Notebook Dev Panel</span>
        </div>
        <div className="text-[11px] text-muted-foreground font-mono">
          Status: <span className="text-foreground/90">{status}</span> ·{" "}
          Doc <span className="text-foreground/80">{doc.guid}</span> · Client{" "}
          <span className="text-foreground/80">{doc.clientID}</span>
        </div>
      </div>

      {/* 右侧控制区 */}
      <div className="flex items-center gap-2">
        <button
          title="Minimize"
          onClick={onClose}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
        >
          <MinusIcon className="w-4 h-4" />
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
              defaultOpen={entry.decoded.structs.length <= 12}
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
  const { position, handleMouseDown, panelRef } = useDraggablePanel("notebook-dev-panel-pos");
  const [open, setOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const report = useNotebookReport(nb, snapshot);

  if (!import.meta.env.DEV) return null;

  return (
    <div ref={panelRef} style={{ left: position.x, top: position.y }} className="fixed z-50">
      {open ? (
        <Card onMouseDown={handleMouseDown} className="w-[720px] max-h-[75vh] overflow-hidden bg-background/95 backdrop-blur border border-border/70 shadow-lg rounded-xl">
          <PanelHeader onClose={() => setOpen(false)} status={status} doc={doc} />
          <TabBar activeTab={activeTab} onChange={setActiveTab} />
          <CardContent className="p-4 max-h-[calc(75vh-80px)] overflow-y-auto pb-8">
            {activeTab === "overview" && <OverviewTab report={report} snapshot={snapshot} />}
            {activeTab === "structure" && <StructureTab nb={nb} doc={doc} />}
            {activeTab === "traffic" && <TrafficTab traffic={traffic} />}
            {activeTab === "validation" && <ValidationTab issues={report.validationIssues} />}
          </CardContent>
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
