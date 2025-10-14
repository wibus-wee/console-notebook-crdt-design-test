import { atom } from "jotai";
import { createNotebookSnapshotAtom } from "./snapshot";
import { createNotebookActions } from "./actions";
import type { NotebookAtoms, NotebookCellAtoms } from "./types";
import type { YNotebook } from "@/yjs/schema/core/types";
import { memoize } from "es-toolkit/compat";

export const createNotebookAtoms = (nb: YNotebook): NotebookAtoms => {
  const snapshotAtom = createNotebookSnapshotAtom(nb);
  const actions = createNotebookActions(nb);

  const titleAtom = atom((get) => get(snapshotAtom).title);
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

  return {
    snapshotAtom,
    titleAtom,
    cellIdListAtom,
    getCellAtoms,
    actions,
  };
};
