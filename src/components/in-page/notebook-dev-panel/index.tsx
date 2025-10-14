import { useState } from "react";
import { useAtomValue } from "jotai";
import { Card, CardContent } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import {
  useNotebookAtoms,
  useNotebookStatus,
  useNotebookYjs,
} from "@/providers/NotebookProvider";
import { DotsGridIcon } from "./icons";
import { OverviewTab } from "./OverviewTab";
import { PanelHeader } from "./PanelHeader";
import { StructureTab } from "./StructureTab";
import { TabBar } from "./TabBar";
import { TrafficTab } from "./TrafficTab";
import { UndoHistoryTab } from "./UndoHistoryTab";
import { ValidationTab } from "./ValidationTab";
import { useNotebookReport, useResizablePanel } from "./hooks";
import { AwarenessTab } from "./AwarenessTab";

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
              {activeTab === "overview" && <OverviewTab report={report} />}
              {activeTab === "structure" && <StructureTab nb={nb} doc={doc} />}
              {activeTab === "awareness" && <AwarenessTab />}
              {activeTab === "undo" && <UndoHistoryTab />}
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
