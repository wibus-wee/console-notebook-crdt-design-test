import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import type { NotebookCellAtoms } from "@/yjs/jotai/notebookAtoms";
import { useNotebookAtoms, useNotebookYjs, useNotebookUndoManager } from "@/providers/NotebookProvider";
import { CollaborativeMonacoEditor } from "@/components/collaborative-monaco-editor";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { startExecuteCell, applyExecuteResultForCurrentRun } from "@/yjs/schema/ops/execute";
import type { QueryResponse } from "@/yjs/api-gen-type";

interface SqlCellEditorProps {
  cellAtoms: NotebookCellAtoms;
}

export const SqlCellEditor = ({ cellAtoms }: SqlCellEditorProps) => {
  const { actions, getCellYText } = useNotebookAtoms();
  const { notebook } = useNotebookYjs();
  const undoManager = useNotebookUndoManager();
  const cellId = useAtomValue(cellAtoms.idAtom);
  const source = useAtomValue(cellAtoms.sourceAtom);
  const metadata = useAtomValue(cellAtoms.metadataAtom);
  const output = useAtomValue(cellAtoms.outputAtom);
  const isRunning = output?.running ?? false;
  const hasRun = typeof output?.completedAt === "number";
  const isStale = output?.stale ?? false;
  const editorRef = useRef<HTMLDivElement>(null);
  const yText = getCellYText(cellId);

  const toggleBackground = () => {
    if (metadata) {
      actions.updateCellMetadata(cellId, { backgroundDDL: !metadata.backgroundDDL });
    }
  };

  const applyResult = (result: QueryResponse) => {
    if (!notebook) return;
    applyExecuteResultForCurrentRun(notebook, cellId, result, {
      completedAt: Date.now(),
    });
  };

  const handleRun = async () => {
    if (!notebook || isRunning || !source?.trim()) return;

    startExecuteCell(notebook, cellId, { now: Date.now() });

    try {
      // Simulate query execution via a mock delay.
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result: QueryResponse = {
        columns: [
          {
            name: "result",
            type: "text",
            isPrimaryKey: false,
            isHidden: false,
          },
        ],
        rows: [
          {
            result: `Simulated at ${new Date().toLocaleTimeString()}`,
          },
        ],
        rowsAffected: 1,
      };

      applyResult(result);
      console.log("Execute SQL:", source);
    } catch (error) {
      applyResult({
        columns: [],
        rows: [],
        rowsAffected: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      console.error("Failed to execute SQL", error);
    }
  };

  // Add keyboard shortcut for running SQL (Cmd/Ctrl+Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!isRunning && source?.trim()) {
          handleRun();
        }
      }
    };

    const editor = editorRef.current;
    if (editor) {
      editor.addEventListener("keydown", handleKeyDown);
      return () => editor.removeEventListener("keydown", handleKeyDown);
    }
  }, [handleRun, isRunning, source]);

  return (
    <div className="flex flex-col gap-4" ref={editorRef}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">SQL Query Editor</span>
          {hasRun && (
            <Badge variant="success" className="text-[10px]">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Executed
            </Badge>
          )}
          {isStale && (
            <Badge variant="outline" className="text-[10px]">
              Stale
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="group inline-flex cursor-pointer items-center gap-2">
            <div className="relative">
              <input
                type="checkbox"
                className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-input bg-background transition-all checked:border-accent checked:bg-accent focus:ring-2 focus:ring-ring focus:ring-offset-2"
                checked={metadata?.backgroundDDL ?? false}
                onChange={toggleBackground}
              />
              <svg
                className="pointer-events-none absolute left-0.5 top-0.5 hidden h-3 w-3 text-accent-foreground peer-checked:block"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <span className="text-xs font-medium text-foreground transition-colors group-hover:text-foreground/80">
              Background DDL
            </span>
          </label>
          <Button
            variant="accent"
            size="sm"
            onClick={handleRun}
            disabled={isRunning || !source?.trim()}
            className="gap-1.5"
            title="Run query (Cmd+Enter)"
          >
            {isRunning ? (
              <>
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent-foreground border-t-transparent" />
                Running
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Run Query
              </>
            )}
          </Button>
        </div>
      </div>

      <CollaborativeMonacoEditor
        yText={yText}
        defaultValue={source ?? ""}
        language="sql"
        autoResize
        minHeight={200}
        maxHeight={420}
        awarenessCellId={cellId}
        className="rounded-lg border border-border shadow-sm"
        undoManager={undoManager}
      />
    </div>
  );
};
