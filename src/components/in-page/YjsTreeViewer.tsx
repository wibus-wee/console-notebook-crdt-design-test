import { useState } from "react";
import * as Y from "yjs";
import { cn } from "@/lib/utils";

interface TreeNodeProps {
  label: string;
  value: any;
  depth?: number;
  isRoot?: boolean;
  path?: string;
}

export function YjsTreeViewer({ doc, notebook }: { doc: Y.Doc; notebook: Y.Map<any> }) {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Search in tree..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-xs bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all"
        />
      </div>

      {/* Tree */}
      <div className="space-y-0.5 font-mono text-xs">
        <TreeNode label="Y.Doc Root" value={doc} depth={0} isRoot path="root" searchQuery={searchQuery} />
        <TreeNode label="Notebook (rw-notebook-root)" value={notebook} depth={0} path="root.notebook" searchQuery={searchQuery} />
      </div>
    </div>
  );
}

function TreeNode({ label, value, depth = 0, isRoot = false, path = "", searchQuery = "" }: TreeNodeProps & { searchQuery?: string }) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const [copied, setCopied] = useState(false);
  const paddingLeft = depth * 12;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Check if this node or any of its children match the search
  const matchesSearch = (val: any, query: string): boolean => {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();

    if (label.toLowerCase().includes(lowerQuery)) return true;

    if (typeof val === "string" && val.toLowerCase().includes(lowerQuery)) return true;

    if (val instanceof Y.Map) {
      const entries = Array.from(val.entries());
      return entries.some(([key]) => key.toLowerCase().includes(lowerQuery));
    }

    return false;
  };

  if (searchQuery && !matchesSearch(value, searchQuery)) {
    return null;
  }

  const renderValue = () => {
    // Handle Y.Map
    if (value instanceof Y.Map) {
      const entries = Array.from(value.entries());
      return (
        <div className="leading-tight">
          <div
            className={cn(
              "group flex items-center gap-1.5 py-0.5 px-1.5 -mx-1.5 rounded transition-all cursor-pointer",
              "hover:bg-neutral-100 dark:hover:bg-neutral-800/50",
              isExpanded && "bg-neutral-100/50 dark:bg-neutral-800/30"
            )}
            style={{ paddingLeft: `${paddingLeft}px` }}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <span className={cn(
              "text-neutral-400 dark:text-neutral-600 select-none transition-transform duration-150 text-[10px]",
              isExpanded && "rotate-90"
            )}>
              {entries.length > 0 ? "▸" : "·"}
            </span>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">{label}</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              Map
            </span>
            <span className="text-neutral-400 dark:text-neutral-600 text-[10px]">
              {entries.length}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(JSON.stringify(Object.fromEntries(entries), null, 2));
              }}
              className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-all"
              title="Copy as JSON"
            >
              {copied ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-emerald-500">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
          {isExpanded && entries.length > 0 && (
            <div className="mt-0.5">
              {entries.map(([key, val]) => (
                <TreeNode key={key} label={key} value={val} depth={depth + 1} path={`${path}.${key}`} searchQuery={searchQuery} />
              ))}
            </div>
          )}
        </div>
      );
    }

    // Handle Y.Array
    if (value instanceof Y.Array) {
      const items = value.toArray();
      return (
        <div className="leading-tight">
          <div
            className={cn(
              "group flex items-center gap-1.5 py-0.5 px-1.5 -mx-1.5 rounded transition-all cursor-pointer",
              "hover:bg-neutral-100 dark:hover:bg-neutral-800/50",
              isExpanded && "bg-neutral-100/50 dark:bg-neutral-800/30"
            )}
            style={{ paddingLeft: `${paddingLeft}px` }}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <span className={cn(
              "text-neutral-400 dark:text-neutral-600 select-none transition-transform duration-150 text-[10px]",
              isExpanded && "rotate-90"
            )}>
              {items.length > 0 ? "▸" : "·"}
            </span>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">{label}</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
              Array
            </span>
            <span className="text-neutral-400 dark:text-neutral-600 text-[10px]">
              {items.length}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(JSON.stringify(items, null, 2));
              }}
              className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-all"
              title="Copy as JSON"
            >
              {copied ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-emerald-500">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
          {isExpanded && items.length > 0 && (
            <div className="mt-0.5">
              {items.map((item, idx) => (
                <TreeNode key={idx} label={`[${idx}]`} value={item} depth={depth + 1} path={`${path}[${idx}]`} searchQuery={searchQuery} />
              ))}
            </div>
          )}
        </div>
      );
    }

    // Handle Y.Text
    if (value instanceof Y.Text) {
      const text = value.toString();
      const preview = text.length > 60 ? text.slice(0, 60) + "…" : text;
      return (
        <div className="leading-tight">
          <div
            className={cn(
              "group flex items-center gap-1.5 py-0.5 px-1.5 -mx-1.5 rounded transition-all",
              text.length > 0 && "cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/50",
              isExpanded && "bg-neutral-100/50 dark:bg-neutral-800/30"
            )}
            style={{ paddingLeft: `${paddingLeft}px` }}
            onClick={() => text.length > 0 && setIsExpanded(!isExpanded)}
          >
            <span className={cn(
              "text-neutral-400 dark:text-neutral-600 select-none transition-transform duration-150 text-[10px]",
              isExpanded && text.length > 0 && "rotate-90"
            )}>
              {text.length > 0 ? "▸" : "·"}
            </span>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">{label}</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
              Text
            </span>
            <span className="text-neutral-400 dark:text-neutral-600 text-[10px]">
              {text.length}
            </span>
            {!isExpanded && text.length > 0 && (
              <span className="text-neutral-500 dark:text-neutral-500 text-[10px] truncate flex-1 ml-1">
                "{preview}"
              </span>
            )}
            {text.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(text);
                }}
                className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-all"
                title="Copy text"
              >
                {copied ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-emerald-500">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            )}
          </div>
          {isExpanded && text.length > 0 && (
            <div
              className="mt-1 py-2 px-3 rounded-md bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words"
              style={{ marginLeft: `${paddingLeft + 20}px` }}
            >
              {text}
            </div>
          )}
        </div>
      );
    }

    // Handle Y.Doc (root level)
    if (isRoot && value instanceof Y.Doc) {
      const share = value.share;
      const keys = Object.keys(share);
      return (
        <div className="leading-tight">
          <div
            className={cn(
              "group flex items-center gap-1.5 py-0.5 px-1.5 -mx-1.5 rounded transition-all cursor-pointer",
              "hover:bg-neutral-100 dark:hover:bg-neutral-800/50",
              isExpanded && "bg-neutral-100/50 dark:bg-neutral-800/30"
            )}
            style={{ paddingLeft: `${paddingLeft}px` }}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <span className={cn(
              "text-neutral-400 dark:text-neutral-600 select-none transition-transform duration-150 text-[10px]",
              isExpanded && "rotate-90"
            )}>
              {keys.length > 0 ? "▸" : "·"}
            </span>
            <span className="font-medium text-neutral-900 dark:text-neutral-100">{label}</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              Doc
            </span>
            <span className="text-neutral-400 dark:text-neutral-600 text-[10px]">
              {keys.length}
            </span>
          </div>
          {isExpanded && (
            <div className="mt-0.5">
              {keys.map((key) => (
                <TreeNode key={key} label={key} value={share[key]} depth={depth + 1} path={`${path}.${key}`} searchQuery={searchQuery} />
              ))}
            </div>
          )}
        </div>
      );
    }

    // Handle primitive values
    const valueType = typeof value;
    const displayValue =
      value === null
        ? "null"
        : value === undefined
          ? "undefined"
          : valueType === "string"
            ? `"${value}"`
            : valueType === "boolean"
              ? value.toString()
              : valueType === "number"
                ? value.toString()
                : JSON.stringify(value, null, 2);

    const isLongValue = displayValue.length > 60;

    return (
      <div className="leading-tight">
        <div
          className={cn(
            "group flex items-center gap-1.5 py-0.5 px-1.5 -mx-1.5 rounded transition-all",
            isLongValue && "cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/50",
            isExpanded && isLongValue && "bg-neutral-100/50 dark:bg-neutral-800/30"
          )}
          style={{ paddingLeft: `${paddingLeft}px` }}
          onClick={() => isLongValue && setIsExpanded(!isExpanded)}
        >
          <span className={cn(
            "text-neutral-400 dark:text-neutral-600 select-none transition-transform duration-150 text-[10px]",
            isExpanded && isLongValue && "rotate-90"
          )}>
            {isLongValue ? "▸" : "·"}
          </span>
          <span className="font-normal text-neutral-600 dark:text-neutral-400">{label}</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-500 border border-neutral-200 dark:border-neutral-700">
            {valueType}
          </span>
          {!isExpanded && (
            <span className="text-neutral-600 dark:text-neutral-400 text-[10px] truncate flex-1">
              {isLongValue ? displayValue.slice(0, 60) + "…" : displayValue}
            </span>
          )}
        </div>
        {isExpanded && isLongValue && (
          <div
            className="mt-1 py-2 px-3 rounded-md bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap break-words"
            style={{ marginLeft: `${paddingLeft + 20}px` }}
          >
            {displayValue}
          </div>
        )}
      </div>
    );
  };

  return renderValue();
}
