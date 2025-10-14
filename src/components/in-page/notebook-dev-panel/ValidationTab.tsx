import { cn } from "@/lib/utils";
import type { ValidationIssue } from "@/yjs/schema/quality/validation";

type ValidationTabProps = {
  issues: ValidationIssue[];
};

export function ValidationTab({ issues }: ValidationTabProps) {
  if (issues.length === 0) {
    return <p className="text-xs text-emerald-500">No validation issues.</p>;
  }

  return (
    <ul className="space-y-1 text-xs">
      {issues.map((issue, idx) => (
        <li
          key={`${issue.path}-${idx}`}
          className={cn(
            "rounded border p-2",
            issue.level === "error"
              ? "border-red-500 text-red-500"
              : "border-amber-500 text-amber-500"
          )}
        >
          <div className="font-mono">{issue.path}</div>
          <div>{issue.message}</div>
        </li>
      ))}
    </ul>
  );
}
