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

1. In Todoist: *Settings* → *Integrations* → *Developer* → copy your **API token**.
2. In *Container Manager* → *Project* → `tmy_garage` → *Action* → **Stop**, edit the YAML and add the `environment` block shown
   (commented) in [`docker-compose.yml`](../docker-compose.yml), with your token. To use a project other than the Inbox, set
   `TODOIST_PROJECT_ID` to its id (the number at the end of the project's web address).
3. *Action* → **Build**. The app compares the logbook with Todoist every 10 minutes and only contacts Todoist when something changed.

The token stays in the NAS project settings; never put it in the repository. A task you delete in Todoist is not created again.
Without `TODOIST_API_TOKEN` the sync is off.

## Updating

When a new version has been pushed, in *Container Manager* → *Project* → `tmy_garage` → *Action* → **Stop**, then
*Action* → **Build**. With `pull_policy: always` in the project YAML (as in [`docker-compose.yml`](../docker-compose.yml)),
Build downloads the new image. Your data is in `docker/tmy_garage`, not in the image, so it is not affected.
Before changing the database structure, the app saves a copy in `docker/tmy_garage/backups`.

**Check which version is running:** the dashboard shows the *Langue / Language* switch and true-black dark mode from
commit `48ac066` onwards.

**Rolling back:** every build is also tagged with its commit, e.g. `ghcr.io/tmy-code/tmy_garage:sha-e48cb83`.
Put that tag instead of `latest` in the project's YAML and build again.
