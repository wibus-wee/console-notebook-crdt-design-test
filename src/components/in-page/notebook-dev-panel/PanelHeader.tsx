import { cn } from "@/lib/utils";
import type { Doc as YDoc } from "yjs";
import { MinusIcon } from "./icons";
import type { NotebookStatus } from ".";

type PanelHeaderProps = {
  onClose: () => void;
  status: NotebookStatus;
  doc: YDoc;
};

export function PanelHeader({ onClose, status, doc }: PanelHeaderProps) {
  const metaItems = [
    { label: "Status", value: String(status ?? "unknown"), accent: true },
    { label: "Doc", value: String(doc.guid ?? "unknown") },
    { label: "Client", value: String(doc.clientID) },
  ];

  return (
    <div
      className={cn(
        "relative flex items-center justify-between border-b border-border/50",
        "bg-gradient-to-r from-emerald-500/10 via-muted/20 to-background/95 px-4 py-3",
        "dark:border-border/60 dark:from-emerald-500/15 dark:via-muted/40 dark:to-background/80",
        "shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.08)] dark:shadow-none"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span>Y.js Dev Panel</span>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-500/15 dark:text-emerald-200">
              Dev
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase text-muted-foreground/80">
            {metaItems.map((item) => (
              <span
                key={item.label}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 tracking-[0.15em]",
                  item.accent
                    ? "border-emerald-500/40 bg-emerald-100 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-200"
                    : "border-border/60 bg-background/80 text-muted-foreground dark:bg-background/60"
                )}
              >
                <span>{item.label}</span>
                <span className="font-normal tracking-normal">{item.value}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          title="Minimize"
          onClick={onClose}
          className="rounded-md border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border/60 hover:bg-background/80 hover:text-emerald-600 dark:hover:text-emerald-200"
        >
          <MinusIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
