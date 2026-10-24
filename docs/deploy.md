# Installing and updating on the Synology NAS

## One-time setup

1. **Make the image downloadable.** After the first successful build on GitHub, open
   github.com/tmy-code → *Packages* → *tmy_garage* → *Package settings* → *Change visibility* → **Public**.
   (GitHub creates container images as private even for a public repository.)
2. **Create the data folder.** In *File Station*, create `docker/tmy-garage` on `volume1`.
   This is where the database and its automatic backups live. Include it in Hyper Backup.
3. **Create the container.** In *Container Manager* → *Project* → *Create*: name it `tmy-garage`,
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

## Updating

When a new version has been pushed, in *Container Manager* → *Project* → `tmy-garage` → *Action* → **Build**.
On some Container Manager versions Build keeps the image already on the NAS, even with `pull_policy: always`.
If the app has not changed afterwards: *Action* → **Stop**, then *Image* → `ghcr.io/tmy-code/tmy_garage` → **Delete**
(delete the `tmy-garage` container first if it refuses), then *Build* again. Your data is in `docker/tmy-garage`, not in the image.
Before changing the database structure, the app saves a copy in `docker/tmy-garage/backups`.

**Check which version is running:** the dashboard shows the *Langue / Language* switch and true-black dark mode from
commit `48ac066` onwards.

**Rolling back:** every build is also tagged with its commit, e.g. `ghcr.io/tmy-code/tmy_garage:sha-e48cb83`.
Put that tag instead of `latest` in the project's YAML and build again.
