import type { YNotebook } from "@/yjs/schema/core/types";
import type { Doc as YDoc } from "yjs";
import { YjsTreeViewer } from "../YjsTreeViewer";

type StructureTabProps = {
  nb: YNotebook;
  doc: YDoc;
};

export function StructureTab({ nb, doc }: StructureTabProps) {
  return (
    <div className="rounded border border-border/50 bg-muted/30 p-2">
      <YjsTreeViewer notebook={nb} doc={doc} />
    </div>
  );
}
