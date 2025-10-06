import * as Y from "yjs";
import { ROOT_NOTEBOOK_KEY, SCHEMA_META_KEY } from "../core/keys";
import type { NotebookRoot, YNotebook } from "../core/types";

export const getNotebookRoot = (doc: Y.Doc): YNotebook => doc.getMap(ROOT_NOTEBOOK_KEY);

export const getOrCreateNotebookRoot = (doc: Y.Doc): YNotebook => doc.getMap(ROOT_NOTEBOOK_KEY);

export const ensureSchemaMeta = (nb: YNotebook): Y.Map<any> => {
  let schemaMeta = nb.get(SCHEMA_META_KEY) as Y.Map<any> | undefined;
  if (!schemaMeta) {
    schemaMeta = new Y.Map<any>();
    nb.set(SCHEMA_META_KEY, schemaMeta);
  }
  return schemaMeta;
};

/** 仅建立 root 与 schemaMeta；版本号由上层迁移器写入，这里不写入 version */
export const ensureNotebookRoot = (doc: Y.Doc): NotebookRoot => {
  const root = getOrCreateNotebookRoot(doc);
  const schemaMeta = ensureSchemaMeta(root);
  return { root, schemaMeta };
};
