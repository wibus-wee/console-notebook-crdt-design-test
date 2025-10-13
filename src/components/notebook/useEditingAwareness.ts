import { useCallback, useEffect } from "react";
import { useAwarenessContext } from "@/providers/AwarenessProvider";

/**
 * Small helper hook to claim and release editing awareness for a given cell/input.
 * Guards against clobbering another origin that may have taken over.
 */
export const useEditingAwareness = (cellId: string, origin: string) => {
  const { setEditingState, getLocalState } = useAwarenessContext();

  const release = useCallback(() => {
    const current = getLocalState();
    if (current.editing?.cellId === cellId && current.editing.origin === origin) {
      setEditingState(null);
    }
  }, [cellId, origin, getLocalState, setEditingState]);

  const claim = useCallback(() => {
    setEditingState({ cellId, origin });
  }, [cellId, origin, setEditingState]);

  useEffect(
    () => () => {
      release();
    },
    [release],
  );

  return { claim, release };
};
