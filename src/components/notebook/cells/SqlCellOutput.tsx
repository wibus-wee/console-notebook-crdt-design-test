import type { ReactNode } from "react";
import type { CellOutputSnapshot } from "@/yjs/jotai/notebook/snapshot";

interface SqlCellOutputProps {
  output?: CellOutputSnapshot;
}

const formatTimestamp = (timestamp?: number): string | null => {
  if (!timestamp) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(timestamp);
  } catch (err) {
    console.warn("Failed to format timestamp", err);
    return null;
  }
};

const renderCellValue = (value: unknown): ReactNode => {
  if (value === null) {
    return <span className="italic text-muted-foreground/70">NULL</span>;
  }
  if (typeof value === "undefined") {
    return <span className="text-muted-foreground/60">—</span>;
  }
  if (typeof value === "object") {
    try {
      return <span className="font-mono text-xs text-muted-foreground">{JSON.stringify(value)}</span>;
    } catch (err) {
      console.warn("Failed to stringify cell value", err);
      return <span className="font-mono text-xs text-muted-foreground">[object]</span>;
    }
  }
  if (typeof value === "number") {
    return <span className="font-mono">{value}</span>;
  }
  return String(value);
};

export const SqlCellOutput = ({ output }: SqlCellOutputProps) => {
  const running = output?.running ?? false;
  const stale = output?.stale ?? false;
  const result = output?.result;
  const completedAt = formatTimestamp(output?.completedAt ?? output?.startedAt);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border/80 bg-muted/20">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {running ? (
            <>
              <div className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span className="font-medium text-accent">Running query…</span>
            </>
          ) : result ? (
            result.error ? (
              <span className="font-medium text-destructive">Execution failed</span>
            ) : (
              <span className="font-medium text-foreground">Query completed</span>
            )
          ) : stale ? (
            <span className="font-medium text-amber-600">Result stale</span>
          ) : (
            <span className="font-medium text-muted-foreground">Awaiting first run</span>
          )}
        </div>

        {completedAt && !running && (
          <span className="tabular-nums text-muted-foreground/80">{completedAt}</span>
        )}
      </div>

      <div className="px-3 py-3 text-sm">
        {running && (
          <p className="text-muted-foreground">
            Query is executing. Results will appear here shortly.
          </p>
        )}

        {!running && !result && !stale && (
          <p className="text-muted-foreground">
            Run the SQL cell to see results.
          </p>
        )}

        {!running && stale && !result && (
          <p className="text-muted-foreground">
            Source changed since last run. Execute again to refresh the output.
          </p>
        )}

        {!running && result?.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="mb-1 flex items-center gap-2 font-medium">
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
                className="opacity-80"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
              Error executing query
            </div>
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {result.error}
            </pre>
          </div>
        )}

        {!running && result && !result.error && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {result.rows.length === 1
                  ? "1 row returned"
                  : `${result.rows.length} rows returned`}
              </span>
              <span>{result.rowsAffected === 1 ? "1 row affected" : `${result.rowsAffected} rows affected`}</span>
            </div>

            {result.rows.length === 0 ? (
              <div className="rounded-md border border-border/60 bg-background/70 p-3 text-xs text-muted-foreground">
                Query executed successfully but returned no rows.
              </div>
            ) : (
              <div className="overflow-auto rounded-md border border-border/70 bg-background/90 shadow-sm">
                <table className="min-w-full border-collapse text-xs">
                  <thead className="bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {result.columns.map((column) => (
                        <th key={column.name} className="border-b border-border/70 px-3 py-2">
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">{column.name}</span>
                            <span className="text-[10px] font-medium text-muted-foreground/80">{column.type}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {result.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="odd:bg-muted/30">
                        {result.columns.map((column) => (
                          <td key={column.name} className="px-3 py-2 align-top text-foreground">
                            {renderCellValue(row[column.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
