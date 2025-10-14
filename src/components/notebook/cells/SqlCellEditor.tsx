import { useAtomValue } from "jotai";
import { useState, useEffect, useRef } from "react";
import type { NotebookCellAtoms } from "@/yjs/jotai/notebookAtoms";
import { useNotebookAtoms } from "@/providers/NotebookProvider";
import { CollaborativeMonacoEditor } from "@/components/collaborative-monaco-editor";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface SqlCellEditorProps {
  cellAtoms: NotebookCellAtoms;
}

export const SqlCellEditor = ({ cellAtoms }: SqlCellEditorProps) => {
  const { actions, getCellYText } = useNotebookAtoms();
  const cellId = useAtomValue(cellAtoms.idAtom);
  const source = useAtomValue(cellAtoms.sourceAtom);
  const metadata = useAtomValue(cellAtoms.metadataAtom);
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const yText = getCellYText(cellId);

  const toggleBackground = () => {
    if (metadata) {
      actions.updateCellMetadata(cellId, { backgroundDDL: !metadata.backgroundDDL });
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    // Simulate query execution
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsRunning(false);
    setHasRun(true);
    console.log("Execute SQL:", source);
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
  }, [isRunning, source]);

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
      />
    </div>
  );
};
