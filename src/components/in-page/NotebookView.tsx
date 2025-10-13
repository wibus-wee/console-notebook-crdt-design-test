import { useState } from "react";
import { useAtomValue } from "jotai";
import { useNotebookStatus, useNotebookAtoms } from "@/providers/NotebookProvider";
import { NotebookHeader } from "@/components/notebook/NotebookHeader";
import { NotebookCellList } from "@/components/notebook/NotebookCellList";
import { Card, CardContent } from "@/components/ui/Card";
import { CommandPalette } from "@/components/CommandPalette";
import { useKeyboardShortcuts, isMac } from "@/hooks/useKeyboardShortcuts";

export function NotebookView() {
  const status = useNotebookStatus();
  const notebook = useNotebookAtoms();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const cellIds = useAtomValue(notebook.cellIdListAtom);

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      key: "k",
      meta: true,
      handler: (e) => {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      },
      description: "Open command palette",
    },
    {
      key: "s",
      meta: true,
      handler: (e) => {
        e.preventDefault();
        notebook.actions.insertCell("sql");
      },
      description: "Add SQL cell",
    },
    {
      key: "m",
      meta: true,
      handler: (e) => {
        e.preventDefault();
        notebook.actions.insertCell("markdown");
      },
      description: "Add Markdown cell",
    },
    {
      key: "t",
      meta: true,
      handler: (e) => {
        e.preventDefault();
        const isDark = document.documentElement.classList.contains("dark");
        if (isDark) {
          document.documentElement.classList.remove("dark");
          localStorage.setItem("notebook-theme", "light");
        } else {
          document.documentElement.classList.add("dark");
          localStorage.setItem("notebook-theme", "dark");
        }
      },
      description: "Toggle theme",
    },
    {
      key: "Escape",
      handler: () => {
        if (isCommandPaletteOpen) {
          setIsCommandPaletteOpen(false);
        }
      },
      description: "Close command palette",
    },
  ], status === "connected");

  // Command palette commands
  const commands = status === "connected" ? [
    {
      id: "add-sql",
      label: "Add SQL Cell",
      description: "Insert a new SQL cell at the end",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      ),
      shortcut: isMac ? "⌘ S" : "Ctrl+S",
      onExecute: () => notebook.actions.insertCell("sql"),
    },
    {
      id: "add-markdown",
      label: "Add Markdown Cell",
      description: "Insert a new Markdown cell at the end",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      shortcut: isMac ? "⌘ M" : "Ctrl+M",
      onExecute: () => notebook.actions.insertCell("markdown"),
    },
    {
      id: "clear-all",
      label: "Clear All Cells",
      description: "Remove all cells from the notebook",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        </svg>
      ),
      onExecute: () => {
        if (cellIds.length === 0) {
          return;
        }
        if (confirm("Are you sure you want to clear all cells? This action cannot be undone.")) {
          // Remove all cells one by one
          cellIds.forEach((cellId) => {
            notebook.actions.removeCell(cellId);
          });
        }
      },
    },
    {
      id: "theme-toggle",
      label: "Toggle Theme",
      description: "Switch between light and dark mode",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      ),
      shortcut: isMac ? "⌘ T" : "Ctrl+T",
      onExecute: () => {
        const isDark = document.documentElement.classList.contains("dark");
        if (isDark) {
          document.documentElement.classList.remove("dark");
          localStorage.setItem("notebook-theme", "light");
        } else {
          document.documentElement.classList.add("dark");
          localStorage.setItem("notebook-theme", "dark");
        }
      },
    },
  ] : [];

  if (status !== "connected") {
    const message = status === "connecting"
      ? "Connecting to collaboration server..."
      : "Connection lost. Please check your network settings.";

    return (
      <Card className="animate-fade-in">
        <CardContent className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            {status === "connecting" ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted-foreground"
              >
                <path d="M20 7h-9" />
                <path d="M14 17H5" />
                <circle cx="17" cy="17" r="3" />
                <circle cx="7" cy="7" r="3" />
              </svg>
            )}
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-6 animate-fade-in">
        <NotebookHeader titleAtom={notebook.titleAtom} />
        <NotebookCellList notebook={notebook} />

        {/* Keyboard shortcuts hint */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
              {isMac ? "⌘" : "Ctrl"}+K
            </kbd>
            Command Palette
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
              {isMac ? "⌘" : "Ctrl"}+S
            </kbd>
            Add SQL Cell
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
              {isMac ? "⌘" : "Ctrl"}+M
            </kbd>
            Add Markdown
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono">
              {isMac ? "⌘" : "Ctrl"}+T
            </kbd>
            Toggle Theme
          </span>
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        commands={commands}
      />
    </>
  );
}
