import type { Atom, WritableAtom } from "jotai";
import type { CellKind, CellMetadataModel, YCell } from "@/yjs/schema/core/types";

/**
 * Write options accepted by notebook cell insertion.
 */
export interface InsertCellOptions {
  /** Zero-based index to insert the cell. Defaults to append. */
  index?: number;
  /** Optional initial source content for the cell. */
  source?: string;
  /** Optional metadata overrides applied on creation. */
  metadata?: Partial<CellMetadataModel>;
}

/**
 * Imperative notebook actions exposed to UI layers.
 * They mirror the Y schema mutation helpers but keep UI decoupled from raw Yjs.
 */
export interface NotebookActions {
  /** Insert a new cell of `kind` and return the created cell id. */
  insertCell: (kind: CellKind, opts?: InsertCellOptions) => string;
  /** Remove a cell and its outputs by id. Safe to call on already-removed cells. */
  removeCell: (cellId: string) => void;
  /** Move an existing cell to a new index if both exist. */
  moveCell: (cellId: string, toIndex: number) => void;
}

/**
 * Atom bundle describing a single notebook cell.
 * Read/write granularity follows the underlying Y structures to minimise renders.
 */
export interface NotebookCellAtoms {
  /** Snapshot of immutable cell id (read only). */
  idAtom: Atom<string>;
  /** Cell kind atom ("sql" | "markdown"). */
  kindAtom: WritableAtom<CellKind, [CellKind | ((prev: CellKind) => CellKind)], void>;
  /** Cell source content backed by Y.Text. */
  sourceAtom: WritableAtom<string, [string | ((prev: string) => string)], void>;
  /** Cell metadata (shallow model) backed by Y.Map. */
  metadataAtom: WritableAtom<CellMetadataModel, [CellMetadataModel | ((prev: CellMetadataModel) => CellMetadataModel)], void>;
  /** Underlying Y.Cell reference mainly for advanced integrations (debug, inspection). */
  yCell: YCell;
}

/**
 * Root notebook atoms exposed through the provider context.
 */
export interface NotebookAtoms {
  /** Title atom for the notebook (Y.Map key). */
  titleAtom: WritableAtom<string, [string | ((prev: string) => string)], void>;
  /** Ordered list of cell ids observing Y.Array order. */
  cellIdListAtom: Atom<string[]>;
  /**
   * Lazily create/fetch per-cell atom bundles.
   * Throws if the cell id does not exist.
   */
  getCellAtoms: (cellId: string) => NotebookCellAtoms;
  /** Curated UI actions manipulating cells. */
  actions: NotebookActions;
}
