import { atom } from "jotai";
import * as Y from "yjs";
import { yCellToModel, yNotebookToModel } from "@/yjs/schema/access/conversion";
import { getCellMap } from "@/yjs/schema/access/accessors";
import type { CellModel, NotebookModel, YNotebook } from "@/yjs/schema/core/types";
import { isEqual } from "es-toolkit/compat";

/**
 * Represents a complete, immutable snapshot of the notebook state.
 * This is a plain JavaScript object derived from the Yjs model, suitable for direct use in React.
 */
export type NotebookSnapshot = Omit<NotebookModel, "cells"> & {
  cells: Record<string, CellModel>;
};

/**
 * Converts a YNotebook CRDT into a deep, immutable snapshot object.
 * This function is designed to be called after any transaction to capture the latest state.
 *
 * @param nb The YNotebook instance.
 * @returns A full snapshot of the notebook.
 */
export const yNotebookToSnapshot = (nb: YNotebook): NotebookSnapshot => {
  // 1. Get the base model, which includes most top-level fields.
  const baseModel = yNotebookToModel(nb);

  // 2. Convert the Y.Map of cells into a plain object record.
  const cellMap = getCellMap(nb);
  const cells: Record<string, CellModel> = {};
  for (const [id, ycell] of cellMap.entries()) {
    cells[id] = yCellToModel(ycell);
  }

  // 3. Combine and freeze for immutability (dev-mode guard rails).
  const snapshot: NotebookSnapshot = {
    ...baseModel,
    cells,
  };

  if (process.env.NODE_ENV === "development") {
    Object.freeze(snapshot);
    Object.freeze(snapshot.cells);
    Object.values(snapshot.cells).forEach(Object.freeze);
  }

  return snapshot;
};

/**
 * Creates the master Jotai atom that holds the entire notebook snapshot.
 *
 * How it works:
 * - It initializes its state by reading directly from the YNotebook.
 * - On mount, it subscribes to the Y.Doc's `afterTransaction` event. This is the most
 *   efficient way to listen, as it fires only once after any number of changes.
 * - When a transaction occurs, it generates a new snapshot.
 * - It uses a deep equality check (`isEqual`) to prevent re-renders if the snapshot
 *   hasn't actually changed, which is a crucial performance optimization.
 * - It automatically unsubscribes when the atom is no longer in use.
 *
 * @param nb The YNotebook instance.
 * @returns A read-only Jotai atom containing the `NotebookSnapshot`.
 */
export const createNotebookSnapshotAtom = (nb: YNotebook) => {
  const doc = nb.doc;
  if (!doc) {
    throw new Error("YNotebook must be attached to a Y.Doc to create a snapshot atom.");
  }

  // Initial read for SSR and synchronous setups.
  let prevSnapshot = yNotebookToSnapshot(nb);
  const anAtom = atom(prevSnapshot);

  anAtom.onMount = (set) => {
    const handler = () => {
      const nextSnapshot = yNotebookToSnapshot(nb);
      if (!isEqual(prevSnapshot, nextSnapshot)) {
        prevSnapshot = nextSnapshot;
        set(nextSnapshot);
      }
    };

    doc.on("afterTransaction", handler);

    // Ensure state is up-to-date right after mount.
    handler();

    return () => {
      doc.off("afterTransaction", handler);
    };
  };

  // This is a read-only atom from the UI's perspective.
  // All writes must go through Yjs mutations.
  return atom((get) => get(anAtom));
};