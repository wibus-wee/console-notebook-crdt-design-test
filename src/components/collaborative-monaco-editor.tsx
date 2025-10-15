import { useOptionalAwarenessContext, type AwarenessPeer, type AwarenessSelectionRange } from "@/providers/AwarenessProvider";
import { atom, useAtomValue } from "jotai";
import { memo, forwardRef, useRef, useMemo, useCallback, useEffect } from "react";
import { MonacoBinding } from "y-monaco";
import type { Text as YText, UndoManager } from "yjs";
import { type MonacoEditorHandle, MonacoEditor, type MonacoEditorProps } from "./monaco-editor";
import { editor, KeyCode, type IDisposable } from "monaco-editor";

const peerStyleRegistry = new Map<string, { selectionClass: string; caretClass: string; widgetClass: string }>();
let baseWidgetStylesInjected = false;

const sanitizeToken = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(-24) || "anon";

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return `rgba(0,0,0,${alpha})`;
  const intVal = Number.parseInt(normalized, 16);
  const r = (intVal >> 16) & 0xff;
  const g = (intVal >> 8) & 0xff;
  const b = intVal & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const ensureBaseWidgetStyles = () => {
  if (baseWidgetStylesInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = `
    .rw-peer-widget {
      position: absolute;
      padding: 2px 6px;
      border-radius: 4px;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      pointer-events: none;
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.25);
      transform: translate(-50%, -120%);
      white-space: nowrap;
      z-index: 1000;
    }
  `;
  document.head.append(style);
  baseWidgetStylesInjected = true;
};

const ensurePeerClasses = (peer: AwarenessPeer) => {
  const existing = peerStyleRegistry.get(peer.user.id);
  if (existing) return existing;
  if (typeof document === "undefined") {
    const fallback = { selectionClass: "", caretClass: "", widgetClass: "" };
    peerStyleRegistry.set(peer.user.id, fallback);
    return fallback;
  }
  ensureBaseWidgetStyles();
  const token = sanitizeToken(peer.user.id);
  const selectionClass = `rw-peer-selection-${token}`;
  const caretClass = `rw-peer-caret-${token}`;
  const widgetClass = `rw-peer-widget-${token}`;
  const style = document.createElement("style");
  const selectionColor = hexToRgba(peer.user.color, 0.25);
  style.textContent = `
    .monaco-editor .${selectionClass} {
      background-color: ${selectionColor};
      border-bottom: 2px solid ${peer.user.color};
    }
    .monaco-editor .${caretClass} {
      border-left: 2px solid ${peer.user.color};
      position: relative;
    }
    .rw-peer-widget.${widgetClass} {
      background-color: ${peer.user.color};
    }
  `;
  document.head.append(style);
  const classes = { selectionClass, caretClass, widgetClass };
  peerStyleRegistry.set(peer.user.id, classes);
  return classes;
};

type PossibleRef<T> = ((instance: T | null) => void) | { current: T | null } | null | undefined;

const assignRef = <T,>(ref: PossibleRef<T>, value: T | null) => {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
  } else {
    (ref as { current: T | null }).current = value;
  }
};

interface CollaborativeMonacoEditorProps extends MonacoEditorProps {
  awarenessCellId?: string;
  yText?: YText | null;
  undoManager?: UndoManager | null;
}

