# Y.js Notebook CRDT Schema: Developer's Guide

## 1. Introduction

This document outlines the architecture and best practices for using the Y.js-based collaborative notebook schema. This schema is designed for real-time, multi-user editing of notebooks, providing a robust "Map-Reduce" like data model that includes features like cell management, code execution state, soft deletion, and a scoped undo/redo system.

Understanding this architecture is key to building a stable and predictable user experience.

## 2. Schema Architecture

Our Y.js document is more than just a collection of keys; it's a structured system where different parts are intentionally separated to manage complexity, control the undo history, and optimize performance.

The root of the document is a `Y.Map` accessible via the key `rw-notebook-root`. All notebook data resides within this root map.

### 2.1. Top-Level Structure

The root map contains several key top-level entries:

| Key (`/src/yjs/schema/core/keys.ts`) | Type | Description |
| :--- | :--- | :--- |
| `NB_ID`, `NB_TITLE`, `NB_DATABASE_ID` | `string` | Scalar properties of the notebook. |
| `NB_TAGS` | `Y.Array<string>` | A list of notebook tags. |
| `NB_METADATA` | `Y.Map` | Application-specific metadata (e.g., `appVersion`). |
| `NB_CELL_MAP` | `Y.Map<YCell>` | **The core storage for all cells.** Maps a unique `cellId` to its `YCell` object. |
| `NB_CELL_ORDER` | `Y.Array<string>` | **Defines the notebook's layout.** An array of `cellId`s that dictates the visible order of cells. |
| `NB_OUTPUTS` | `Y.Map<YOutputEntry>`| **Decoupled execution results.** Maps a `cellId` to its output state (running, stale, result, etc.). |
| `NB_TOMBSTONES` | `Y.Map<boolean>` | **Soft-delete flags.** Maps a `cellId` to `true` if it has been soft-deleted. |
| `NB_TOMBSTONE_META` | `Y.Map<Y.Map>` | **Metadata for soft-deleted cells** (e.g., deletion timestamp, reason). |
| `SCHEMA_META_KEY` | `Y.Map` | Internal schema metadata, primarily for tracking the schema `version`. |

### 2.2. Cell Management: The "Map + Order" Pattern

A core design choice is the separation of cell content from cell order.

- **`NB_CELL_MAP` (The "What"):** This `Y.Map` acts as a key-value store where every cell, identified by a unique `cellId`, lives. This allows for constant-time `O(1)` lookups of any cell's data, which is highly efficient. A `YCell` itself is a `Y.Map` containing its `source` (`Y.Text`), `kind`, `metadata`, etc.

- **`NB_CELL_ORDER` (The "Where"):** This `Y.Array` stores only the `cellId` strings. Its sequence represents the rendered order of cells in the UI.

**Why this pattern?**
1.  **Efficiency:** Moving a cell doesn't require moving its entire content blob (which could be large). You only need to move a small string ID within the `NB_CELL_ORDER` array.
2.  **Atomicity:** An operation like moving a cell is a single, clean modification to one array, making it a discrete, undoable action.
3.  **Data Integrity:** It allows for "orphan" cells (in the map but not the order), which can be useful for recovery or specific application logic. The provided `reconcileNotebook` tool can clean these up.

### 2.3. Decoupled Outputs: The `NB_OUTPUTS` Map

Critically, a cell's execution output **is not** stored inside its `YCell` in the `NB_CELL_MAP`. Instead, it lives in the separate, top-level `NB_OUTPUTS` map.

**Why are outputs separate?**
1.  **Undo/Redo Control:** The `UndoManager` is configured to track changes to `NB_CELL_MAP` and `NB_CELL_ORDER` but **not** `NB_OUTPUTS`. This prevents a user's "undo" action (e.g., undoing a text change) from accidentally reverting a cell's execution result.
2.  **Separation of Concerns:** Cell content is the user's domain. Execution output is the system's response. This separation keeps the data model clean.
3.  **Performance:** Outputs can be large. Keeping them separate avoids bloating the `YCell` objects and allows for more granular loading strategies if needed.

