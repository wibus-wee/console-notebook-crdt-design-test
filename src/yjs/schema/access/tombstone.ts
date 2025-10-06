import * as Y from "yjs";
import { NB_TOMBSTONES, NB_TOMBSTONE_META } from "../core/keys";

export type TombstoneClock = "trusted" | "local";
export interface TombstoneMeta {
  deletedAt?: number;
  reason?: string;
  clock?: TombstoneClock;
}
export type TombstoneMetaEntry = Y.Map<any>;
export type TombstoneMetaMap = Y.Map<TombstoneMetaEntry>;

export const isValidTombstoneClock = (v: unknown): v is TombstoneClock => v === "trusted" || v === "local";

export const tombstonesMap = (nb: Y.Map<any>): Y.Map<boolean> => {
  let t = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  if (!t) {
    t = new Y.Map<boolean>();
    nb.set(NB_TOMBSTONES, t);
  }
  return t;
};

export const tombstoneMetaMap = (nb: Y.Map<any>): TombstoneMetaMap => {
  let m = nb.get(NB_TOMBSTONE_META) as TombstoneMetaMap | undefined;
  if (!m) {
    m = new Y.Map<TombstoneMetaEntry>();
    nb.set(NB_TOMBSTONE_META, m);
  }
  return m;
};

export const ensureTombstoneMetaEntry = (tm: TombstoneMetaMap, id: string): TombstoneMetaEntry => {
  let e = tm.get(id);
  if (!(e instanceof Y.Map)) {
    e = new Y.Map<any>();
    tm.set(id, e);
  }
  return e;
};

export const readTombstoneMetaEntry = (entry: TombstoneMetaEntry | undefined): TombstoneMeta => {
  if (!(entry instanceof Y.Map)) return {};
  const snapshot: TombstoneMeta = {};
  const deletedAt = entry.get("deletedAt");
  if (deletedAt !== undefined) snapshot.deletedAt = deletedAt as number;
  const reason = entry.get("reason");
  if (reason !== undefined) snapshot.reason = reason as string;
  const clock = entry.get("clock");
  if (clock !== undefined) snapshot.clock = clock as TombstoneClock;
  return snapshot;
};

