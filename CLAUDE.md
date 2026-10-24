# TMY Garage

Domain vocabulary: [CONTEXT.md](CONTEXT.md). Architecture decisions: [docs/adr/](docs/adr/).

## This repository is public: no personal data, ever

The owner is not technical and relies on these rules being followed in every commit.

- **No real vehicle or insurance data** in code, tests, fixtures, seeds, screenshots or docs: no real VIN, plate number, policy number, CRM, claim, address, name or email. Use obviously fake values (e.g. VIN `VF1TESTVIN0000001`, plate `AA-000-AA`, insurer "Assurance Exemple").
- **No real documents** (carte grise, relevé d'information, invoices, photos) in the repo. Test files are generated or are blank placeholders.
- **No infrastructure details or secrets in code**: server hostnames (including the Tailscale address), tokens and passwords come from environment variables set on the NAS. Document new variables in `.env.example` with placeholder values only.
- **Runtime data stays out of git**: the SQLite database, uploads and backups live under paths ignored by `.gitignore`. Never weaken those ignore rules.
- **Before every commit**, check the staged diff for anything above. If personal data was ever committed, stop and tell the owner — deleting the file does not remove it from git history.