### 2.4. Soft Deletion & Vacuuming: The Tombstone Lifecycle

Deleting a cell is a multi-stage, non-destructive process.

1.  **Soft Deletion (`softDeleteCell`):** When a user "deletes" a cell, it is not removed from the document. Instead:
    *   Its `cellId` is removed from `NB_CELL_ORDER` (disappears from the UI).
    *   A flag is set in `NB_TOMBSTONES` (`tombstones.set(cellId, true)`).
    *   Metadata (like `deletedAt` timestamp) is added to `NB_TOMBSTONE_META`.
    *   The actual cell data remains in `NB_CELL_MAP`. This makes the "delete" action easily **undoable** and allows for a "trash" or "restore" feature.

2.  **Vacuuming (`vacuumNotebook`):** This is a destructive, non-reversible maintenance operation. It scans for tombstoned cells that meet specific criteria (e.g., have been deleted for more than 30 days, have a trusted timestamp).
    *   If conditions are met, the cell is permanently deleted from `NB_CELL_MAP`, `NB_TOMBSTONES`, `NB_TOMBSTONE_META` and `NB_OUTPUTS`.
    *   This is a cleanup task that should be run periodically by a trusted peer or backend service, **not** by a typical client.

## 3. Best Practices & Usage Guide

To interact with the schema, you should almost always use the provided operation functions instead of directly manipulating the Y-types. These functions encapsulate essential logic, such as using the correct `origin` for undo/redo tracking.

### 3.1. Initialization and Migration

1.  **Creating a Doc:** Start with a new `Y.Doc()`.
2.  **Bootstrapping:** Call `bootstrapDoc(doc, initialModel?)` to set up the entire schema structure (root key, maps, arrays). This function is idempotent and safe to call on an existing doc. It also enables the `auto-stale` mechanism by default.
3.  **Migration:** **Always** run `migrateNotebookSchema(doc)` after bootstrapping. This ensures the document's schema version is up-to-date with your application code. It will apply any necessary migrations and can also run `reconcileNotebook` to fix integrity issues.

```typescript
import * as Y from "yjs";
import { bootstrapDoc, migrateNotebookSchema } from "@/yjs/schema";

const doc = new Y.Doc();
// Set up the basic structure
bootstrapDoc(doc, { title: "My New Notebook" });
// Ensure the schema is up-to-date and consistent
migrateNotebookSchema(doc, { autoReconcile: true });
```

### 3.2. Cell Operations (CRUD)

- **Create:** First, create a cell with `createCell(model)`, then insert it into the notebook with `insertCell(nb, cell, index)`.

  ```typescript
  import { createCell, insertCell } from "@/yjs/schema";
  const newCell = createCell({ kind: "sql", source: "SELECT * FROM t;" });
  insertCell(notebookRoot, newCell, 0); // Insert at the top
  ```

- **Read:** Use the conversion utilities to get plain JavaScript objects suitable for UI rendering. This is crucial for frameworks like React.

  ```typescript
  import { yNotebookToModel, listCells, yCellToModel } from "@/yjs/schema";

  // Get all cells as an ordered array of models
  const cellModels = listCells(notebookRoot).map(yCellToModel);

  // Or get the entire notebook model
  const notebookModel = yNotebookToModel(notebookRoot);
  ```

- **Update:** To modify a cell's source, get the underlying `Y.Text` object and perform operations on it. The `auto-stale` mechanism will automatically mark the cell's output as stale.

  ```typescript
  import { getCell } from "@/yjs/schema";
  import * as Y from "yjs";

  const cell = getCell(notebookRoot, cellId);
  const source = cell?.get("source") as Y.Text | undefined;
  source?.insert(0, "-- My comment\n");
  ```

- **Delete (User Action):** Use `softDeleteCell(nb, cellId)` for all user-initiated deletions. This is the **standard, undoable** way to delete.

- **Move:** Use `moveCell(nb, cellId, toIndex)`.

