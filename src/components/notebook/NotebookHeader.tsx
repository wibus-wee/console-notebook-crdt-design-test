import { useMemo } from "react";
import { useAtom } from "jotai";
import { useAwarenessContext, useCellPeers } from "@/providers/AwarenessProvider";
import type { NotebookAtoms } from "@/yjs/jotai/notebookAtoms";
import { TITLE_AWARENESS_CELL_ID } from "./constants";
import { useEditingAwareness } from "./useEditingAwareness";

interface NotebookHeaderProps {
  titleAtom: NotebookAtoms["titleAtom"];
}

export const NotebookHeader = ({ titleAtom }: NotebookHeaderProps) => {
  const [title, setTitle] = useAtom(titleAtom);
  const { localUser, peers } = useAwarenessContext();
  const titlePeers = useCellPeers(TITLE_AWARENESS_CELL_ID);
  const { claim, release } = useEditingAwareness(TITLE_AWARENESS_CELL_ID, "title-input");

  const connectedUsers = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        color: string;
        isSelf?: boolean;
      }
    >();
    map.set(localUser.id, { id: localUser.id, name: localUser.name, color: localUser.color, isSelf: true });
    peers.forEach((peer) => {
      if (!map.has(peer.user.id)) {
        map.set(peer.user.id, {
          id: peer.user.id,
          name: peer.user.name,
          color: peer.user.color,
        });
      }
    });
    return Array.from(map.values());
  }, [localUser, peers]);

  return (
    <header className="space-y-8 animate-fade-in">
      {/* Connected Users - Top Right */}
      {connectedUsers.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {connectedUsers.length} {connectedUsers.length === 1 ? "user" : "users"} online
          </span>
          <div className="flex items-center -space-x-2">
            {connectedUsers.map((user) => (
              <div
                key={user.id}
                className="group relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-background transition-transform hover:z-10 hover:scale-110"
                style={{ backgroundColor: user.color }}
                title={user.name}
              >
                <span className="text-xs font-semibold text-white">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                {user.isSelf && (
                  <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-success" />
                )}
                {/* Tooltip */}
                <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 scale-0 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100">
                  {user.isSelf ? `${user.name} (you)` : user.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notebook Title */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="notebook-title">
            Notebook Title
          </label>
          {titlePeers.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              <span className="text-xs font-medium text-accent">
                {titlePeers.map((peer) => peer.user.name).join(", ")} editing
              </span>
            </div>
          )}
        </div>
        <input
          id="notebook-title"
          className="w-full border-0 border-b-2 border-border bg-transparent px-0 py-3 text-3xl font-bold text-foreground transition-all placeholder:text-muted-foreground/30 focus:border-foreground focus:outline-none"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={claim}
          onBlur={release}
          placeholder="Untitled Notebook"
        />
      </div>
    </header>
  );
};
