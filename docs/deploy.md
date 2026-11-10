# Installing and updating on the Synology NAS

## One-time setup

1. **Make the image downloadable.** After the first successful build on GitHub, open
   github.com/tmy-code → *Packages* → *tmy_garage* → *Package settings* → *Change visibility* → **Public**.
   (GitHub creates container images as private even for a public repository.)
2. **Create the data folder.** In *File Station*, create `docker/tmy_garage` on `volume1`.
   This is where the database and its automatic backups live. Include it in Hyper Backup.
3. **Create the container.** In *Container Manager* → *Project* → *Create*: name it `tmy_garage`,
   choose the folder above, and paste the contents of [`docker-compose.yml`](../docker-compose.yml).
   Start it. The app now answers on port 3010 of the NAS.
4. **Turn on HTTPS through Tailscale.** The phone app needs HTTPS to install and to work offline.
   Over SSH on the NAS, run (8443 is any free port; your Actual server already uses the default one):

   ```bash
   tailscale serve --bg --https=8443 http://localhost:3010
   ```

   The app is then at `https://<your NAS's Tailscale name>:8443`, from any of your devices on Tailscale.
5. **Install it on your phone.** Open that address in Safari (iPhone: *Share* → *Add to Home Screen*)
   or Chrome (Android: *⋮* → *Install app*). Open it once with a connection so it stores an offline copy.

## Todoist reminders (optional)

The app can put a task in Todoist when a Maintenance Task becomes due soon, with the estimated date; it moves the date when
the estimate changes, and completes the task once the job is logged.

It is configured with two environment variables on the server:

| Variable | Meaning |
| --- | --- |
| `TODOIST_API_TOKEN` | Your Todoist API token (*Settings* → *Integrations* → *Developer*). Without it the sync is off. |
| `TODOIST_PROJECT_ID` | Optional. The project for the tasks (the number at the end of its web address); the Inbox when not set. |

Give them to the container the way your setup supplies environment variables, for example an `env_file` that lives only on the
server (see the commented `environment` block in [`docker-compose.yml`](../docker-compose.yml)). **Never put the token in the
repository.** Once the container restarts, the app compares the logbook with Todoist every 10 minutes and only contacts Todoist
when something changed. Every task already due soon or overdue then gets a Todoist task at once. A task you delete in Todoist
is not created again.

## Notion sync (optional)

The server can keep the owner's reference data (task catalogue, specs, tools, products) in step with Notion, and copy
vehicles and items there for deal hunting (see [notion-copy.md](notion-copy.md) and [ADR 0007](adr/0007-two-way-notion-sync.md)).
Two more environment variables on the server:

| Variable | Meaning |
| --- | --- |
| `NOTION_TOKEN` | The token of your Notion integration. Without it, or without the page below, the sync is off. |
| `NOTION_PARENT_PAGE_ID` | The page that holds your databases (the 32 characters at the end of its link). The integration must be added to it. |

Supply them like the Todoist ones, from a file that exists only on the server. The sync runs about a minute after the server
starts, then every 30 minutes, and from *Settings* → *Notion* → *Sync now*. The token is never sent to a phone.

## Updating

When a new version has been pushed, in *Container Manager* → *Project* → `tmy_garage` → *Action* → **Stop**, then
*Action* → **Build**. With `pull_policy: always` in the project YAML (as in [`docker-compose.yml`](../docker-compose.yml)),
Build downloads the new image. Your data is in `docker/tmy_garage`, not in the image, so it is not affected.
Before changing the database structure, the app saves a copy in `docker/tmy_garage/backups`.

**Check which version is running:** the dashboard shows the *Langue / Language* switch from
commit `48ac066` onwards.

**Rolling back:** every build is also tagged with its commit, e.g. `ghcr.io/tmy-code/tmy_garage:sha-e48cb83`.
Put that tag instead of `latest` in the project's YAML and build again.
