---
status: accepted (2026-11-16)
---

# Receipts are also filed in the owner's Proton Drive

The owner keeps their paper trail in Proton Drive, organised by a Johnny Decimal (JDex) index; a Vehicle's maintenance invoices already live in `31 Véhicules\<vehicle>\Entretien`. A Receipt added in the app stayed only on the NAS, so the same invoice had to be filed by hand a second time. The desktop now files an Archive copy in the Vehicle's Archive folder when a Receipt is added; the app keeps its own copy as well. This changes ADR 0009's "they stay in the app".

## Decisions

- **The desktop browser writes the file.** Proton Drive has no official API, only the desktop client's synced folder on the owner's PC. The browser (Edge or Chrome, File System Access API) writes into that folder, so nothing on the NAS ever holds Proton credentials. The owner picks the Proton root once; the handle is kept in the browser.
- **The app copy stays.** The phone shows Receipts from the NAS copy, and a Service stays self-contained. The Archive copy is an addition, not a move.
- **Each Vehicle names its Archive folder** (relative to the Proton root, e.g. `31 Véhicules\31.02 CB650R`). It is never guessed from the Vehicle's name. The file goes in its `Entretien` subfolder, created when missing. The Vehicle's own folder is never created: a typo there would make a stray tree, so a missing one is an error to fix in the Vehicle form.
- **A Receipt is Filed or Pending.** The app copy is saved first and always succeeds. If the Proton write fails (no permission, the Proton client not running, a locked file), the Receipt stays Pending and can be retried from the desktop. A Filed Receipt records its path relative to the root.
- **The name is pre-filled and editable** (`YYYY-MM-DD_<label>.pdf`, from the Service date and title). The app never overwrites: an existing name gets a `-2` suffix.
- **Deleting a Receipt leaves the Archive copy.** A synced folder cannot be deleted from reliably, and silently removing an archive file is worse than leaving it.
- **Scope.** Service Receipts added from now on. Vehicle Documents (registration papers and so on) and Receipts already stored are not filed; a backfill would be a separate dry-run-first task.
- Receipts still never go to Notion.

## Considered options

- **The NAS uploads with rclone's Proton backend.** Rejected: unofficial and beta, and it would put Proton credentials on the NAS.
- **A script on the PC pulls new Receipts from the NAS.** Kept as the fallback if the desktop browser is not Chromium-based. It needs a scheduled task and gives no immediate feedback.
- **Proton as the only home.** Rejected: the phone could no longer show a Receipt, and a Service would depend on a folder outside the app.

## Consequences

- Filing works only from a Chromium desktop browser on the PC that runs the Proton Drive client, and the owner may have to grant folder access again from time to time.
- The schema gains an Archive folder on the Vehicle and a status and path on the Receipt Document; these are additive columns, so a rollback of the image still works.
