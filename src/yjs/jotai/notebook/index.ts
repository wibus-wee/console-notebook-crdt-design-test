import { createNotebookOrderAtom, createNotebookTitleAtom } from "./rootAtoms";
import { createNotebookCellAtomFactory } from "./cellAtoms";
import { createNotebookActions } from "./actions";
import type { NotebookAtoms } from "./types";
import type { YNotebook } from "@/yjs/schema/core/types";

export const createNotebookAtoms = (nb: YNotebook): NotebookAtoms => {
  const cellFactory = createNotebookCellAtomFactory(nb);
  const actions = createNotebookActions(nb, cellFactory);

  return {
    titleAtom: createNotebookTitleAtom(nb),
    cellIdListAtom: createNotebookOrderAtom(nb),
    getCellAtoms: (cellId) => cellFactory.getCellAtoms(cellId),
    actions,
  };
};
