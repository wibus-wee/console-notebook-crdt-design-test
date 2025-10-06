import * as Y from "yjs";
import { NB_CELL_MAP, NB_CELL_ORDER } from "../core/keys";
import type { YNotebook, YCell } from "../core/types";

export const getCellMap = (nb: YNotebook): Y.Map<YCell> => {
  let m = nb.get(NB_CELL_MAP) as Y.Map<YCell> | undefined;
  if (!m) {
    m = new Y.Map<YCell>();
    nb.set(NB_CELL_MAP, m);
  }
  return m;
};

export const getOrder = (nb: YNotebook): Y.Array<string> => {
  let a = nb.get(NB_CELL_ORDER) as Y.Array<string> | undefined;
  if (!a) {
    a = new Y.Array<string>();
    nb.set(NB_CELL_ORDER, a);
  }
  return a;
};

export const getCell = (nb: YNotebook, id: string): YCell | undefined => getCellMap(nb).get(id);

export const listCells = (nb: YNotebook): YCell[] => {
  const order = getOrder(nb).toArray();
  const map = getCellMap(nb);
  return order.map((id) => map.get(id)).filter((x): x is YCell => !!x);
};