### 3.3. Code Execution Flow

The `runId` is a key concept for preventing race conditions where a late result from a previous execution overwrites a newer one.

1.  **Start Execution:** Call `startExecuteCell(nb, cellId)`. This sets `running: true`, `stale: false`, and generates a unique `runId` for this execution attempt.

2.  **Process on Backend:** Send the code to your backend. The backend should ideally receive the `runId`.

3.  **Apply Result:** When the backend responds, use `applyExecuteResult` with the `expectedRunId` to safely apply the result.

    ```typescript
    import { startExecuteCell, applyExecuteResult } from "@/yjs/schema";
    import { getOutputsMap } from "@/yjs/schema";

    // 1. User clicks "Run"
    startExecuteCell(notebookRoot, cellId);
    const runId = getOutputsMap(notebookRoot).get(cellId)?.get("runId");

    // 2. Send to backend...
    const result = await myApi.execute(source, runId);

    // 3. Backend returns; apply the result
    applyExecuteResult(notebookRoot, cellId, result, {
      expectedRunId: runId, // This acts as a concurrency lock
    });

    // A simpler alternative is available if you don't pass runId around:
    // applyExecuteResultForCurrentRun(notebookRoot, cellId, result);
    ```

### 3.4. Undo and Redo

Setting up the undo manager is straightforward. It is pre-configured to only track the relevant data structures and origins.

```typescript
import { createNotebookUndoManager } from "@/yjs/schema";

const undoManager = createNotebookUndoManager(notebookRoot);

// Later, in your UI...
button.onclick = () => undoManager.undo();
button2.onclick = () => undoManager.redo();
```

## 4. API Guide: Public vs. Internal

Treat the schema functions like a library. Some are for general use, others are for internal tooling.

### Recommended Public API (For Application Developers)

These are your primary tools for building notebook features.

- **Setup:** `bootstrapDoc`, `migrateNotebookSchema`
- **Cell Ops:** `createCell`, `insertCell`, `softDeleteCell`, `restoreCell`, `moveCell`
- **Execution:** `startExecuteCell`, `applyExecuteResult`, `applyExecuteResultForCurrentRun`
- **Data Access/Conversion:** `yNotebookToModel`, `yCellToModel`, `yOutputsToModel`, `listCells`, `getCell`, `getOutputsMap`, `getOutputEntry`
- **Quality/Undo:** `createNotebookUndoManager`

### Internal & Maintenance APIs (Use with Caution)

These functions are powerful but have side effects. They are typically not undoable and can perform destructive actions. They are best suited for maintenance scripts, migrations, or backend processes.

- **`removeCell`**: The "hard delete." It's permanent and not tracked by the undo manager. Use `softDeleteCell` for UI actions.
- **`reconcileNotebook` / `reconcileOutputs`**: Fixes data inconsistencies. While useful, it makes direct changes under the `MAINT_ORIGIN`. It's a good idea to run this on document load.
- **`vacuumNotebook`**: Permanently deletes soft-deleted data. **Do not run this on the client-side** unless you have a very specific reason and understand the consequences.
- **`setTombstoneTimestamp`**: Part of the internal vacuuming lifecycle.
- **Direct Y-Type Access (`.get`, `.set`, `.push`, `.delete`)**: Bypassing the operation functions means you are responsible for maintaining data integrity and using the correct `origin`. Avoid this for standard features.

## 5. Key Concepts & Potential Pitfalls

### Distinction: `softDeleteCell` vs. `removeCell`

- **`softDeleteCell`**: User-facing "delete". Reversible. Undoable. Hides the cell.
- **`removeCell`**: Admin/system "hard delete". Irreversible. Not undoable. Permanently removes data from the document.

### Understanding Origins

The `origin` parameter in `doc.transact(fn, origin)` is crucial for controlling the undo manager.

