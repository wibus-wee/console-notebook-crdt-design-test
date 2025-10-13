import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface QuickInsertProps {
  onInsertSql: () => void;
  onInsertMarkdown: () => void;
  className?: string;
}

export function QuickInsert({ onInsertSql, onInsertMarkdown, className }: QuickInsertProps) {
  return (
    <div className={cn("group flex items-center justify-center py-2", className)}>
      <div className="relative flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="h-px w-12 bg-border" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onInsertSql}
          className="h-7 gap-1.5 text-xs hover:bg-accent/10 hover:text-accent"
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
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          SQL
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onInsertMarkdown}
          className="h-7 gap-1.5 text-xs hover:bg-accent/10 hover:text-accent"
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
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          MD
        </Button>
        <div className="h-px w-12 bg-border" />
      </div>
    </div>
  );
}
