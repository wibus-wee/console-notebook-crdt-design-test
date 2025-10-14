import type { NotebookReport } from "./hooks";

type OverviewTabProps = {
  report: NotebookReport;
};

export function OverviewTab({ report }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Notebook Stats</h4>
        <div className="grid grid-cols-4 gap-2">
          <StatTile label="Order" value={report.orderLength} />
          <StatTile label="Cells" value={report.cellCount} />
          <StatTile label="Tombstones" value={report.tombstoneCount} />
          <StatTile label="Snapshot" value={report.snapshotCount} />
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Reconcile Preview</h4>
        <div className="rounded border border-border/50 bg-muted/30 p-3 text-xs">
          <div className="flex justify-between">
            <span>Would Change</span>
            <span className={report.reconcile.wouldChange ? "text-amber-500" : "text-muted-foreground"}>
              {report.reconcile.wouldChange ? "Yes" : "No"}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>Delete Ops: {report.reconcile.deleteRanges.length}</div>
            <div>Orphans: {report.reconcile.orphans.length}</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border/50 bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}
