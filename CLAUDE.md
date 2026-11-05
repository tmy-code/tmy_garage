# TMY Garage

Domain vocabulary: [CONTEXT.md](CONTEXT.md). Data model: [docs/data-model.md](docs/data-model.md), kept up to date with every schema change. Architecture decisions: [docs/adr/](docs/adr/).

## Screen layout conventions

The owner uses the app mostly on a phone, and also on a wide screen. Check both widths before calling a screen change done.

- **An add or action button sits right next to the heading it belongs to**, never pushed to the far edge of the screen. On a page, pass it as `titleAction` to `Layout`. On a section inside a page, use `<div className="heading-row"><h2>…</h2><button …/></div>`. `section-head` (name left, control at the far end) is only for a row inside a list, such as a document with its Delete button.
- Reuse the existing classes in `styles.css` before adding new ones, and look at a similar screen to copy how it is laid out.

## This repository is public: no personal data, ever

The owner is not technical and relies on these rules being followed in every commit.

- **No real vehicle or insurance data** in code, tests, fixtures, seeds, screenshots or docs: no real VIN, plate number, policy number, CRM, claim, address, name or email. Use obviously fake values (e.g. VIN `VF1TESTVIN0000001`, plate `AA-000-AA`, insurer "Assurance Exemple").
- **No real documents** (carte grise, relevé d'information, invoices, photos) in the repo. Test files are generated or are blank placeholders.
- **No infrastructure details or secrets in code**: server hostnames (including the Tailscale address), tokens and passwords come from environment variables set on the NAS. Document new variables in `.env.example` with placeholder values only.
- **Runtime data stays out of git**: the SQLite database, uploads and backups live under paths ignored by `.gitignore`. Never weaken those ignore rules.
- **Before every commit**, check the staged diff for anything above. If personal data was ever committed, stop and tell the owner — deleting the file does not remove it from git history.
