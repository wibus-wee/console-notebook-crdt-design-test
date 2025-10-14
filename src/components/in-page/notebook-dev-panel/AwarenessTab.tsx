import { useEffect, useMemo, useState } from "react";
import {
  type AwarenessCursorState,
  type AwarenessEditingState,
  type AwarenessPayload,
  type AwarenessPeer,
  useAwarenessContext,
} from "@/providers/AwarenessProvider";

type PresenceEntry = {
  clientId: number;
  user: AwarenessPeer["user"];
  editing?: AwarenessEditingState;
  cursor?: AwarenessCursorState;
  ts: number;
  isSelf?: boolean;
};

export function AwarenessTab() {
  const { awareness, localUser, peers, getLocalState } = useAwarenessContext();
  const [localState, setLocalState] = useState<AwarenessPayload>(() => getLocalState());

  useEffect(() => {
    if (!awareness) {
      return;
    }

    const sync = () => {
      setLocalState(getLocalState());
    };

    sync();
    awareness.on("change", sync);
    awareness.on("update", sync);

    return () => {
      awareness.off("change", sync);
      awareness.off("update", sync);
    };
  }, [awareness, getLocalState]);

  const sortedPeers = useMemo(() => [...peers].sort((a, b) => b.ts - a.ts), [peers]);

  const localPresence: PresenceEntry = {
    clientId: awareness?.clientID ?? 0,
    user: localUser,
    editing: localState.editing,
    cursor: localState.cursor,
    ts: localState.ts,
    isSelf: true,
  };

  const peerPresence = useMemo<PresenceEntry[]>(
    () =>
      sortedPeers.map((peer) => ({
        clientId: peer.clientId,
        user: peer.user,
        editing: peer.editing,
        cursor: peer.cursor,
        ts: peer.ts,
      })),
    [sortedPeers],
  );

  return (
    <div className="space-y-6 text-xs">
      <section className="space-y-2">
        <SectionHeading title="Local Presence" subtitle="Current state published to awareness" />
        <PresenceCard presence={localPresence} />
      </section>

      <section className="space-y-2">
        <SectionHeading
          title="Peers"
          subtitle={peerPresence.length > 0 ? `${peerPresence.length} connected` : "No peers online"}
        />
        {peerPresence.length === 0 ? (
          <EmptyState message="Only you are connected right now." />
        ) : (
          <div className="space-y-2">
            {peerPresence.map((presence) => (
              <PresenceCard key={presence.clientId} presence={presence} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {subtitle && <span className="text-[10px] text-muted-foreground/80">{subtitle}</span>}
    </div>
  );
}

function PresenceCard({ presence }: { presence: PresenceEntry }) {
  const editing = presence.editing;
  const cursor = presence.cursor;
  const title = presence.isSelf ? `${presence.user.name} (you)` : presence.user.name;

  return (
    <div className="rounded border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: presence.user.color }} />
          <span className="font-semibold text-foreground">{title}</span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground/80">
          cid:{presence.clientId} · {formatTimestamp(presence.ts)}
        </div>
      </div>

      <dl className="mt-2 grid gap-1 text-[11px] font-mono text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <dt className="uppercase tracking-wide">User Id</dt>
          <dd className="truncate text-foreground">{presence.user.id}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="uppercase tracking-wide">Avatar Seed</dt>
          <dd className="truncate">{presence.user.avatarSeed}</dd>
        </div>
        {editing && (
          <div className="flex items-center justify-between gap-3">
            <dt className="uppercase tracking-wide">Editing</dt>
            <dd className="truncate text-foreground">
              {editing.origin ? `${editing.cellId} · ${editing.origin}` : editing.cellId}
            </dd>
          </div>
        )}
        {cursor && (
          <div className="flex items-center justify-between gap-3">
            <dt className="uppercase tracking-wide">Cursor</dt>
            <dd className="truncate">
              {cursor.cellId ? `${cursor.cellId} · ${cursor.selections.length} sel` : "—"}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded border border-dashed border-border/60 bg-muted/10 px-4 py-6 text-center text-[11px] text-muted-foreground">
      {message}
    </div>
  );
}

function formatTimestamp(ts: number) {
  const date = new Date(ts);
  return date.toLocaleTimeString();
}
