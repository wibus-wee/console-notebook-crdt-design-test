import * as Y from "yjs";
import { MAINT_ORIGIN } from "../core/origins";
import { FIRST_SCHEMA_VERSION, SCHEMA_VERSION } from "../core/version";
import { ensureSchemaMeta, getNotebookRoot } from "../access/root";
import { MIGRATION_REGISTRY } from "./registry";
import { reconcileNotebook, type ReconcileOptions } from "../quality/reconcile";
import { validateNotebook } from "../quality/validation";
import { reconcileOutputs, type ReconcileOutputsOptions } from "../quality/reconcile_outputs";

export const migrateNotebookSchema = (
  doc: Y.Doc,
  opts?: {
    log?: (msg: string) => void;
    /** Feature flag: 迁移完成后（或版本已最新时）自动执行一次 reconcile */
    autoReconcile?: boolean;
    /** 传入给 reconcileNotebook 的细化选项 */
    reconcile?: {
      notebook: ReconcileOptions,
      outputs: ReconcileOutputsOptions
    };
  }
): number => {
  const log = opts?.log ?? console.info;

  const root = getNotebookRoot(doc);
  const meta = ensureSchemaMeta(root);
  const currentVersion =
    typeof meta.get("version") === "number" ? (meta.get("version") as number) : FIRST_SCHEMA_VERSION;

  if (currentVersion === SCHEMA_VERSION) {
    log(`[migrate] Schema already up-to-date (v${SCHEMA_VERSION}).`);
    if (opts?.autoReconcile) {
      const report = reconcileNotebook(root, opts.reconcile?.notebook);
      const outputsReport = reconcileOutputs(root, opts.reconcile?.outputs);
      if (report.changed) {
        console.info(
          `[reconcileOutputs] cleaned ${outputsReport.patchStats.deletedCount} invalid entries (${outputsReport.removedOrphans.length} orphans, ${outputsReport.removedInvalid.length} invalid)`
        );
      }
      if (report.changed) {
        log(
          `[migrate] Auto-reconcile applied: order ${report.previousOrderLength} → ${report.finalOrderLength}, appended ${report.appendedOrphans.length}, removed dup=${report.removedDuplicates.length}, missing=${report.removedMissingFromMap.length}, tomb=${report.removedTombstoned.length}, invalid=${report.removedInvalid.length}`
        );
      } else {
        log(`[migrate] Auto-reconcile found no changes.`);
      }
      const issues = validateNotebook(root);
      if (issues.length > 0) {
        log(`[migrate] Validation after reconcile: ${issues.length} issues.`);
        issues.forEach((i) => log(`  [${i.level}] ${i.path}: ${i.message}`));
      }
    }
    return currentVersion;
  }

  if (currentVersion > SCHEMA_VERSION) {
    log(
      `[migrate] Warning: document schema (v${currentVersion}) is newer than current runtime (v${SCHEMA_VERSION}).`
    );
    return currentVersion;
  }

  let workingVersion = currentVersion;
  while (workingVersion < SCHEMA_VERSION) {
    const migrator = MIGRATION_REGISTRY.get(workingVersion);
    if (!migrator) {
      log(`[migrate] No migration path from v${workingVersion} → v${SCHEMA_VERSION}.`);
      break;
    }

    const targetVersion = workingVersion + 1;
    log(`[migrate] Applying migration v${workingVersion} → v${targetVersion} ...`);

    doc.transact(() => {
      // 再次核对版本，尽量在并发场景下避免重复执行迁移体
      const liveVersion = typeof meta.get("version") === "number" ? (meta.get("version") as number) : FIRST_SCHEMA_VERSION;
      if (liveVersion !== workingVersion) {
        log(`[migrate] Skip step v${workingVersion} → v${targetVersion} due to concurrent advance to v${liveVersion}.`);
        return;
      }

      migrator({
        doc,
        root,
        fromVersion: workingVersion,
        toVersion: targetVersion,
        origin: MAINT_ORIGIN,
        log,
      });
      meta.set("version", targetVersion);
    }, MAINT_ORIGIN);

    workingVersion = targetVersion;
  }

  if (workingVersion === SCHEMA_VERSION) {
    log(`[migrate] Migration complete (v${SCHEMA_VERSION}).`);
  } else {
    log(`[migrate] Incomplete migration (stopped at v${workingVersion}).`);
  }

  if (opts?.autoReconcile) {
    const report = reconcileNotebook(root, opts.reconcile?.notebook);
    const outputsReport = reconcileOutputs(root, opts.reconcile?.outputs);
    if (outputsReport.changed) {
      console.info(
        `[reconcileOutputs] cleaned ${outputsReport.patchStats.deletedCount} invalid entries (${outputsReport.removedOrphans.length} orphans, ${outputsReport.removedInvalid.length} invalid)`
      );
    }
    if (report.changed) {
      log(
        `[migrate] Auto-reconcile applied: order ${report.previousOrderLength} → ${report.finalOrderLength}, appended ${report.appendedOrphans.length}, removed dup=${report.removedDuplicates.length}, missing=${report.removedMissingFromMap.length}, tomb=${report.removedTombstoned.length}, invalid=${report.removedInvalid.length}`
      );
    } else {
      log(`[migrate] Auto-reconcile found no changes.`);
    }
  }

  const issues = validateNotebook(root);
  if (issues.length > 0) {
    log(`[migrate] Validation after migration${opts?.autoReconcile ? "+reconcile" : ""}: ${issues.length} issues.`);
    issues.forEach((i) => log(`  [${i.level}] ${i.path}: ${i.message}`));
  }

  return workingVersion;
};

