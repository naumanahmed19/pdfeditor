# PickPDF Storage Architecture Report

**Status:** Implemented without legacy-data migration — 2026-07-19

**Date:** 2026-07-19
**Scope:** Open documents, recent files, autosave, crash recovery, and desktop persistence

## Executive summary

PickPDF currently persists complete PDF byte arrays, annotations, and session metadata in IndexedDB. A `MAX_STORED = 10` retention rule was intended to limit browser-managed storage, but it also removes records marked as open. When the sidebar refreshes from IndexedDB, older live documents disappear even though their PDF engines remain loaded in memory. This creates the appearance of a ten-file open limit and leaves hidden documents consuming resources.

For the Tauri desktop application, the recommended replacement is a hybrid architecture:

- Use **SQLite for metadata and session state**.
- Store **PDF snapshots and large annotation data as files** under the application-local data directory.
- Keep a web persistence adapter using IndexedDB if the browser build remains supported.
- Keep every open document visible, but load PDF engines lazily and unload inactive, safely persisted documents.
- Apply storage budgets to recoverable cached data, not an arbitrary hard limit to the number of open documents.

SQLite by itself does not solve memory usage. Storing large PDFs as SQLite BLOBs is also not recommended. The strongest design is SQLite as the index and the filesystem as the document store.

## Current implementation

Persistence is implemented in `src/lib/persist.ts` using one IndexedDB object store named `docs`.

Each stored record contains:

- Document ID and display name.
- Source identity used for duplicate detection.
- The complete PDF as a `Uint8Array`.
- Editable annotation state.
- Last-opened time and open/closed status.

Current limits:

- `MAX_STORED = 10`: only ten IndexedDB records are retained.
- `MAX_PERSIST_BYTES = 80 MiB`: larger documents are not persisted for recovery.
- Runtime `docs`: no explicit document-count limit.
- Split panes: four visible panes maximum.

### Why ten files appear to be the maximum

After a successful persist, `pruneOld()` (`src/lib/persist.ts:129`) sorts all records by `lastOpened` and deletes everything after the first ten. It does not protect records whose `open` flag is true.

The store then calls `refreshRecent()` (`src/store.tsx:1903`), which replaces the sidebar list with the records that remain in IndexedDB — it never merges the live runtime `docs` array. The sidebar's open section renders from that persisted list (`src/components/layout/Sidebar.tsx:245`). Consequently:

1. The eleventh document is successfully loaded into the runtime `docs` array.
2. IndexedDB pruning deletes the oldest stored record.
3. The sidebar is rebuilt from the ten remaining records.
4. The deleted record disappears from the sidebar but remains loaded in memory.
5. Reopening that file focuses the hidden runtime document because duplicate detection (`src/store.tsx:1968`) correctly finds it.

This is a persistence/UI synchronization bug, not a deliberate open-document restriction.

### The limit is not actually "ten open documents"

Pruning is ordered purely by `lastOpened`, and closed records keep their timestamp (`markDocClosed` only flips the flag). An open-but-inactive document therefore ages past recently-*closed* history items and can be pruned with far fewer than ten documents open — the practical trigger is ten total records, open or closed.

Pruning a record also deletes its stored `annotations`. While the session lives, the runtime copy masks this, but crash recovery for that document is gone — and for documents whose native `/Annots` were imported into the overlay (the stored bytes are the stripped version), the pruned record was the only copy of that markup outside process memory.

### Documents over 80 MiB lose their sidebar entry through the same root cause

A too-large document gets an optimistic sidebar entry at open (`src/store.tsx:2143`) but is never written to IndexedDB (`persistDoc` returns `"too-large"`). The *next* `refreshRecent()` from any event — closing another tab, another document's successful autosave — rebuilds the list from IndexedDB and silently drops it. The document stays loaded and functional but becomes invisible in the sidebar. The Phase 0 fix (merge live runtime documents into every refresh) resolves this path as well.

## Requirements

The replacement should:

1. Show every document that is open in the current session.
2. Restore the previous session without loading every PDF engine at startup.
3. Autosave recoverable state without blocking initial document display.
4. Support PDFs substantially larger than the current 80 MiB IndexedDB cutoff.
5. Avoid storing cleartext copies of protected documents.
6. Deduplicate the same source file reliably.
7. Remove closed recent items without touching original files.
8. Recover cleanly from interrupted writes, missing source files, database corruption, and exhausted disk space.
9. Preserve a browser-compatible implementation if PickPDF continues to ship as a web application.

## Options considered

