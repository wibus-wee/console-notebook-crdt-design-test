"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import Editor, { type OnMount, type OnChange } from "@monaco-editor/react";
import { cn } from "@/lib/utils";
import { editor, type IDisposable } from "monaco-editor";

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
}

interface MonacoEditorHandle {
  focus: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  getEditor: () => editor.IStandaloneCodeEditor | null;
}

const MonacoEditor = memo(
  forwardRef<MonacoEditorHandle, MonacoEditorProps>(function MonacoEditor(
    {
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
    },
    ref
  ) {
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const contentSizeDisposableRef = useRef<IDisposable | null>(null);
    const [editorHeight, setEditorHeight] = useState<number>(typeof height === "number" ? height : 200);

    useEffect(() => {
      return () => {
        if (editorRef.current) {
          try {
            contentSizeDisposableRef.current?.dispose();
          } catch {}
          contentSizeDisposableRef.current = null;
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
        updateHeight();
      }
    }, [value, autoResize, updateHeight]);

    const handleEditorDidMount: OnMount = useCallback(
      (instance) => {
        editorRef.current = instance;

        if (autoResize) {
          updateHeight();
          try {
            contentSizeDisposableRef.current?.dispose();
          } catch {}
          contentSizeDisposableRef.current = instance.onDidContentSizeChange(() => {
            updateHeight();
          });
        }

        onMount?.(instance);
      },
      [autoResize, onMount, updateHeight]
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
          {...(controlled ? { value, onChange: handleEditorChange } : { defaultValue })}
          theme={"vs-dark"}
          onMount={handleEditorDidMount}
          options={defaultOptions}
          loading={<div className="min-h-40" />}
        />
      </div>
    );
  })
);



export { MonacoEditor };
export type { MonacoEditorHandle, MonacoEditorProps };
