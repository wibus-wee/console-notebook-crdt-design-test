import { registerNotebookMigration } from "./registry";

const migrate_v1_000_000_to_v1_000_001 = () => {
  // Example migration stub
  // No-op for v1.000.000 → v1.000.001
};

registerNotebookMigration(1_000_000, () => migrate_v1_000_000_to_v1_000_001());

