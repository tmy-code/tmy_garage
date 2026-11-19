---
status: accepted (2026-11-19)
---

# Documents stay in the route handlers

An architecture review proposed a deeper Documents module (a `FileStore` seam with a disk adapter and an in-memory adapter, owning the upload, serve, delete and cascade rules). We looked at it and decided not to do it now. Future reviews should not re-suggest it until the conditions below change.

## Why not

- **The only cross-cutting rule is five lines.** A Document's file lives in `uploadsDir` under its id, and deleting a Document deletes the row and the file. It is written twice (`DELETE /api/documents/:id` and `deleteDocumentsOf`), about four lines each.
- **The cascade has one caller.** `deleteDocumentsOf` is called only when a Service is deleted. There is no Vehicle delete route, so no Vehicle cascade exists to centralise.
- **The tests are already cheap.** `documents.test.ts` uses a temp folder made with `mkdtempSync`. An in-memory file store would replace that and nothing else, and one adapter in production plus one in tests is the only variation a seam would serve.
- **The rest of the handler logic is thin** (validation, a lookup, an INSERT or UPDATE). Moving about 100 lines into a module would not remove complexity, so it fails the deletion test.

## Reopen when

- A Vehicle delete route (or any new owner that deletes its Documents) is added: the cascade then has two or more callers and its rule is worth one home.
- Documents move to somewhere other than the NAS folder (for example object storage), so a second real file store exists.
- The handler grows real rules of its own (retention, virus checks, thumbnails).
