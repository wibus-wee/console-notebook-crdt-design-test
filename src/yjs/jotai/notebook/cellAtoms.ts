import { atom } from "jotai";
import * as Y from "yjs";
import { createYAtom, createYMapKeyAtom, createYTextAtom } from "../yJotai";
import { getCellMap } from "@/yjs/schema/access/accessors";
import { CELL_ID, CELL_KIND, CELL_META, CELL_SOURCE } from "@/yjs/schema/core/keys";
import { DEFAULT_CELL_METADATA, type CellKind, type CellMetadataModel, type YCell, type YNotebook } from "@/yjs/schema/core/types";
import type { NotebookCellAtoms } from "./types";

// --- Type Guards and Normalizers (Pure Functions) ---

const decodeKind = (value: unknown): CellKind => (value === "markdown" || value === "sql" ? value : "sql");

const normalizeMetadata = (input: Partial<CellMetadataModel> | undefined): CellMetadataModel => ({
  backgroundDDL: input?.backgroundDDL ?? DEFAULT_CELL_METADATA.backgroundDDL,
});

const metadataEquals = (a: CellMetadataModel, b: CellMetadataModel) => a.backgroundDDL === b.backgroundDDL;

// --- Schema Accessors (Pure, Read-Only, Fail-Fast) ---

/**
 * Retrieves the metadata Y.Map from a cell.
 * Throws an error if the metadata is missing or not a Y.Map, ensuring data integrity.
 * @param cell The YCell to read from.
 * @returns The metadata Y.Map.
 */
const getMetadataMap = (cell: YCell): Y.Map<any> => {
  const meta = cell.get(CELL_META);
  if (!(meta instanceof Y.Map)) {
    const cellId = cell.get(CELL_ID) || "unknown";
    throw new Error(`Data integrity issue: Cell "${cellId}" is missing a valid metadata Y.Map.`);
  }
  return meta;
};

/**
 * Retrieves the source Y.Text from a cell.
 * Throws an error if the source is missing or not a Y.Text, ensuring data integrity.
 * @param cell The YCell to read from.
 * @returns The source Y.Text.
 */
const getSourceText = (cell: YCell): Y.Text => {
  const source = cell.get(CELL_SOURCE);
  if (!(source instanceof Y.Text)) {
    const cellId = cell.get(CELL_ID) || "unknown";
    throw new Error(`Data integrity issue: Cell "${cellId}" is missing a valid source Y.Text.`);
  }
  return source;
};


// --- Atom Factory ---

export interface NotebookCellAtomFactory {
  getCellAtoms: (cellId: string) => NotebookCellAtoms;
  invalidate: (cellId: string) => void;
}

/**
 * Builds a memoised factory that exposes per-cell atom bundles.
 * This factory ensures that atom instances are stable for the lifetime of a cell
 * in the UI, preventing unnecessary re-renders in React.
 *
 * It operates with a strict read-only policy. Any deviation from the expected
 * data schema will result in an error, promoting data consistency.
 */
export const createNotebookCellAtomFactory = (nb: YNotebook): NotebookCellAtomFactory => {
  const cellMap = getCellMap(nb);
  const cache = new Map<string, NotebookCellAtoms>();

  const getCellAtoms = (cellId: string): NotebookCellAtoms => {
    // 1. Return from cache for stable atom identity
    const cached = cache.get(cellId);
    if (cached) return cached;

    // 2. Fetch the raw Y.Map for the cell
    const cell = cellMap.get(cellId);
    if (!(cell instanceof Y.Map)) {
      throw new Error(`Cell "${cellId}" not found in notebook Y.Map.`);
    }

    // 3. Create the atom bundle using pure accessors
    const idAtom = atom(cell.get(CELL_ID) as string);

    const kindAtom = createYMapKeyAtom<any, CellKind>(cell, CELL_KIND, {
      decode: decodeKind,
      equals: (a, b) => a === b,
    });

    const sourceAtom = createYTextAtom(getSourceText(cell));

    const metadataMap = getMetadataMap(cell);
    const metadataAtom = createYAtom<Y.Map<any>, CellMetadataModel>({
      y: metadataMap,
      read: (map) =>
        normalizeMetadata({
          backgroundDDL: map.get("backgroundDDL") === true,
        }),
      write: (map, next) => {
        const current = normalizeMetadata({ backgroundDDL: map.get("backgroundDDL") === true });
        const target = next;
        
        // Be smart about writes: only write if changed, and delete if it's the default value.
        if (target.backgroundDDL !== current.backgroundDDL) {
            if (target.backgroundDDL === DEFAULT_CELL_METADATA.backgroundDDL) {
                map.delete("backgroundDDL");
            } else {
                map.set("backgroundDDL", target.backgroundDDL);
            }
        }
      },
      equals: metadataEquals,
    });

    const bundle: NotebookCellAtoms = {
      idAtom,
      kindAtom,
      sourceAtom,
      metadataAtom,
      yCell: cell as YCell,
    };
    
    // 4. Cache the newly created bundle
    cache.set(cellId, bundle);
    return bundle;
  };

  /**
   * Removes a cell's atom bundle from the cache.
   * This should be called when a cell is permanently deleted to allow for garbage collection.
   */
  const invalidate = (cellId: string) => {
    cache.delete(cellId);
  };

  return { getCellAtoms, invalidate };
};
