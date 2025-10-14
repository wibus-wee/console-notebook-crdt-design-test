import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useNotebookAtoms, useNotebookStatus, useNotebookYjs } from "@/providers/NotebookProvider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { cn } from "@/lib/utils";
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

const EMPTY_PLACEHOLDER = "—";
const POSITION_STORAGE_KEY = "notebook-dev-panel-position";

interface Position {
  x: number;
  y: number;
}

export function NotebookDevPanel() {
  const status = useNotebookStatus();
  const notebook = useNotebookAtoms();
  const { notebook: nb, doc, traffic } = useNotebookYjs();
  const snapshot = useAtomValue(notebook.snapshotAtom);
  const [open, setOpen] = useState(true);

  // Load initial position from localStorage or use default
  const [position, setPosition] = useState<Position>(() => {
    try {
      const saved = localStorage.getItem(POSITION_STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Failed to load panel position:", e);
    }
    return { x: window.innerWidth - 696, y: 16 }; // default: right-4 bottom-4 equivalent
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  if (!import.meta.env.DEV) {
    return null;
  }

  // Save position to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
    } catch (e) {
      console.warn("Failed to save panel position:", e);
    }
  }, [position]);

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only start drag from the header area
    if ((e.target as HTMLElement).closest("[data-drag-handle]")) {
      e.preventDefault();
      setIsDragging(true);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initialX: position.x,
        initialY: position.y,
      };
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !dragRef.current) return;

      const deltaX = e.clientX - dragRef.current.startX;
      const deltaY = e.clientY - dragRef.current.startY;

      const newX = dragRef.current.initialX + deltaX;
      const newY = dragRef.current.initialY + deltaY;

      // Constrain position to viewport with some padding
      const panelWidth = panelRef.current?.offsetWidth || 680;
      const panelHeight = panelRef.current?.offsetHeight || 400;
      const padding = 16;

      const constrainedX = Math.max(
        padding,
        Math.min(newX, window.innerWidth - panelWidth - padding)
      );
      const constrainedY = Math.max(
        padding,
        Math.min(newY, window.innerHeight - panelHeight - padding)
      );

      setPosition({ x: constrainedX, y: constrainedY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      // Prevent text selection while dragging
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

  const report = useMemo(() => {
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

  const renderStringList = (items: string[]) => {
    if (!items.length) return EMPTY_PLACEHOLDER;
    return items.join(", ");
  };

  return (
    <div
      ref={panelRef}
      className="fixed z-50"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {open ? (
        <Card
          className={cn(
            "w-[680px] max-h-[70vh] overflow-hidden border-border/80 bg-background/95 backdrop-blur shadow-lg transition-all duration-300 ease-out animate-in fade-in slide-in-from-top-2",
            isDragging && "shadow-2xl ring-2 ring-primary/50"
          )}
          onMouseDown={handleMouseDown}
        >
          <CardHeader className="pb-4 relative">
            <div
              data-drag-handle
              className="absolute inset-0 cursor-grab active:cursor-grabbing"
              title="Drag to move panel"
            />
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 relative z-10 pointer-events-none">
                <CardTitle className="flex items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4 h-4 opacity-50"
                  >
                    <circle cx="9" cy="5" r="1" />
                    <circle cx="9" cy="12" r="1" />
                    <circle cx="9" cy="19" r="1" />
                    <circle cx="15" cy="5" r="1" />
                    <circle cx="15" cy="12" r="1" />
                    <circle cx="15" cy="19" r="1" />
                  </svg>
                  Notebook Dev Panel
                </CardTitle>
                <CardDescription className="mt-1.5">
                  Status: {status}. Doc {doc.guid} · Client {doc.clientID}
                </CardDescription>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                }}
                className="relative z-20 pointer-events-auto rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                title="Minimize panel"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4"
                >
                  <path d="M19 12H5" />
                </svg>
              </button>
            </div>
          </CardHeader>
          <CardContent className="overflow-y-auto pb-4 pr-3">
            <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
              <div className="space-y-4">
                <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notebook</h4>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <StatTile label="Order" value={report.orderLength} />
                <StatTile label="Cells" value={report.cellCount} />
                <StatTile label="Tombstones" value={report.tombstoneCount} />
                <StatTile label="Snapshot Cells" value={Object.keys(snapshot.cells).length} />
              </div>
              <div className="mt-3 text-[10px] text-muted-foreground">
                Title: <span className="font-mono text-foreground">{snapshot.title}</span>
              </div>
                </section>

                <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reconcile Preview</h4>
              <div className="mt-2 space-y-2 text-xs">
                <div className="rounded-lg border border-border/60 bg-muted/40 p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">Would Change</span>
                    <span className={cn("font-mono", report.reconcile.wouldChange ? "text-amber-500" : "text-muted-foreground")}> 
                      {report.reconcile.wouldChange ? "Yes" : "No"}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <div className="text-muted-foreground">Delete Ops</div>
                      <div className="font-mono">{report.reconcile.deleteRanges?.length ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Orphans</div>
                      <div className="font-mono">{report.reconcile.orphans.length}</div>
                    </div>
                  </div>
                </div>

                {report.reconcile.deleteRanges.length > 0 && (
                  <div>
                    <div className="text-[11px] font-medium text-foreground">Delete Ranges</div>
                    <ul className="mt-1 space-y-1 text-[10px] font-mono">
                      {report.reconcile.deleteRanges.map((range, idx) => (
                        <li key={`${range.start}-${range.len}-${idx}`} className="rounded bg-muted/60 px-2 py-1">
                          [{range.start} → {range.start + range.len - 1}] · len {range.len}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <div className="text-[11px] font-medium text-foreground">Orphans to Append</div>
                  <p className="mt-1 text-[10px] font-mono text-muted-foreground">
                    {renderStringList(report.reconcile.orphans)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <InfoList title="Missing" items={report.reconcile.classification.removedMissingFromMap} />
                  <InfoList title="Tombstoned" items={report.reconcile.classification.removedTombstoned} />
                  <InfoList title="Duplicates" items={report.reconcile.classification.removedDuplicates} />
                  <InfoList title="Invalid" items={report.reconcile.classification.removedInvalid} />
                </div>
                </div>
              </section>

                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Validation</h4>
              {report.validationIssues.length === 0 ? (
                <p className="mt-2 text-[11px] text-emerald-500">No issues detected.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {report.validationIssues.map((issue, idx) => (
                    <li
                      key={`${issue.path}-${idx}`}
                      className={cn(
                        "rounded border px-2 py-1 text-[11px] leading-snug",
                        issue.level === "error"
                          ? "border-destructive/60 text-destructive"
                          : "border-amber-500/60 text-amber-500"
                      )}
                    >
                      <div className="font-mono">{issue.path}</div>
                      <div>{issue.message}</div>
                    </li>
                  ))}
                </ul>
                )}
              </section>
              </div>

              <div className="space-y-4">
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live Traffic</h4>
                  <div className="mt-2 space-y-2 text-[10px]">
                    {traffic.length === 0 ? (
                      <p className="text-muted-foreground">No events yet.</p>
                    ) : (
                      <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                        {[...traffic]
                          .reverse()
                          .map((entry) => (
                            <li
                              key={entry.id}
                              className="rounded border border-border/50 bg-muted/40 px-2 py-1"
                            >
                              <div className="flex items-center justify-between">
                                <span
                                  className={cn(
                                    "font-semibold",
                                    entry.direction === "incoming"
                                      ? "text-emerald-500"
                                      : "text-sky-500"
                                  )}
                                >
                                  {entry.direction === "incoming" ? "← incoming" : "→ outgoing"}
                                </span>
                                <span className="font-mono text-muted-foreground">
                                  {formatClock(entry.ts)}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center justify-between">
                                <span className="font-medium text-foreground">{entry.type}</span>
                                {typeof entry.size === "number" && (
                                  <span className="font-mono text-muted-foreground">{entry.size} bytes</span>
                                )}
                              </div>
                              <p className="mt-1 font-mono text-[10px] text-foreground">
                                {entry.details || EMPTY_PLACEHOLDER}
                              </p>
                              {entry.preview && (
                                <p className="font-mono text-[9px] text-muted-foreground">
                                  {entry.preview}
                                </p>
                              )}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                </section>

                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Order Trace</h4>
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-mono">
                    {snapshot.order.length === 0 ? (
                      <span className="text-muted-foreground">{EMPTY_PLACEHOLDER}</span>
                    ) : (
                      snapshot.order.map((id) => (
                        <span key={id} className="rounded bg-muted/60 px-2 py-1 text-foreground">
                          {id}
                        </span>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className={cn(
            "group relative rounded-lg border border-border/80 bg-background/95 backdrop-blur p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105",
            "flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          )}
          title="Open Dev Panel"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
          >
            <circle cx="9" cy="5" r="1" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="5" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="19" r="1" />
          </svg>
          <span className="text-xs">Dev</span>
          <div className="absolute -right-1 -top-1 w-2 h-2 rounded-full bg-primary animate-pulse" />
        </button>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function InfoList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-foreground">{title}</div>
      <p className="mt-1 min-h-[20px] text-[10px] font-mono text-muted-foreground">
        {items.length ? items.join(", ") : EMPTY_PLACEHOLDER}
      </p>
    </div>
  );
}

function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