- `USER_ACTION_ORIGIN`: Use this for all user-driven, undoable actions. Most of the public API functions use this by default.
- `EXECUTION_ORIGIN`: Used by execution functions to prevent changes to outputs (`running`, `stale`, `result`) from being undone.
- `MAINT_ORIGIN`, `VACUUM_ORIGIN`: Used for maintenance tasks that should **not** be undoable. `reconcile` and `vacuum` use these.

Using the wrong origin can break the undo/redo logic. Stick to the provided operation functions to stay safe.

### Working with Live Data (Y-Types vs. Models)

- **Y-Types (`Y.Map`, `Y.Text`)** are the live, mutable, collaborative data source.
- **Models (Plain JS Objects)** are immutable snapshots generated by the `y...ToModel` functions.

Your UI should follow this one-way data flow:
1.  Subscribe to changes on the Y.js document.
2.  On change, generate a new `Model` from the `Y-Types`.
3.  Pass this immutable `Model` to your UI components for rendering.
4.  User interaction in the UI calls an **operation function** (`insertCell`, `moveCell`, etc.).
5.  The operation function modifies the `Y-Types`, which triggers a new change event, restarting the cycle.

**Never** store a `Y-Type` in React state. Always convert it to a plain model.

### Data Integrity: `validate` vs. `reconcile`

- `validateNotebook(nb)`: A **read-only** check that returns an array of issues (e.g., duplicate IDs in `order`, orphan cells). It's safe to run anytime for diagnostics.
- `reconcileNotebook(nb)`: A **write** operation that attempts to automatically **fix** some of the issues found by `validateNotebook`. It is not undoable.

## 6. In-depth Analysis: Design Philosophy and Trade-offs

Our Schema is not just a collection of random choices but a thoughtfully designed system where each decision has its reasons and trade-offs.

### 6.1. Why Must `NB_OUTPUTS` Be Decoupled? — Precise Control of Undo Scope

This is one of the most critical design decisions in the entire architecture. If states like `result` and `running` are stored directly inside `YCell` (part of `NB_CELL_MAP`), it would lead to disastrous user experience issues.

**Imagine the consequences:**
`createNotebookUndoManager` is configured to track all changes in `NB_CELL_MAP`.
1. The user modifies a line of SQL code. This change is captured by the `UndoManager`.
2. The user clicks "run," and the code executes. `startExecuteCell` and `applyExecuteResult` update the `result` field in `YCell`. These changes would also be captured by the `UndoManager`.
3. The user realizes a mistake in the code and wants to undo the changes using `Ctrl+Z`.
4. **The problem arises:** `UndoManager` would roll back both the code and the execution results! The execution results would disappear unexpectedly, which is completely counterintuitive.

**By moving `NB_OUTPUTS` out of `NB_CELL_MAP`, we achieve separation of concerns:**
- **User Intent (`NB_CELL_MAP`, `NB_CELL_ORDER`):** Users want to control and undo modifications to code, Markdown, and cell order.
- **System State (`NB_OUTPUTS`):** Code execution is a system response to user intent. It has its own lifecycle and should not be polluted by the user's edit history.

Additionally, we use `EXECUTION_ORIGIN` to tag all writes to `NB_OUTPUTS`. Even if `UndoManager` is mistakenly configured to track `NB_OUTPUTS`, these changes would be ignored, providing a double layer of protection.

### 6.2. Why Use the "Map + Order" Pattern? — UI-oriented "MapReduce"

This pattern can be seen as a "MapReduce" approach to front-end data processing.

- **`NB_CELL_MAP` (Map Phase):** This is the complete data set (Data Source). It contains all cell information, whether visible, soft-deleted, etc., enabling `O(1)` time complexity for cell data access.

- **`NB_CELL_ORDER` (Reduce Phase):** This is a "view" or "index" (View/Index). It "extracts" and "sorts" a subset of data from the complete data set for UI rendering.

