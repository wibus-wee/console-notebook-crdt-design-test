import type { WsTrafficEntry } from "@/providers/WebsocketProvider";

type TrafficTabProps = {
  traffic: WsTrafficEntry[];
};

export function TrafficTab({ traffic }: TrafficTabProps) {
  return (
    <ul className="space-y-2 text-xs">
      {[...traffic].reverse().map((entry) => (
        <li key={entry.id} className="rounded border border-border/50 bg-muted/30 p-2">
          <div className="flex justify-between text-muted-foreground">
            <span>{entry.direction === "incoming" ? "← Incoming" : "→ Outgoing"}</span>
            <span>{new Date(entry.ts).toLocaleTimeString()}</span>
          </div>

          <div className="mt-1 font-mono text-foreground">{entry.type}</div>

          {entry.details && (
            <p className="mt-1 break-words font-mono text-muted-foreground">{entry.details}</p>
          )}

          {entry.preview && (
            <p className="mt-1 text-[11px] font-mono text-muted-foreground">{entry.preview}</p>
          )}

          {entry.decoded && entry.type === "update" && (
            <details
              className="mt-2 rounded border border-border/40 bg-background/80 px-2 py-2"
              open={entry.decoded.structs.length <= 12}
            >
              <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Decoded Update · {entry.decoded.structs.length} structs
                {entry.decoded.deletes.length > 0 ? ` · deletes ${entry.decoded.deletes.length}` : ""}
              </summary>

              <div className="mt-2 space-y-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">Structs</div>
                  <ul className="mt-1 space-y-1">
                    {entry.decoded.structs.map((struct) => (
                      <li
                        key={`${struct.index}-${struct.summary}`}
                        className="rounded border border-border/30 bg-muted/60 px-2 py-1"
                      >
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="font-mono">#{struct.index}</span>
                          <span className="font-semibold text-foreground">{struct.type}</span>
                        </div>
                        <p className="mt-1 break-words font-mono text-[10px] text-foreground">{struct.summary}</p>
                        {struct.details?.map((line, idx) => (
                          <p key={`${struct.index}-${idx}`} className="break-words font-mono text-[10px] text-muted-foreground">
                            {line}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>

                {entry.decoded.deletes.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">Delete Set</div>
                    <div className="mt-1 grid gap-1">
                      {entry.decoded.deletes.map((del, idx) => (
                        <span
                          key={`${del.client}-${del.clock}-${idx}`}
                          className="font-mono text-[10px] text-muted-foreground"
                        >
                          client:{del.client} · clock:{del.clock} · len:{del.len}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
