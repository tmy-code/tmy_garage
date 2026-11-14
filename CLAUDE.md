# TMY Garage

## Docs: read only what the task needs

| Doc | Read when |
|---|---|
| [CONTEXT.md](CONTEXT.md) | Writing code, API names or screen text (glossary) |
| [docs/data-model.md](docs/data-model.md) (22 KB, table of contents at the top) | Changing the schema or stored data: read the section you touch with Grep, not the whole file; keep it up to date with every schema change |
| [docs/adr/](docs/adr/) | Changing offline sync, hosting, parts, the Notion copy or the Android app |
| [docs/plan-templates.md](docs/plan-templates.md) | Changing the built-in maintenance templates (`src/shared/catalogue.ts` is the source of truth) |
| [docs/notion-copy.md](docs/notion-copy.md) | Working on `npm run notion-sync` |
| [docs/notion-databases.md](docs/notion-databases.md) | Changing a Notion database or a column the sync reads or writes (keep it up to date) |
| [docs/deploy.md](docs/deploy.md) | Installing or updating on the NAS |
| `docs/ux-review-2026-11*.md` | Only when working through those reviews' recommended changes |

Naming: the project, package, container and NAS folder are snake_case (`tmy_garage`); files are kebab-case (`session-consumables.ts`), except React component files in PascalCase (`Vehicle.tsx`) and upper-case docs (`CONTEXT.md`).

## Screen layout conventions

The owner uses the app mostly on a phone, and also on a wide screen. Check both widths before calling a screen change done.

- **An add or action button sits right next to the heading it belongs to**, never pushed to the far edge of the screen. On a page, pass it as `titleAction` to `Layout`. On a section inside a page, use `<div className="heading-row"><h2>…</h2><button …/></div>`. `section-head` (name left, control at the far end) is only for a row inside a list, such as a document with its Delete button.
- **Widths must line up.** A form is capped in width on a wide screen, so never put a full-width list directly under it: put the two side by side with `split` / `split-main` / `split-side`. Cards of similar content in a grid use `list list-grid list-even` so a row shares one height. Keep related text together (`nowrap`) and give a filter with long choices more room, so nothing is cut off at phone width.
- **Long forms and lists stay usable.** The save button of a long form goes in `<div className="sticky-actions">` so it stays in view. A list the owner has to scan (more than about eight rows) gets a search box (`matchesQuery` in `format.ts`) and counts beside its filters. A choice that is only a toggle (Service / Repair) is outlined and ticked, never filled with the accent colour, which is for the button that saves.
- Reuse the existing classes in `styles.css` before adding new ones, and look at a similar screen to copy how it is laid out.

## This repository is public: no personal data, ever

The owner is not technical and relies on these rules being followed in every commit.

- **No real vehicle or insurance data** in code, tests, fixtures, seeds, screenshots or docs: no real VIN, plate number, policy number, CRM, claim, address, name or email. Use obviously fake values (e.g. VIN `VF1TESTVIN0000001`, plate `AA-000-AA`, insurer "Assurance Exemple").
- **No real documents** (carte grise, relevé d'information, invoices, photos) in the repo. Test files are generated or are blank placeholders.
- **No infrastructure details or secrets in code**: server hostnames (including the Tailscale address), tokens and passwords come from environment variables set on the NAS. Document new variables in `.env.example` with placeholder values only.
- **Runtime data stays out of git**: the SQLite database, uploads and backups live under paths ignored by `.gitignore`. Never weaken those ignore rules.
- **Before every commit**, check the staged diff for anything above. If personal data was ever committed, stop and tell the owner — deleting the file does not remove it from git history.

## Android app

The phone uses a sideloaded Android app (ADR 0006), built the same way as TMY Fitness: Capacitor wraps the same React screens, bundled in the APK. Android-only behaviour (back button, opening Documents in the phone's viewer) lives in `src/client/native.ts`; the server's address is typed on first launch (`src/client/server.ts`) and never written in the repo.

- Build: `npm run build:android`, then `./gradlew assembleDebug` in `android/` with `JAVA_HOME` on a **JDK 21**.
- Releases: merging to `main` makes `.github/workflows/android.yml` sign the APK with the key in the repo's secrets (made by `C:\Projects\infra\android\new-signing-key.ps1`) and publish a GitHub Release, which Obtainium installs on the phone.
- Test on the owner's phone over USB with `adb`. Bump `API_VERSION` in `src/shared/api-version.ts` whenever a change to `/api` would break an older app.
