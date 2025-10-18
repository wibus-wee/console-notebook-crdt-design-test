# Notebook Dev Panel Usage

This folder exports two entry points so you can choose between the provider-aware wrapper (works out of the box in this repo) and the portable core component that only depends on the Yjs notebook schema objects.

## 1. Provider Wrapper (current project)

```tsx
import { NotebookDevPanel } from "@/components/in-page/NotebookDevPanel";

export function NotebookView() {
  return (
    <NotebookProvider room={room} serverUrl={serverUrl}>
      {/* ...your notebook UI... */}
      <NotebookDevPanel defaultOpen defaultSize={{ width: 720, height: 420 }} />
    </NotebookProvider>
  );
}
```

- Must be rendered inside `NotebookProvider`.
- Optional props:
  - `defaultOpen?: boolean`
  - `defaultSize?: { width: number; height: number }`
  - `resizableStorageKey?: string`
  - `isDev?: boolean` (force-enable/disable; defaults to `import.meta.env.DEV`)

## 2. Core Component (portable)

```tsx
import {
  NotebookDevPanelCore,
  type NotebookDevPanelProps,
} from "@/components/in-page/NotebookDevPanel";

function DevPanelAdapter(props: Partial<NotebookDevPanelProps>) {
  const { notebook, doc, status, undoManager } = useYourNotebookContext();
  const snapshot = useYourSnapshotAtom();
  const report = useNotebookReport(notebook, snapshot); // helper exported from ./hooks
  const undoHistory = useYourUndoHistory();
  const traffic = useYourTrafficLog(); // optional
  const awareness = useAwarenessPresence(); // optional

  return (
    <NotebookDevPanelCore
      notebook={notebook}
      doc={doc}
      status={status}
      report={report}
      undoHistory={undoHistory}
      undoManager={undoManager}
      traffic={traffic}
      awareness={awareness}
      {...props}
    />
  );
}
```

### Required props

| Prop | Type | Notes |
| --- | --- | --- |
| `notebook` | `YNotebook` | Root notebook map from `@/yjs/schema`. |
| `doc` | `Y.Doc` | The underlying Yjs document (`notebook.doc`). |
| `status` | `"connecting" \| "connected" \| "disconnected"` | Connection indicator for the header. |
| `report` | `NotebookReport` | Use `useNotebookReport()` helper to derive from `YNotebook` + snapshot. |
| `undoHistory` | `UndoHistorySnapshot` | Usually from `NotebookUndoHistory.getSnapshot()`. |
| `undoManager` | `Pick<UndoManager, "undo" \| "redo" \| "stopCapturing" \| "clear">` | Minimal interface needed by the Undo tab. |

### Optional props

- `traffic?: DevPanelTrafficEntry[]` — array describing websocket payloads (matches provider usage).
- `awareness?: AwarenessPanelData` — presence info shown in the Awareness tab.
- `defaultOpen`, `defaultSize`, `resizableStorageKey`, `isDev` — same as wrapper.

### Awareness data shape

```ts
type AwarenessPanelData = {
  self?: {
    clientId: number;
    user: { id: string; name: string; color: string; avatarSeed: string };
    editing?: { cellId?: string; isMonaco?: boolean; origin?: string };
    cursor?: { cellId?: string; selections: AwarenessSelectionRange[] };
    ts: number;
  };
  peers: AwarenessPresence[]; // same shape as `self`
};
```

When omitted, the Awareness tab renders an empty state.

### Traffic entries

```ts
type DevPanelTrafficEntry = {
  id: number;
  ts: number;
  type: "update" | "awareness";
  direction: "incoming" | "outgoing";
  size?: number;
  details: string;
  preview?: string;
  decoded?: {
    structs: Array<{ index: number; type: string; summary: string; details?: string[] }>;
    deletes: Array<{ client: number; clock: number; len: number }>;
  };
};
```

If `traffic` is missing, the Traffic tab still shows but will be empty.

## Helpers

- `useNotebookReport(notebook, snapshot)` is exported from `./hooks`. It expects the CRDT notebook and a plain snapshot of cells (the provider uses Jotai, but you can plug in your own snapshot source).
- `NotebookDevPanelCore` is layout-only; any feature you do not support can be hidden by omitting its data. For example, skip `traffic` to hide entries, or pass a mock `undoHistory` if you do not track undo.
