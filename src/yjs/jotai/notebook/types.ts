import type { Atom } from "jotai";
import type { Text as YText } from "yjs";
import type { CellKind, CellMetadataModel } from "@/yjs/schema/core/types";
import type { NotebookSnapshot } from "./snapshot";

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
  /** Update the source code of a cell. */
  updateCellSource: (cellId: string, source: string) => void;
  /** Update the metadata of a cell. */
  updateCellMetadata: (cellId: string, metadata: Partial<CellMetadataModel>) => void;
}

/**
 * Atom bundle describing a single notebook cell.
 * Read/write granularity follows the underlying Y structures to minimise renders.
 */
export interface NotebookCellAtoms {
  /** Snapshot of immutable cell id (read only). */
  idAtom: Atom<string>;
  /** Cell kind atom ("sql" | "markdown"). */
  /** Read-only atom for the cell's kind ("sql" | "markdown"). */
  kindAtom: Atom<CellKind | undefined>;
  /** Read-only atom for the cell's source content. */
  sourceAtom: Atom<string | undefined>;
  /** Read-only atom for the cell's metadata. */
  metadataAtom: Atom<CellMetadataModel | undefined>;
}

/**
 * Root notebook atoms exposed through the provider context.
 */
export interface NotebookAtoms {
  /** The master atom holding the entire notebook state snapshot. */
  snapshotAtom: Atom<NotebookSnapshot>;
  /** Read-only atom for the notebook title. */
  titleAtom: Atom<string>;
  /** Read-only atom for the ordered list of cell ids. */
  cellIdListAtom: Atom<string[]>;
  /**
   * Lazily create/fetch per-cell atom bundles.
   * Throws if the cell id does not exist.
   */
  getCellAtoms: (cellId: string) => NotebookCellAtoms;
  /** Accessor for the underlying Y.Text backing a cell's source. */
  getCellYText: (cellId: string) => YText | undefined;
  /** Curated UI actions manipulating cells. */
  actions: NotebookActions;
}
