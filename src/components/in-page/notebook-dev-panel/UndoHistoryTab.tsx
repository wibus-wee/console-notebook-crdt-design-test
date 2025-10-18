import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { UndoManager } from "yjs";
import type { UndoHistorySnapshot, UndoScopeSummary } from "@/yjs/undo/notebookUndoHistory";

type UndoHistoryTabProps = {
  history: UndoHistorySnapshot;
  undoManager: Pick<UndoManager, "undo" | "redo" | "stopCapturing" | "clear">;
};

export function UndoHistoryTab({ history, undoManager }: UndoHistoryTabProps) {
  const handleUndo = () => {
    if (history.canUndo) {
      undoManager.undo();
    }
  };

  const handleRedo = () => {
    if (history.canRedo) {
      undoManager.redo();
    }
  };

  const handleStopCapture = () => {
    undoManager.stopCapturing();
  };

  const handleClearUndo = () => {
    if (history.undo.length > 0) {
      undoManager.clear(true, false);
    }
  };

  const handleClearRedo = () => {
    if (history.redo.length > 0) {
      undoManager.clear(false, true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleUndo} disabled={!history.canUndo}>
            Undo
          </Button>
          <Button size="sm" variant="secondary" onClick={handleRedo} disabled={!history.canRedo}>
            Redo
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleStopCapture}>
            Stop Capturing
          </Button>
          <Button size="sm" variant="ghost" onClick={handleClearUndo} disabled={history.undo.length === 0}>
            Clear Undo
          </Button>
          <Button size="sm" variant="ghost" onClick={handleClearRedo} disabled={history.redo.length === 0}>
            Clear Redo
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <UndoStackColumn title="Undo Stack" scopes={history.undo} emptyLabel="Undo stack empty" />
        <UndoStackColumn title="Redo Stack" scopes={history.redo} emptyLabel="Redo stack empty" />
      </div>
    </div>
  );
}

function UndoStackColumn({ title, scopes, emptyLabel }: { title: string; scopes: UndoScopeSummary[]; emptyLabel: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground">
        <span>{title}</span>
        <span className="text-[10px] font-mono text-muted-foreground/80">{scopes.length} scopes</span>
      </div>
      {scopes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {scopes.map((scope, index) => (
            <UndoScopeDetails key={scope.id} scope={scope} isTop={index === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function UndoScopeDetails({ scope, isTop }: { scope: UndoScopeSummary; isTop: boolean }) {
  const recentTransactions = scope.transactions.slice(-5).reverse();

  return (
    <details
      className={cn(
        "group rounded-lg border text-xs transition-colors",
        isTop ? "border-primary/60 bg-primary/5 shadow-sm" : "border-border/50 bg-background/60"
      )}
      open={isTop}
    >
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2">
        <div>
          <div className="font-semibold text-foreground">{scope.origin.label}</div>
          <div className="text-[10px] text-muted-foreground">
            {scope.transactionCount} tx · {scope.changeCount} changes
          </div>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          {new Date(scope.updatedAt).toLocaleTimeString()}
        </div>
      </summary>
      <div className="space-y-2 border-t border-border/40 bg-muted/30 px-3 py-2">
        {recentTransactions.map((tx) => (
          <div key={tx.id} className="rounded border border-border/40 bg-background/70 px-2 py-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{tx.origin.label}</span>
              <span>{new Date(tx.timestamp).toLocaleTimeString()}</span>
            </div>
            <ul className="mt-1 space-y-1">
              {tx.changes.slice(0, 6).map((change) => (
                <li key={change.id} className="leading-tight">
                  <div className="font-medium text-foreground">{change.target}</div>
                  <div className="text-[11px] text-muted-foreground">{change.description}</div>
                </li>
              ))}
            </ul>
            {tx.changes.length > 6 && (
              <div className="mt-1 text-[10px] text-muted-foreground/80">
                +{tx.changes.length - 6} more changes
              </div>
            )}
          </div>
        ))}
        {scope.transactions.length > recentTransactions.length && (
          <div className="text-[10px] text-muted-foreground/70">
            Showing last {recentTransactions.length} of {scope.transactions.length} transactions.
          </div>
        )}
      </div>
    </details>
  );
}
