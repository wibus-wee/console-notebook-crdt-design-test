import * as Y from "yjs";

export const withTransactOptional = (
  node: Y.AbstractType<any>,
  fn: () => void,
  origin?: any
) => {
  const doc = node.doc as Y.Doc | undefined;
  if (doc) {
    doc.transact(fn, origin);
  } else {
    fn();
  }
};