export const CollaborativeMonacoEditor = memo(
  forwardRef<MonacoEditorHandle, CollaborativeMonacoEditorProps>(function CollaborativeMonacoEditor(
    { awarenessCellId, yText, onMount, controlled = true, value, defaultValue, onChange, undoManager, ...rest },
    ref
  ) {
    const awarenessCtx = useOptionalAwarenessContext();
    const editorHandleRef = useRef<MonacoEditorHandle | null>(null);
    const editorInstanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const awarenessDisposablesRef = useRef<IDisposable[]>([]);
    const decorationIdsRef = useRef<string[]>([]);
    const widgetMapRef = useRef<Map<number, { widget: editor.IContentWidget; domNode: HTMLDivElement }>>(new Map());
    const cursorRafRef = useRef<number | null>(null);
    const componentOriginRef = useRef<string>(`monaco-${Math.random().toString(36).slice(2, 10)}`);
    const bindingRef = useRef<MonacoBinding | null>(null);
    const lastBoundYTextRef = useRef<YText | null>(null);
    const undoKeybindingDisposableRef = useRef<IDisposable | null>(null);
    const shouldBindYText = Boolean(yText);

    const peersAtom = awarenessCtx?.peersAtom;
    const setEditingState = awarenessCtx?.setEditingState;
    const setCursorState = awarenessCtx?.setCursorState;
    const getLocalState = awarenessCtx?.getLocalState;

    const isAwarenessActive = Boolean(awarenessCtx && awarenessCellId);

    const filteredPeersAtom = useMemo(() => {
      if (!isAwarenessActive || !peersAtom) {
        return atom<AwarenessPeer[]>([]);
      }
      return atom((get) => {
        const peers = get(peersAtom);
        return peers.filter((peer) => peer.cursor?.cellId === awarenessCellId);
      });
    }, [isAwarenessActive, peersAtom, awarenessCellId]);

    const remoteCursorPeers = useAtomValue(filteredPeersAtom);

    const handleForwardedRef = useCallback(
      (handle: MonacoEditorHandle | null) => {
        editorHandleRef.current = handle;
        assignRef(ref, handle);
      },
      [ref]
    );

    const disposeAwarenessDisposables = useCallback(() => {
      awarenessDisposablesRef.current.forEach((disposable) => {
        try {
          disposable.dispose();
        } catch {}
      });
      awarenessDisposablesRef.current = [];
    }, []);

    const setupBinding = useCallback(() => {
      if (typeof window === "undefined") return;
      const instance = editorInstanceRef.current;
      if (!instance) return;

      if (bindingRef.current && lastBoundYTextRef.current === yText) {
        return;
      }

      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      lastBoundYTextRef.current = null;

      if (!yText) return;

      const model = instance.getModel();
      if (!model) return;

      const editorsSet = new Set<editor.IStandaloneCodeEditor>([instance]);
      bindingRef.current = new MonacoBinding(yText, model, editorsSet);
      lastBoundYTextRef.current = yText;
    }, [yText]);

    const scheduleCursorBroadcast = useCallback(
      (immediate = false) => {
        if (!isAwarenessActive || !setCursorState || !getLocalState || !awarenessCellId) return;

        const pushState = () => {
          const instance = editorInstanceRef.current;
          if (!instance) return;
          const selections = instance.getSelections() ?? [];
          const normalized: AwarenessSelectionRange[] = selections.map((sel) => ({
            startLineNumber: sel.startLineNumber,
            startColumn: sel.startColumn,
            endLineNumber: sel.endLineNumber,
            endColumn: sel.endColumn,
          }));
          
          if (normalized.length === 0) {
            const current = getLocalState();
            if (current.cursor?.cellId === awarenessCellId) {
              setCursorState(null);
            }
            return;
          }
          console.log("Broadcasting cursor for cell", awarenessCellId, normalized);
          setCursorState({ cellId: awarenessCellId, selections: normalized });
        };

        if (typeof window === "undefined") {
          pushState();
          return;
        }

        if (cursorRafRef.current !== null) {
          window.cancelAnimationFrame(cursorRafRef.current);
          cursorRafRef.current = null;
        }

        if (immediate) {
          pushState();
          return;
        }

        cursorRafRef.current = window.requestAnimationFrame(() => {
          cursorRafRef.current = null;
          pushState();
        });
      },
      [awarenessCellId, getLocalState, isAwarenessActive, setCursorState]
    );

    const attachAwarenessHandlers = useCallback(() => {
      const instance = editorInstanceRef.current;
      if (!instance || !isAwarenessActive) {
        disposeAwarenessDisposables();
        return;
      }

      disposeAwarenessDisposables();
      const origin = componentOriginRef.current;

      if (instance.hasTextFocus()) {
        setEditingState?.({ cellId: awarenessCellId, isMonaco: true, origin });
        scheduleCursorBroadcast(true);
      }

      const focusDisposable = instance.onDidFocusEditorWidget(() => {
        setEditingState?.({ cellId: awarenessCellId, isMonaco: true, origin });
        scheduleCursorBroadcast(true);
      });

      const blurDisposable = instance.onDidBlurEditorWidget(() => {
        if (typeof window !== "undefined" && cursorRafRef.current !== null) {
          window.cancelAnimationFrame(cursorRafRef.current);
          cursorRafRef.current = null;
        }
        if (getLocalState?.().cursor?.cellId === awarenessCellId) {
          setCursorState?.(null);
        }
        const current = getLocalState?.();
        if (current?.editing?.cellId === awarenessCellId && current?.editing?.origin === origin) {
          setEditingState?.(null);
        }
      });

      const selectionDisposable = instance.onDidChangeCursorSelection(() => {
        if (!instance.hasTextFocus()) return;
        scheduleCursorBroadcast();
      });

      awarenessDisposablesRef.current.push(focusDisposable, blurDisposable, selectionDisposable);
    }, [awarenessCellId, disposeAwarenessDisposables, getLocalState, isAwarenessActive, scheduleCursorBroadcast, setCursorState, setEditingState]);

    useEffect(() => {
      setupBinding();
    }, [setupBinding]);

    useEffect(() => {
      attachAwarenessHandlers();
    }, [attachAwarenessHandlers]);

    useEffect(() => {
      const instance = editorInstanceRef.current;
      if (!instance) return;
      if (isAwarenessActive) return;
      decorationIdsRef.current = instance.deltaDecorations(decorationIdsRef.current, []);
      widgetMapRef.current.forEach(({ widget }) => {
        instance.removeContentWidget(widget);
      });
      widgetMapRef.current.clear();
    }, [isAwarenessActive]);

    useEffect(() => {
      const instance = editorInstanceRef.current;
      if (!instance || !isAwarenessActive) return;

      const decorations: editor.IModelDeltaDecoration[] = [];
      const activePeerIds = new Set<number>();

      remoteCursorPeers.forEach((peer) => {
        if (!peer.cursor?.selections?.length) return;
        const classes = ensurePeerClasses(peer);

        peer.cursor.selections.forEach((range) => {
          decorations.push({
            range,
            options: {
              className: classes.selectionClass,
              inlineClassName: classes.selectionClass,
            },
          });

          decorations.push({
            range: {
              startLineNumber: range.endLineNumber,
              startColumn: range.endColumn,
              endLineNumber: range.endLineNumber,
              endColumn: range.endColumn,
            },
            options: {
              className: classes.caretClass,
              inlineClassName: classes.caretClass,
            },
          });
        });

        const last = peer.cursor.selections[peer.cursor.selections.length - 1];
        if (!last) return;

        activePeerIds.add(peer.clientId);
        let record = widgetMapRef.current.get(peer.clientId);
        if (!record) {
          if (typeof document === "undefined") return;
          const domNode = document.createElement("div");
          const widgetId = `rw-peer-widget-${peer.clientId}`;
          const widget: editor.IContentWidget = {
            getId: () => widgetId,
            getDomNode: () => domNode,
            getPosition: () => ({
              position: { lineNumber: last.endLineNumber, column: last.endColumn },
              preference: [
                editor.ContentWidgetPositionPreference.ABOVE,
                editor.ContentWidgetPositionPreference.BELOW,
              ],
            }),
          };
          record = { widget, domNode };
          widgetMapRef.current.set(peer.clientId, record);
          instance.addContentWidget(widget);
        }

        record.domNode.className = `rw-peer-widget ${ensurePeerClasses(peer).widgetClass}`;
        record.domNode.textContent = peer.user.name;
        record.widget.getPosition = () => ({
          position: { lineNumber: last.endLineNumber, column: last.endColumn },
          preference: [
            editor.ContentWidgetPositionPreference.ABOVE,
            editor.ContentWidgetPositionPreference.BELOW,
          ],
        });
        instance.layoutContentWidget(record.widget);
      });

      decorationIdsRef.current = instance.deltaDecorations(decorationIdsRef.current, decorations);

      widgetMapRef.current.forEach((record, peerId) => {
        if (!activePeerIds.has(peerId)) {
          instance.removeContentWidget(record.widget);
          widgetMapRef.current.delete(peerId);
        }
      });
    }, [isAwarenessActive, remoteCursorPeers]);

    useEffect(() => {
      return () => {
        const instance = editorInstanceRef.current;
        disposeAwarenessDisposables();
        if (typeof window !== "undefined" && cursorRafRef.current !== null) {
          window.cancelAnimationFrame(cursorRafRef.current);
          cursorRafRef.current = null;
        }
        if (instance) {
          decorationIdsRef.current = instance.deltaDecorations(decorationIdsRef.current, []);
          widgetMapRef.current.forEach(({ widget }) => {
            instance.removeContentWidget(widget);
          });
          widgetMapRef.current.clear();
        }
        if (undoKeybindingDisposableRef.current) {
          try {
            undoKeybindingDisposableRef.current.dispose();
          } catch {}
          undoKeybindingDisposableRef.current = null;
        }
        if (awarenessCellId && getLocalState) {
          const current = getLocalState();
          if (current.cursor?.cellId === awarenessCellId) {
            setCursorState?.(null);
          }
          if (current.editing?.cellId === awarenessCellId && current.editing.origin === componentOriginRef.current) {
            setEditingState?.(null);
          }
        }
        if (bindingRef.current) {
          bindingRef.current.destroy();
          bindingRef.current = null;
        }
        lastBoundYTextRef.current = null;
        editorInstanceRef.current = null;
      };
    }, [awarenessCellId, disposeAwarenessDisposables, getLocalState, setCursorState, setEditingState]);

    const updateUndoBinding = useCallback(
      (instance: editor.IStandaloneCodeEditor | null) => {
        if (undoKeybindingDisposableRef.current) {
          try {
            undoKeybindingDisposableRef.current.dispose();
          } catch {}
          undoKeybindingDisposableRef.current = null;
        }
        if (!instance || !undoManager) return;
        const disposable = instance.onKeyDown((event) => {
          const usesModifier = event.metaKey || event.ctrlKey;
          if (!usesModifier) return;
          const isUndo = !event.shiftKey && event.keyCode === KeyCode.KeyZ;
          const isRedo = event.keyCode === KeyCode.KeyY || (event.shiftKey && event.keyCode === KeyCode.KeyZ);
          if (!isUndo && !isRedo) return;
          event.preventDefault();
          event.stopPropagation();
          if (isUndo) {
            undoManager.undo();
          } else {
            undoManager.redo();
          }
        });
        undoKeybindingDisposableRef.current = disposable;
      },
      [undoManager]
    );

    const handleEditorMount = useCallback(
      (instance: editor.IStandaloneCodeEditor) => {
        editorInstanceRef.current = instance;
        attachAwarenessHandlers();
        setupBinding();
        updateUndoBinding(instance);
        onMount?.(instance);
      },
      [attachAwarenessHandlers, onMount, setupBinding, updateUndoBinding]
    );

    useEffect(() => {
      updateUndoBinding(editorInstanceRef.current ?? null);
    }, [updateUndoBinding]);

    let editorControlProps: Partial<MonacoEditorProps>;
    if (shouldBindYText) {
      editorControlProps = {
        controlled: false,
        defaultValue: defaultValue ?? value ?? yText?.toString() ?? "",
      };
    } else if (controlled) {
      editorControlProps = {
        controlled: true,
        value,
        onChange,
        defaultValue,
      };
    } else {
      editorControlProps = {
        controlled: false,
        defaultValue,
        onChange,
      };
    }

    return (
      <MonacoEditor
        {...rest}
        {...editorControlProps}
        ref={handleForwardedRef}
        onMount={handleEditorMount}
      />
    );
  })
);