| Option | Advantages | Disadvantages | Decision |
|---|---|---|---|
| Keep IndexedDB | No desktop integration work; works in browsers | Browser quota behavior, expensive large byte-array copies, difficult inspection and migrations, current retention bug | Keep only as web fallback |
| SQLite with PDF BLOBs | One transactional database; simple record ownership | Large WAL/database growth, expensive replacement of large BLOBs, harder cleanup and backup, PDFs cross the frontend/backend boundary | Not recommended |
| Files plus JSON metadata | Simple and efficient for large PDFs | Weak querying, more difficult migrations and transactional coordination | Acceptable but less robust |
| SQLite metadata plus files | Deterministic storage, efficient large-file handling, schema management, querying, atomic file replacement, easy cleanup | Requires a desktop persistence adapter | **Implemented** |

## Recommended architecture

### Storage layout

```text
<app-config>/pickpdf.db

<app-local-data>/pickpdf/documents/
├── <document-id>-<revision>.pdf
└── <document-id>-<revision>.json
```

`pickpdf.db` stores small, queryable state. The `documents` directory stores versioned recovery snapshots. A new snapshot is written first, SQLite atomically switches its path, and only then is the previous snapshot deleted. An interrupted write therefore leaves either the previous referenced snapshot or an unreferenced file removed by startup cleanup.

### Suggested SQLite schema

```sql
CREATE TABLE documents (
  id                TEXT PRIMARY KEY NOT NULL,
  name              TEXT NOT NULL,
  source_key        TEXT,
  pdf_path          TEXT,
  annotations_path  TEXT,
  byte_length       INTEGER NOT NULL DEFAULT 0,
  is_open           INTEGER NOT NULL DEFAULT 0,
  last_opened       INTEGER NOT NULL
);

CREATE INDEX documents_recent
  ON documents(last_opened DESC);
```

Passwords, decrypted secrets, and encryption keys must never be written to this database.

### Repository boundary

UI and store code should depend on an interface instead of directly calling IndexedDB or Tauri plugins.

```ts
interface DocumentRepository {
  listSession(): Promise<DocumentRecord[]>;
  listRecent(limit?: number): Promise<DocumentRecord[]>;
  readSnapshot(id: string): Promise<StoredSnapshot | null>;
  writeSnapshot(snapshot: StoredSnapshot): Promise<PersistResult>;
  updateSession(id: string, patch: SessionPatch): Promise<void>;
  removeRecent(ids: readonly string[]): Promise<void>;
  prune(): Promise<PruneResult>;
}
```

Implementations:

- `TauriDocumentRepository`: SQLite plus application-local files.
- `WebDocumentRepository`: IndexedDB, optionally moving large browser snapshots to OPFS later.
- `MemoryDocumentRepository`: deterministic tests.

## Document lifecycle

### Opening

1. Resolve the source identity and focus an already-open matching document.
2. Add an optimistic sidebar entry immediately.
3. Load only the bytes and PDF engine needed to display the document.
4. Write session metadata in the background.
5. Write a recovery snapshot only when needed and without delaying display.

### Autosave

1. Serialize the snapshot to a temporary file.
2. Flush and close the temporary file.
3. Atomically rename it over the previous cache file.
4. Commit the new file metadata and recovery status in SQLite.
5. Delete obsolete snapshots only after the new snapshot is committed.

This prevents a crash during writing from corrupting the last valid recovery copy.

### Session restoration

1. Query open document metadata from SQLite.
2. Render all sidebar entries immediately.
3. Load only the most recently active document.
4. Load other documents when selected.
5. Leave password-protected documents unloaded until the user activates and unlocks them.

### Closing and recent history

- Closing marks `is_open = 0` and releases the PDF engine.
- Closing does not delete the original file.
- Removing a recent item deletes only PickPDF metadata and its recovery cache.
- Clearing recents never removes open documents.
- Closed recent metadata may be capped, for example at 50 items.

## Limits and resource policy

### Open document count

Do not impose a silent hard count such as ten. The number of PDFs is a poor proxy for resource usage: ten 500 MiB scans can cost much more than one hundred small text PDFs.

Recommended behavior:

- Every open document remains represented in the sidebar.
- Visible panes and the active document remain loaded.
- Keep a small warm least-recently-used set, initially six loaded documents including visible panes.
- Unload inactive clean documents after their recovery state is safely persisted.
- Never unload a dirty document unless its recovery snapshot has been verified.
- If persistence fails, keep the document loaded and warn the user.

### Disk usage

Use a configurable recovery-cache budget rather than a document-count limit. A reasonable initial desktop default is 2 GiB, with these rules:

1. Never delete recovery state for an open dirty document.
2. Delete closed clean cache files first, least recently used first.
3. Then remove old closed recovery snapshots.
4. Preserve lightweight recent-file metadata after its cache is removed.
5. Explain when recovery is unavailable due to disk space.

