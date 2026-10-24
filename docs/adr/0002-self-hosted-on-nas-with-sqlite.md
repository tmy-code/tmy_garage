---
status: accepted
---

# Self-hosted on the Synology NAS with SQLite and files on disk

The app runs as a single Docker container on the user's Synology NAS, next to their existing Actual Budget server, reachable only over their Tailscale network. Data lives in one SQLite file, and Documents and photos are stored as files on a NAS volume. We chose this because the data is personal (registration certificates, insurance contracts, claims) and should stay off third-party clouds, Tailscale removes the need to secure a public login, and a single SQLite file is trivial to back up with the NAS's own backup tools. At the expected scale (one Garage, a few friends' Garages at most) a database server would add operational burden for no gain.

## Considered Options

- **Cloud hosting** (e.g. Vercel, Fly, Supabase) — rejected: sensitive personal documents with a third party, and a public login to secure.
- **Postgres** — rejected: one more container to run and back up, unnecessary at this scale.

## Consequences

- Releases are built by GitHub Actions into a container image; the user updates manually from Synology Container Manager, and the app backs up the database before applying any migration.
- The repository and image are public, so the NAS can pull without a stored access token that would expire. In exchange, no personal data, documents, hostnames or secrets may ever enter the repo: runtime data is git-ignored and configuration comes from environment variables on the NAS (see CLAUDE.md).
- Opening access to friends means either sharing the NAS through Tailscale or exposing the app publicly with real logins — a decision deferred until it is needed.
