import { useMemo } from "react";
import { useAtomValue } from "jotai";
import type { NotebookAtoms } from "@/yjs/jotai/notebookAtoms";
import { useCellPeers } from "@/providers/AwarenessProvider";
import type { NotebookCellAtoms } from "@/yjs/jotai/notebookAtoms";
import { SqlCellEditor } from "./SqlCellEditor";
import { MarkdownCellEditor } from "./MarkdownCellEditor";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface NotebookCellProps {
  notebook: NotebookAtoms;
  cellId: string;
  index: number;
  total: number;
}

export const NotebookCell = ({ notebook, cellId, index, total }: NotebookCellProps) => {
  const cellAtoms = useMemo<NotebookCellAtoms>(() => notebook.getCellAtoms(cellId), [notebook, cellId]);
  const kind = useAtomValue(cellAtoms.kindAtom);
  const peers = useCellPeers(cellId);
  const editingPeers = useMemo(
    () =>
      peers.map((peer) => {
        const name = peer.user.name || "Anonymous";
        const initials = name
          .split(/\s+/)
          .filter(Boolean)
          .map((part) => part[0]?.toUpperCase() ?? "")
          .join("")
          .slice(0, 2) || "•";
        return {
          id: peer.clientId,
          name,
          color: peer.user.color,
          initials,
        };
      }),
    [peers],
  );
  const maxVisiblePeers = 3;
  const visiblePeers = editingPeers.slice(0, maxVisiblePeers);
  const overflowCount = Math.max(editingPeers.length - maxVisiblePeers, 0);
  const editingNames = visiblePeers.map((peer) => peer.name.split(" ")[0] ?? peer.name);
  const labelText =
    editingPeers.length === 0
      ? ""
      : `Editing: ${editingPeers.map((peer) => peer.name).join(", ")}`;
  const summaryText =
    editingPeers.length === 0
      ? ""
      : `Editing: ${editingNames.join(", ")}${overflowCount > 0 ? ` +${overflowCount}` : ""}`;
  const isFirst = index === 0;
  const isLast = index === total - 1;

  const handleRemove = () => {
    notebook.actions.removeCell(cellId);
  };

  const handleMoveUp = () => {
    if (!isFirst) {
      notebook.actions.moveCell(cellId, index - 1);
    }
  };

  const handleMoveDown = () => {
    if (!isLast) {
      notebook.actions.moveCell(cellId, index + 1);
    }
  };

  return (
    <Card className="group animate-slide-up">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="flex flex-col gap-3">
          {/* Cell Type Badge */}
          <div className="flex items-center gap-2">
            <Badge variant={kind === "sql" ? "accent" : "secondary"}>
              {kind === "markdown" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
              )}
              <span className="font-semibold">{kind === "markdown" ? "Markdown" : "SQL"}</span>
            </Badge>

            <span className="text-xs text-muted-foreground">Cell {index + 1}</span>

            {/* Collaboration Indicator */}
            {editingPeers.length > 0 && (
              <div
                className="flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-xs font-medium text-accent"
                aria-label={labelText}
                title={labelText}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-80"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                <div className="flex -space-x-2">
                  {visiblePeers.map((peer) => (
                    <div
                      key={peer.id}
                      className="flex h-5 w-5 items-center justify-center rounded-full border border-background text-[0.625rem] font-semibold uppercase text-white shadow-sm"
                      style={{ backgroundColor: peer.color }}
                    >
                      {peer.initials}
                    </div>
                  ))}
                  {overflowCount > 0 && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full border border-accent/30 bg-accent/20 text-[0.625rem] font-semibold text-accent shadow-sm">
                      +{overflowCount}
                    </div>
                  )}
                </div>
                <span className="max-w-[140px] truncate">{summaryText}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 opacity-40 transition-opacity group-hover:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            onClick={handleMoveUp}
            disabled={isFirst}
            className="h-8 w-8 hover:bg-muted"
            title="Move up (Alt+Up)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleMoveDown}
            disabled={isLast}
            className="h-8 w-8 hover:bg-muted"
            title="Move down (Alt+Down)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleRemove}
            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            title="Delete cell (Backspace)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {kind === "markdown" ? (
          <MarkdownCellEditor cellAtoms={cellAtoms} />
        ) : (
          <SqlCellEditor cellAtoms={cellAtoms} />
        )}
      </CardContent>
    </Card>
  );
};