The exact budget should remain a policy constant and can later be made configurable.

## Security requirements

- Protected PDFs must be cached in their protected representation.
- Editable annotation files must not leak content from protected PDFs.
- Passwords and protection recipes must remain memory-only unless a separately reviewed secure-storage design is added.
- Cache files should be placed only in the application-local data directory.
- File and SQL plugin permissions should be restricted to PickPDF-owned application directories.
- Temporary cleartext files must be avoided; if unavoidable for an operation, they must be deleted promptly on success, failure, and startup cleanup.

## Implementation status

### Phase 0: correct the current bug — completed

- Merge live runtime documents into every sidebar refresh. This also fixes the over-80 MiB case, where a never-persisted document vanishes from the sidebar on the next refresh.
- Never prune an open document from the visible session.
- Change IndexedDB pruning to target closed recent records only.
- Add coverage for opening more than ten documents, and for a too-large document surviving an unrelated `refreshRecent()`. Existing tests (`store.open.test.tsx`, `store.recents.test.tsx`) cover duplicate-open and history removal but never exceed ten records.

This is implemented independently of the desktop backend and remains active in the browser fallback.

### Phase 1: introduce the repository interface — completed

- Move current IndexedDB functions behind `DocumentRepository`.
- Keep behavior unchanged.
- Add contract tests for persistence implementations.

### Phase 2: add desktop storage — completed

- Add the official Tauri SQL plugin with SQLite support.
- Add filesystem access scoped to the application-local data directory.
- Implement atomic PDF snapshot writes.
- Store session/recent metadata in SQLite.

### Legacy migration — intentionally omitted

Existing IndexedDB records are not imported into the desktop SQLite/filesystem backend. The new desktop repository starts with an empty session. IndexedDB remains available only to the browser build.

### Phase 3: lazy loading and unloading — completed

- Separate sidebar/session records from loaded `OpenDoc` instances.
- Load the active document on demand.
- Add least-recently-used unloading for inactive recoverable documents.
- Record and restore tab order and active document.

### Phase 4: cleanup and observability — completed

- Implement cache-budget pruning.
- Add startup cleanup for abandoned temporary files.
- Return explicit persistence outcomes for database, filesystem, and recovery-disabled failures.

## Failure handling

| Failure | Required behavior |
|---|---|
| SQLite unavailable or corrupt | Start with an empty recoverable session, preserve cache files, offer diagnostics/rebuild |
| Snapshot write interrupted | Keep the previous valid snapshot; delete abandoned temporary files later |
| Disk full | Keep the live document open, mark recovery unavailable, warn once with a clear action |
| Original source moved/deleted | Restore from a valid recovery cache or show a relink action |
| Cache file missing | Keep metadata as a recent item but mark it unavailable/relinkable |
| Protected document requires password | Show the sidebar entry and defer loading until activation |

## Acceptance criteria

1. Opening 25 small PDFs shows all 25 in the sidebar.
2. Opening the same PDF again focuses its existing entry without duplication.
3. Restarting shows all previously open entries immediately but loads only the active PDF engine.
4. An inactive document can be unloaded and reopened without losing annotations or edits.
5. Clearing recent items does not close or delete open documents.
6. Original user files are never deleted by cache cleanup.
7. A crash during autosave leaves either the old valid snapshot or the new valid snapshot.
8. Protected documents never leave cleartext PDF or annotation caches.
9. Storage-budget pruning never removes the only recovery state for an open dirty document.
10. The web build continues to function through the IndexedDB adapter if web support is retained.

## Test plan

- Repository contract tests shared by memory, IndexedDB, and SQLite implementations.
- Browser repository tests with more than ten open records.
- Duplicate-source tests for file picker, drag-and-drop, folder tree, and recent-file activation.
- Crash simulation between temporary write, rename, and SQLite commit.
- Disk-full and permission-denied simulations.
- Protected-document persistence tests verifying no cleartext artifacts.
- Startup performance test with 25 open session records and one loaded PDF.
- Memory test confirming inactive engines are destroyed and reloaded on demand.

## Decision

PickPDF now uses **SQLite for metadata plus application-local files for PDF recovery snapshots** on desktop. IndexedDB remains behind the web persistence adapter. There is no hard user-visible open-file count, and no legacy IndexedDB-to-SQLite migration is performed.

## References

- Current PickPDF persistence: `src/lib/persist.ts`
- Current document/session store: `src/store.tsx`
- Tauri SQL plugin: <https://v2.tauri.app/plugin/sql/>
- Tauri filesystem plugin: <https://v2.tauri.app/plugin/file-system/>
