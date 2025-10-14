import { useAtomValue } from "jotai";
import type { NotebookCellAtoms } from "@/yjs/jotai/notebookAtoms";
import { useEditingAwareness } from "../useEditingAwareness";
import { useNotebookAtoms } from "@/providers/NotebookProvider";

interface MarkdownCellEditorProps {
  cellAtoms: NotebookCellAtoms;
}

export const MarkdownCellEditor = ({ cellAtoms }: MarkdownCellEditorProps) => {
  const { actions } = useNotebookAtoms();
  const cellId = useAtomValue(cellAtoms.idAtom);
  const source = useAtomValue(cellAtoms.sourceAtom);
  const { claim, release } = useEditingAwareness(cellId, "markdown-editor");

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-medium text-muted-foreground">Markdown Editor</span>
      <textarea
        className="min-h-[180px] w-full resize-y rounded-lg border border-border bg-background px-4 py-3 text-sm leading-relaxed text-foreground shadow-sm transition-all placeholder:text-muted-foreground/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        value={source ?? ""}
        onChange={(event) => actions.updateCellSource(cellId, event.target.value)}
        onFocus={claim}
        onBlur={release}
        placeholder="Write your markdown content here..."
      />
    </div>
  );
};
