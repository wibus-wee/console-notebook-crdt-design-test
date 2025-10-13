import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Array<{
    id: string;
    label: string;
    description?: string;
    icon?: React.ReactNode;
    shortcut?: string;
    onExecute: () => void;
  }>;
}

export function CommandPalette({ isOpen, onClose, commands }: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCommands = commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(search.toLowerCase()) ||
      cmd.description?.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filteredCommands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === "Enter" && filteredCommands[selectedIndex]) {
        e.preventDefault();
        filteredCommands[selectedIndex].onExecute();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="mt-32 w-full max-w-2xl animate-slide-down"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
          {/* Search Input */}
          <div className="border-b border-border p-4">
            <input
              type="text"
              placeholder="Type a command or search..."
              className="w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          {/* Commands List */}
          <div className="max-h-96 overflow-y-auto p-2">
            {filteredCommands.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No commands found
              </div>
            ) : (
              filteredCommands.map((cmd, index) => (
                <button
                  key={cmd.id}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors",
                    index === selectedIndex
                      ? "bg-accent/10 text-accent"
                      : "text-foreground hover:bg-muted"
                  )}
                  onClick={() => {
                    cmd.onExecute();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {cmd.icon && <div className="text-muted-foreground">{cmd.icon}</div>}
                  <div className="flex-1">
                    <div className="font-medium">{cmd.label}</div>
                    {cmd.description && (
                      <div className="text-xs text-muted-foreground">{cmd.description}</div>
                    )}
                  </div>
                  {cmd.shortcut && (
                    <Badge variant="secondary" className="text-xs">
                      {cmd.shortcut}
                    </Badge>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border bg-muted/30 px-4 py-2">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Badge variant="secondary" className="text-[10px]">↑↓</Badge>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <Badge variant="secondary" className="text-[10px]">↵</Badge>
                Select
              </span>
              <span className="flex items-center gap-1">
                <Badge variant="secondary" className="text-[10px]">Esc</Badge>
                Close
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