**This pattern offers significant advantages in complex operations:**
- **Move Cell (`moveCell`):** This is a `delete` + `insert` operation on the small array `NB_CELL_ORDER`, which is low-cost and strongly atomic. If cell data and order were coupled, moving a large cell would involve extensive data copying and moving, which is inefficient and error-prone.
- **Concurrent Editing:** Suppose user A is editing the content of cell `C1` (modifying `Y.Text` in `NB_CELL_MAP` for `C1`), while user B moves `C1` (modifying `NB_CELL_ORDER`). Since both operations target different parts of the Y.js document, Y.js can merge these changes without conflict.

### 6.3. The Trade-offs of the Tombstone Mechanism

Tombstone provides recoverable soft deletion, a powerful feature, but it comes with costs.

- **Benefits:** Undoing deletions becomes simple. Implementing a "recycle bin" feature is possible. In collaborative scenarios, a user's delete action doesn't immediately destroy data another user might be referencing.
- **Cost/Trade-off:** Document size will only grow. Soft-deleted cell data remains in `NB_CELL_MAP` until `vacuumNotebook` is executed. This necessitates a reliable backend maintenance task or a trusted client to periodically perform "garbage collection" to prevent document bloat.

## 7. In-depth Analysis: Undo/Redo Subsystem (`NotebookUndoHistory`)

We didn't just use Y.js's `UndoManager` but built a semantic layer `NotebookUndoHistory` (`/src/yjs/undo/notebookUndoHistory.ts`) on top of it to provide richer, business-need-oriented historical snapshots.

**Limitations of Y.js `UndoManager`:**
- Its undo stack items are very "primitive." A user typing "hello" might leave 5 separate, scattered `insert` operations in the stack.
- Its `origin` filtering is "all-or-nothing."
- It doesn't provide an easy-to-present, human-readable change summary for UI.

**How Does `NotebookUndoHistory` Enhance It?**

1. **Listening and Capturing:** It listens to `UndoManager`'s `stack-item-added` and `stack-item-updated` events. When one or more consecutive user actions (within a `captureTimeout`) are merged into an undo-stack-item, this class intervenes.

2. **Event Description (`describeEvent`):** It traverses all Y.js low-level events (`Y.YMapEvent`, `Y.YTextEvent`, etc.) in the `stackItem` and calls helper functions like `summarizeMapChange` and `summarizeTextChange` to **translate** these low-level events into human-readable descriptions.
    - `Y.YTextEvent` → `" +18 -5 “some insightful words” "`
    - `Y.YArrayEvent` → `" +1 (Map), -2 "`
    - `Y.YMapEvent` → `" ~Metadata, +Source "`

3. **Transaction Aggregation (`captureTransaction`):** It aggregates all change descriptions in a single transaction into an `UndoScopeTransaction` object, attaching timestamps and `origin` descriptions.

4. **Scope and Snapshot (`UndoHistorySnapshot`):** Each `stackItem` in `UndoManager` is treated as a "Scope." `NotebookUndoHistory` attaches metadata to this Scope and aggregates multiple consecutive transactions (if they belong to the same Scope). Ultimately, it generates a complete `UndoHistorySnapshot` with `undo` and `redo` arrays, each containing an `UndoScopeSummary` with detailed, UI-consumable transaction lists and change summaries.

This class is a crucial bridge between low-level CRDT operations and upper-level UI (e.g., "History" panel), transforming raw, chaotic change streams into structured, meaningful historical records.

## 8. In-depth Analysis: Responsive "Auto-Stale" Mechanism

`enableAutoStaleOnSource` (`/src/yjs/schema/quality/auto_stale.ts`) is a sophisticated automation tool for maintaining data consistency: when code changes, the corresponding output should be marked as "stale."

**How Does It Work? — A Multi-layered Listening Architecture**

1. **Preventing Duplicate Bindings (`BOUND_DOCS`):** It uses a `WeakSet` to record already bound `Y.Doc`. The `WeakSet` ensures if `Y.Doc` objects are garbage collected, references in `WeakSet` are automatically removed, elegantly preventing memory leaks and duplicate bindings.

