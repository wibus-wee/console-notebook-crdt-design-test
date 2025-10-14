import { atom } from "jotai";
import { memoize } from "es-toolkit/compat";
import { getCell } from "@/yjs/schema/access/accessors";
import { CELL_SOURCE, NB_TITLE } from "@/yjs/schema/core/keys";
import type { YNotebook } from "@/yjs/schema/core/types";
import type { Text as YText } from "yjs";
import { createNotebookSnapshotAtom } from "./snapshot";
import { createNotebookActions } from "./actions";
import type { NotebookAtoms, NotebookCellAtoms } from "./types";
import { withTransactOptional } from "@/yjs/schema/core/transaction";

export const createNotebookAtoms = (nb: YNotebook): NotebookAtoms => {
  const snapshotAtom = createNotebookSnapshotAtom(nb);
  const actions = createNotebookActions(nb);

  const titleAtom = atom(
    (get) => get(snapshotAtom).title,
    (_get, _set, next: string) => {
      const apply = () => {
        const resolved = typeof next === "string" ? next : String(next ?? "");
        const current = nb.get(NB_TITLE);
        if (typeof current === "string" && current === resolved) return;
        nb.set(NB_TITLE, resolved);
      };
      withTransactOptional(nb, apply);
    }
  );
  const cellIdListAtom = atom((get) => get(snapshotAtom).order);

  const getCellAtoms = memoize((cellId: string): NotebookCellAtoms => {
    const cellDataAtom = atom((get) => get(snapshotAtom).cells[cellId]);
    return {
      idAtom: atom((get) => get(cellDataAtom)?.id ?? cellId),
      kindAtom: atom((get) => get(cellDataAtom)?.kind),
      sourceAtom: atom((get) => get(cellDataAtom)?.source),
      metadataAtom: atom((get) => get(cellDataAtom)?.metadata),
      // yCell is no longer exposed as it's an implementation detail of the Yjs layer.
      // UI should only depend on the snapshot.
    };
  });

  const getCellYText = (cellId: string): YText | undefined => {
    const cell = getCell(nb, cellId);
    return (cell?.get(CELL_SOURCE) as YText | undefined) ?? undefined;
  };

  return {
    snapshotAtom,
    titleAtom,
    cellIdListAtom,
    getCellAtoms,
    getCellYText,
    actions,
  };
};
