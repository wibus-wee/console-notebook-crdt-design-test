import { useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { DotsGridIcon } from "./icons";
import { OverviewTab } from "./OverviewTab";
import { PanelHeader } from "./PanelHeader";
import { StructureTab } from "./StructureTab";
import { TabBar } from "./TabBar";
import { TrafficTab } from "./TrafficTab";
import { UndoHistoryTab } from "./UndoHistoryTab";
import { ValidationTab } from "./ValidationTab";
import { useResizablePanel } from "./hooks";
import type { NotebookReport } from "./hooks";
import type { YNotebook } from "@/yjs/schema/core/types";
import type { Doc as YDoc } from "yjs";
import type { UndoHistorySnapshot } from "@/yjs/undo/notebookUndoHistory";
import type { UndoManager } from "yjs";
import { AwarenessTab } from "./AwarenessTab";

export type NotebookStatus = "connecting" | "connected" | "disconnected";

export type AwarenessSelectionRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export type AwarenessEditingState = {
  cellId?: string;
  isMonaco?: boolean;
  origin?: string;
};

export type AwarenessCursorState = {
  cellId?: string;
  selections: AwarenessSelectionRange[];
};

export type AwarenessUser = {
  id: string;
  name: string;
  color: string;
  avatarSeed: string;
};

export type AwarenessPresence = {
  clientId: number;
  user: AwarenessUser;
  editing?: AwarenessEditingState;
  cursor?: AwarenessCursorState;
  ts: number;
};

export type AwarenessPanelData = {
  self?: AwarenessPresence;
  peers: AwarenessPresence[];
};

export type DevPanelTrafficEntry = {
  id: number;
  ts: number;
  type: "update" | "awareness";
  direction: "incoming" | "outgoing";
  size?: number;
  details: string;
  preview?: string;
  decoded?: {
    structs: Array<{
      index: number;
      type: string;
      summary: string;
      details?: string[];
    }>;
    deletes: Array<{
      client: number;
      clock: number;
      len: number;
    }>;
  };
};

export type NotebookDevPanelProps = {
  notebook: YNotebook;
  doc: YDoc;
  status: NotebookStatus;
  report: NotebookReport;
  undoHistory: UndoHistorySnapshot;
  undoManager: Pick<UndoManager, "undo" | "redo" | "stopCapturing" | "clear">;
  traffic?: DevPanelTrafficEntry[];
  awareness?: AwarenessPanelData;
  resizableStorageKey?: string;
  defaultSize?: { width: number; height: number };
  defaultOpen?: boolean;
  isDev?: boolean;
};

export function NotebookDevPanel({
  notebook,
  doc,
  status,
  report,
  undoHistory,
  undoManager,
  traffic = [],
  awareness,
  resizableStorageKey = "notebook-dev-panel-size",
  defaultSize = { width: 720, height: 420 },
  defaultOpen = true,
  isDev = import.meta.env.DEV,
}: NotebookDevPanelProps) {
  const { size, handleResizeStart, isResizing } = useResizablePanel(resizableStorageKey, defaultSize);
  const [open, setOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState("overview");

  if (!isDev) return null;

  return (
    <div
      className="fixed right-4 bottom-4 z-50 flex flex-col"
      style={open ? { width: size.width, height: size.height } : undefined}
    >
      {open ? (
        <Card
          className={cn(
            "relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/70 bg-background/95 shadow-lg backdrop-blur",
            isResizing && "select-none"
          )}
        >
          <PanelHeader onClose={() => setOpen(false)} status={status} doc={doc} />
          <TabBar activeTab={activeTab} onChange={setActiveTab} />
          <CardContent className="flex-1 overflow-hidden p-4 pb-8">
            <div className="h-full overflow-y-auto">
              {activeTab === "overview" && <OverviewTab report={report} />}
              {activeTab === "structure" && <StructureTab nb={notebook} doc={doc} />}
              {activeTab === "awareness" && <AwarenessTab data={awareness} />}
              {activeTab === "undo" && <UndoHistoryTab history={undoHistory} undoManager={undoManager} />}
              {activeTab === "traffic" && <TrafficTab traffic={traffic} />}
              {activeTab === "validation" && <ValidationTab issues={report.validationIssues} />}
            </div>
          </CardContent>
          <div
            onMouseDown={handleResizeStart}
            role="presentation"
            className="absolute bottom-1 left-1 h-4 w-4 cursor-nwse-resize rounded-sm border border-border/40 bg-muted/50"
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
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/95 p-3 shadow transition-all hover:shadow-lg backdrop-blur"
        >
          <DotsGridIcon className="h-4 w-4 opacity-70" />
          <span className="text-xs font-medium">Dev</span>
        </button>
      )}
    </div>
  );
}