2. **Listening to Cell Birth and Death (`onMapChange`):**
    - It first registers a listener on `NB_CELL_MAP`.
    - When a new cell is **added** (`add`) or **updated** (`update`) to `cellMap`, it calls `bindCell` on the new `YCell` instance, incorporating the new cell into monitoring.
    - When a cell is **deleted** (`delete`), it finds and **cleans up** all listeners associated with that `cellId` to prevent memory leaks.

3. **Listening to Changes in Cell Pointers (`onCellKeyChange`):**
    - The `bindCell` function registers a listener on each `YCell` instance.
    - This listener specifically monitors the `CELL_SOURCE` key. If `CELL_SOURCE` is replaced from one `Y.Text` instance to another, it will:
        - Unbind the listener from the old `Y.Text` instance.
        - Call `bindText` to register a new listener on the new `Y.Text` instance.

4. **Listening to Actual Text Content Changes (`onTextChange`):**
    - The `bindText` function registers the final listener on `Y.Text` instances.
    - **Any** modification to `Y.Text` content (`insert`, `delete`) triggers `onTextChange`.
    - This function immediately calls `markCellOutputStale(nb, cellId)`, setting the `stale` flag in `NB_OUTPUTS` for the corresponding cell to `true`.

Through this precise chain of listeners, the system can automatically and accurately maintain the `stale` status whether the cell is newly created, the source is entirely replaced, or the source content is modified in fragments. The `disable()` return function provides a "one-click clean-up" ability for all listeners, crucial when components are unmounted or documents are closed.

## 9. In-depth Analysis: A Concrete Data Integrity Repair Case

`reconcileNotebook` is the last line of defense for data health. Let's look at a specific scenario.

**Scenario:**
- User A and User B are collaboratively editing the same Notebook.
- The network temporarily disconnects.
- User A creates and inserts a new cell `C3`. Locally, `NB_CELL_MAP` gains `C3`, and `NB_CELL_ORDER` also gets `C3`'s ID.
- User B, while offline, swaps the order of `C1` and `C2`.
- The network restores. Y.js begins synchronizing data.

**Possible Issue:**
Due to Y.js's merge algorithm, an intermediate state might occur: User B's device successfully receives User A's creation of `C3` in `NB_CELL_MAP`, but a conflict in merging changes to the `NB_CELL_ORDER` array prevents `C3`'s ID from being successfully inserted into User B's `NB_CELL_ORDER`.

**Result:**
- On User B's device, data becomes inconsistent: `C3` **exists** in `cellMap` but is **missing** from the `order` array.
- **UI Behavior:** Since the UI renders based on the `order` array, User B can't see cell `C3`. `C3` becomes an "orphan" cell.

**How to Resolve?**

1. **Validation (`validateNotebook`):**
    When the application loads the document, run `validateNotebook(nb)`. It will return an `issues` array containing a warning like:
    ```json
    {
      "path": "cellMap.C3",
      "level": "warning",
      "message": "Cell id \"C3\" exists in cellMap but not referenced by order"
    }
    ```

2. **Repair (`reconcileNotebook`):**
    Then call `reconcileNotebook(nb, { appendOrphans: true })`. It performs the following:
    - Iterates over all keys (`C1`, `C2`, `C3`) in `cellMap`.
    - Iterates over all IDs (`C2`, `C1`) in `order`.
    - Identifies `C3` as an "orphan" (in map but not in order).
    - Appends `C3` to the end of the `order` array.
    - The entire operation is completed in a `doc.transact`, using `MAINT_ORIGIN`, so it doesn't pollute the user's undo history.

**Final Outcome:**
`NB_CELL_ORDER` now becomes `['C2', 'C1', 'C3']`. The UI detects the change in the `order` array and re-renders, making cell `C3` visible to User B, restoring data consistency. This is the value `reconcileNotebook` provides.

## 10. Advanced Topic: Concurrency & Conflict Resolution in Practice

The primary reason for using a CRDT like Y.js is its ability to merge concurrent edits without requiring a central server to resolve conflicts. Our schema is designed to leverage this power gracefully.

