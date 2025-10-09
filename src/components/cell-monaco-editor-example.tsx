"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { useAtomValue } from "jotai";
import { MonacoBinding } from "y-monaco";
import { MonacoEditor, type MonacoEditorProps } from "@/components/monaco-editor";
import { cellLanguageAtom, cellTextAtom } from "@/atoms/cell";

interface CellMonacoEditorProps
  extends Omit<
    MonacoEditorProps,
    | "value"
    | "onChange"
    | "onMount"
    | "readOnly"
    | "controlled"
    | "defaultValue"
  > {
  /** Notebook cell id to bind. */
  cellId: string;
  /** Optional awareness from your provider (e.g. y-websocket/webrtc). */
  awareness?: unknown;
}

/**
 * CellMonacoEditor Example
 * - Binds a cell's Y.Text to Monaco via y-monaco.
 * - Uses MonacoEditor in uncontrolled mode; edits propagate directly to Y.Text.
 * - Provide `awareness` if you want cursors/selection presence.
 */
export const CellMonacoEditor = memo(function CellMonacoEditor({
  cellId,
  language,
  awareness,
  height = 200,
  className,
  options,
  autoResize,
  minHeight,
  maxHeight,
}: CellMonacoEditorProps) {
  const yText = useAtomValue(cellTextAtom(cellId));
  const lang = useAtomValue(cellLanguageAtom(cellId));

  // Stable initial value for uncontrolled editor; computed when Y.Text is available.
  const [initialValue, setInitialValue] = useState<string>("");
  useEffect(() => {
    if (yText) setInitialValue(yText.toString());
  }, [yText]);

  // Keep a ref to the live Monaco editor and binding for cleanup.
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const bindingRef = useRef<any>(null);

  // Clean up binding on unmount or when re-binding.
  useEffect(() => {
    return () => {
      try {
        bindingRef.current?.destroy?.();
        bindingRef.current?.dispose?.();
      } finally {
        bindingRef.current = null;
      }
    };
  }, []);

  // Mount callback to attach y-monaco binding once editor + Y.Text are ready.
  const handleMount = async (ed: editor.IStandaloneCodeEditor) => {
    editorRef.current = ed;
    // Recreate binding on mount if we already have Y.Text
    if (!yText) return;
    const model = ed.getModel();
    if (!model) return;
    try {
      // Clean any previous binding just in case.
      bindingRef.current?.destroy?.();
      bindingRef.current?.dispose?.();
      bindingRef.current = new MonacoBinding(yText, model, new Set([ed]), awareness as any);
    } catch (e) {
      console.warn("Failed to load y-monaco for binding", e);
    }
  };

  // If the Y.Text handle changes (e.g., cell switch), rebuild the binding.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !yText) return;
    (async () => {
      try {
        const model = ed.getModel();
        if (!model) return;
        const mod: any = await import("y-monaco");
        const MonacoBinding = mod?.MonacoBinding ?? mod?.default?.MonacoBinding;
        if (!MonacoBinding) return;
        bindingRef.current?.destroy?.();
        bindingRef.current?.dispose?.();
        bindingRef.current = new MonacoBinding(yText, model, new Set([ed]), awareness as any);
      } catch (e) {
        console.warn("Failed to rebind y-monaco", e);
      }
    })();
    // Cleanup old binding when handle changes
    return () => {
      try {
        bindingRef.current?.destroy?.();
        bindingRef.current?.dispose?.();
      } finally {
        bindingRef.current = null;
      }
    };
  }, [yText, awareness]);

  // Don't render editor until we have a Y.Text handle.
  if (!yText) {
    return <div className={className} style={{ height }}>Loading editor…</div>;
  }

  return (
    <MonacoEditor
      key={cellId}
      controlled={false}
      defaultValue={initialValue}
      language={language ?? lang ?? "sql"}
      onMount={handleMount}
      height={height}
      className={className}
      options={options}
      autoResize={autoResize}
      minHeight={minHeight}
      maxHeight={maxHeight}
    />
  );
});

export type { CellMonacoEditorProps };

