"use client";

import { memo, useRef, useCallback, useImperativeHandle, useEffect, useState } from "react";
import Editor, { type OnMount, type OnChange } from "@monaco-editor/react";
import { cn } from "@/lib/utils";
import type { editor } from "monaco-editor";

interface MonacoEditorProps {
  value?: string;
  /** When false, the editor is uncontrolled and uses defaultValue. */
  controlled?: boolean;
  /** Only used when controlled === false */
  defaultValue?: string;
  language?: string;
  onChange?: (value: string) => void;
  onMount?: (editor: editor.IStandaloneCodeEditor) => void;
  placeholder?: string;
  height?: string | number;
  className?: string;
  options?: editor.IStandaloneEditorConstructionOptions;
  readOnly?: boolean;
  autoResize?: boolean;
  minHeight?: number;
  maxHeight?: number;
  ref?: React.Ref<MonacoEditorHandle>;
}

interface MonacoEditorHandle {
  focus: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  getEditor: () => editor.IStandaloneCodeEditor | null;
}

const MonacoEditor = memo(function MonacoEditor({
  value = "",
  controlled = true,
  defaultValue,
  language = "sql",
  onChange,
  onMount,
  height = 200,
  className,
  options,
  readOnly = false,
  autoResize = false,
  minHeight = 100,
  maxHeight = 600,
  ref,
}: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [editorHeight, setEditorHeight] = useState<number>(
    typeof height === 'number' ? height : 200
  );

  useEffect(() => {
    return () => {
      // Cleanup editor instance when component unmounts
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  const updateHeight = useCallback(() => {
    if (!autoResize || !editorRef.current) return;

    const contentHeight = editorRef.current.getContentHeight();
    const newHeight = Math.max(minHeight, Math.min(contentHeight, maxHeight));
    
    if (newHeight !== editorHeight) {
      setEditorHeight(newHeight);
      editorRef.current.layout();
    }
  }, [autoResize, editorHeight, minHeight, maxHeight]);

  useEffect(() => {
    if (autoResize && editorRef.current) {
      // Update height when value changes
      updateHeight();
      
      // Listen to content size changes
      const disposable = editorRef.current.onDidContentSizeChange(() => {
        updateHeight();
      });

      return () => {
        disposable.dispose();
      };
    }
  }, [value, autoResize, updateHeight]);

  const handleEditorDidMount: OnMount = useCallback(
    (editor) => {
      editorRef.current = editor;

      if (autoResize) {
        // Initial height update
        updateHeight();

        // Listen to content size changes
        editor.onDidContentSizeChange(() => {
          updateHeight();
        });
      }

      onMount?.(editor);
    },
    [onMount, autoResize, updateHeight]
  );

  const handleEditorChange: OnChange = useCallback(
    (newValue) => {
      onChange?.(newValue || "");
    },
    [onChange]
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.focus(),
      getValue: () => editorRef.current?.getValue() || "",
      setValue: (newValue: string) => editorRef.current?.setValue(newValue),
      getEditor: () => editorRef.current,
    }),
    []
  );

  const defaultOptions: editor.IStandaloneEditorConstructionOptions = {
    minimap: { enabled: false },
    lineNumbers: "on",
    fontSize: 14,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: "on",
    folding: false,
    renderLineHighlight: "all",
    smoothScrolling: true,
    cursorBlinking: "smooth",
    suggestOnTriggerCharacters: true,
    quickSuggestions: true,
    parameterHints: { enabled: true },
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    bracketPairColorization: { enabled: true },
    readOnly,
    scrollBeyondLastLine: !autoResize,
    ...options,
  };

  return (
    <div className={cn("border rounded-md overflow-hidden", className)}>
      <Editor
        className="h-auto min-h-40"
        height={autoResize ? editorHeight : height}
        language={language}
        {...(controlled
          ? { value, onChange: handleEditorChange }
          : { defaultValue })}
        theme={"light"}
        onMount={handleEditorDidMount}
        options={defaultOptions}
        loading={
          <div className="min-h-40"></div>
        }
      />
    </div>
  );
});

export { MonacoEditor };
export type { MonacoEditorHandle, MonacoEditorProps };