Let's walk through a classic conflict scenario: **User A edits a line of code that User B simultaneously deletes.**

**Initial State:**
- The source code in a cell is: `SELECT * FROM users;`
- This is represented by a `Y.Text` object in the cell's `source`.

**The Scenario:**
1.  User A and User B are both online and have the same document state.
2.  User B goes offline (e.g., closes their laptop).
3.  **User A (Online):** Edits the line to fix a typo, changing it to `SELECT * FROM customers;`.
    - **Under the hood:** This is not a string replacement. Y.js generates a `delete` operation for `"users"` and an `insert` operation for `"customers"` at a specific position in the `Y.Text` structure.
4.  **User B (Offline):** Decides the entire line is unnecessary and deletes it.
    - **Under the hood:** User B's client generates a `delete` operation for the entire string `SELECT * FROM users;`.
5.  User B comes back online. Their Y.js client reconnects and starts syncing changes with User A's client.

**The Merge Resolution (What Y.js Does Automatically):**

Y.js's `Y.Text` CRDT doesn't see "lines" or "words"; it sees a sequence of items with unique IDs. When an item is deleted, it's not truly erased but marked as a "tombstone" (a different concept from our schema's `NB_TOMBSTONES`). Inserts are always respected.

1.  **User A's change arrives at User B's client:** User B's document sees an instruction to insert `"customers"` and delete `"users"`. Since the characters of `"users"` have already been "deleted" by User B, the delete instruction is simply acknowledged as having been fulfilled. The `insert` for `"customers"` is new information and is applied.
2.  **User B's change arrives at User A's client:** User A's document sees an instruction to delete the characters corresponding to the original `SELECT * FROM users;`. The characters for `"SELECT * FROM "` and `";"` still exist and are deleted. The characters for `"users"` are already gone (replaced by `"customers"`), so that part of the operation has no effect.

**Final, Merged State:**
The `Y.Text` object will contain:
`customers`

This might seem surprising, but it's the logically consistent outcome of the CRDT merge algorithm: **inserts always win, and deletes are idempotent.** The final state reflects *both* users' intentions applied to the document: the line was (mostly) deleted, AND the entity name was corrected. There is no data loss and no "conflict resolution" modal for the user to deal with. The schema's job is to let this happen seamlessly.

## 11. Advanced Topic: Performance, Memory, and Scalability

A robust system must also be performant. Here are key considerations for this schema.

### The Necessity of `vacuumNotebook`
As established, soft-deleting with tombstones causes the document to grow indefinitely. The `vacuumNotebook` function is the only way to reclaim this space.

**Strategy for execution:**
- **Server-Side is Ideal:** The safest place to run the vacuum is on a server. You could implement a hook that triggers when the last collaborator leaves a document session. The server would load the document, run `vacuumNotebook`, and save the compacted version.
- **Trusted Client:** In a less-centralized setup, a designated "admin" client or a scheduled maintenance process could be responsible for this.
- **Frequency:** The `ttlMs` (Time-To-Live) parameter is your control knob. A value of 30 days (`30 * 24 * 3600 * 1000`) is a reasonable default, balancing the ability to restore cells against document growth.

### Why `Y.Text` is Non-Negotiable for Source Code
It might seem simpler to store `cell.source` as a plain string. This would be a critical mistake.
- **With a String:** If User A and User B both edit the source concurrently, the last writer would win. The document would receive two `.set("source", "...")` operations. Whichever one is processed last would completely overwrite the other's work. This is a destructive race condition.
- **With `Y.Text`:** As shown in the concurrency example, `Y.Text` allows for character-level merging. It understands the *intent* of the edits (insertions and deletions at specific points) and merges them non-destructively. For any collaborative text editing, `Y.Text` is essential.

