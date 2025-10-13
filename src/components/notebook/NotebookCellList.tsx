import { useAtomValue } from "jotai";
import type { NotebookAtoms } from "@/yjs/jotai/notebookAtoms";
import { NotebookCell } from "./cells/NotebookCell";
import { Button } from "@/components/ui/Button";
import { QuickInsert } from "@/components/QuickInsert";

interface NotebookCellListProps {
  notebook: NotebookAtoms;
}

export const NotebookCellList = ({ notebook }: NotebookCellListProps) => {
  const cellIds = useAtomValue(notebook.cellIdListAtom);

  const handleAdd = (kind: "sql" | "markdown") => {
    notebook.actions.insertCell(kind);
  };

  const handleInsertAt = (index: number, kind: "sql" | "markdown") => {
    notebook.actions.insertCell(kind, { index });
  };

  const empty = cellIds.length === 0;

  return (
    <section className="flex flex-col gap-6">
      {empty && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/30 py-20 animate-fade-in">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent/20 to-accent/5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-accent"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M7 7h10" />
              <path d="M7 12h10" />
              <path d="M7 17h10" />
            </svg>
          </div>
          <h3 className="mb-2 text-base font-semibold text-foreground">No cells yet</h3>
          <p className="mb-8 text-sm text-muted-foreground">
            Start building your notebook by adding a cell below
          </p>
          <div className="flex gap-3">
            <Button
              variant="accent"
              size="default"
              onClick={() => handleAdd("sql")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
              New SQL Cell
            </Button>
            <Button
              variant="outline"
              size="default"
              onClick={() => handleAdd("markdown")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              New Markdown Cell
            </Button>
          </div>
        </div>
      )}

      {cellIds.map((cellId, index) => (
        <div key={cellId}>
          {/* Quick Insert Between Cells */}
          {index > 0 && (
            <QuickInsert
              onInsertSql={() => handleInsertAt(index, "sql")}
              onInsertMarkdown={() => handleInsertAt(index, "markdown")}
            />
          )}

          <NotebookCell
            notebook={notebook}
            cellId={cellId}
            index={index}
            total={cellIds.length}
          />
        </div>
      ))}

      {!empty && (
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAdd("sql")}
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
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              SQL
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAdd("markdown")}
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
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              Markdown
            </Button>
          </div>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}
    </section>
  );
};