### The Overhead of Observers (`auto-stale`)
The `enableAutoStaleOnSource` mechanism is powerful but registers many event listeners.
- **Performance:** Y.js observers are highly optimized. The overhead for a few hundred or even a few thousand cells is negligible on modern devices. The performance cost is not a primary concern for typical notebook sizes.
- **Memory Management:** The **critical** part is cleanup. Un-disposed observers lead to memory leaks. This is why `enableAutoStaleOnSource` returns a `disable` function.
  - In a Single-Page Application (SPA) framework like React, you must call this `disable` function in the `useEffect` cleanup return:

  ```javascript
  useEffect(() => {
    if (!notebookRoot) return;
    const disable = enableAutoStaleOnSource(notebookRoot);
    return () => {
      disable(); // <-- This is CRUCIAL for preventing memory leaks
    };
  }, [notebookRoot]);
  ```

## 12. Advanced Topic: Extending the Schema

Your application will evolve. A well-designed schema should be extensible without requiring a full rewrite. The key is to follow the existing patterns.

**Scenario: Adding a "Comments" feature to each cell.**

Let's say you want a simple, threaded comment system for each cell.

### Step 1: Define the Data Structure
A list of text comments seems appropriate. So, for a given `cellId`, we need a `Y.Array<Y.Text>`.

### Step 2: Choose the Location (The Architectural Decision)

Where should this data live?

- **Option 1 (Incorrect):** Directly modifying `YCell` to add `cell.set("comments", new Y.Array())`. Why is this likely wrong? Because `YCell` lives in `NB_CELL_MAP`, which is tracked by the main `UndoManager`. This means adding a comment would become an undoable action *in the same history stack as code edits*. A user trying to undo a code change might accidentally undo adding a comment, which is a confusing experience.

- **Option 2 (Correct, following the pattern):** Decouple the data. Create a new, top-level `Y.Map`.

  In `/src/yjs/schema/core/keys.ts`, add a new key:
  ```typescript
  export const NB_CELL_COMMENTS = "cellComments"; // Y.Map<Y.Array<Y.Text>>
  ```

### Step 3: Create Accessor and Operation Functions

Following the pattern of `outputs`, create helper functions.

```typescript
// In a new file, e.g., /src/yjs/schema/access/comments.ts

import { NB_CELL_COMMENTS } from "../core/keys";
import * as Y from "yjs";

export const getCellComments = (nb: Y.Map<any>, cellId: string): Y.Array<Y.Text> | undefined => {
  const commentsMap = nb.get(NB_CELL_COMMENTS) as Y.Map<Y.Array<Y.Text>> | undefined;
  return commentsMap?.get(cellId);
};

export const ensureCellComments = (nb: Y.Map<any>, cellId: string): Y.Array<Y.Text> => {
  let commentsMap = nb.get(NB_CELL_COMMENTS) as Y.Map<Y.Array<Y.Text>> | undefined;
  if (!commentsMap) {
    commentsMap = new Y.Map<Y.Array<Y.Text>>();
    nb.set(NB_CELL_COMMENTS, commentsMap);
  }
  let comments = commentsMap.get(cellId);
  if (!comments) {
    comments = new Y.Array<Y.Text>();
    commentsMap.set(cellId, comments);
  }
  return comments;
};

// In a new file, e.g., /src/yjs/schema/ops/comments.ts
export const addComment = (nb: Y.Map<any>, cellId: string, text: string) => {
  // Should this be undoable? Let's create a new origin for it.
  const COMMENT_ORIGIN = Symbol("COMMENT_ACTION");

  const apply = () => {
    const comments = ensureCellComments(nb, cellId);
    comments.push([new Y.Text(text)]);
  };

  withTransactOptional(nb, apply, COMMENT_ORIGIN);
};
```

### Step 4: Integrate with Undo (Optional)
If you want comments to have their *own* undo history, you could even create a *separate* `UndoManager` that *only* tracks `COMMENT_ORIGIN` and the `NB_CELL_COMMENTS` map. This gives you granular control over the user experience.

By following the established patterns of **decoupling data by concern**, creating **accessor/operation functions**, and using the **origin system**, you can extend the schema to support new features while maintaining its robustness and clarity.