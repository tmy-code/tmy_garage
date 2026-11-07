---
status: accepted
---

# Sideloaded Android app with the screens bundled in a signed APK

The installable web app (ADR 0001) keeps the offline copy and the send queue in the browser's storage, which Android may clear under storage pressure, and it never quite feels like a phone app. So on the phone the app becomes a native Android app: the existing React screens are wrapped with Capacitor and bundled inside the APK, so the app always opens offline in the basement car park and its offline copy lives in the app's own storage, which Android only clears if the app is uninstalled or its data is wiped. The NAS stays the source of truth (ADR 0002) and the browser version keeps working for the desk-based screens.

The APK contains nothing personal: the server's address is typed once on first launch and kept on the phone. That lets GitHub Actions build and sign the APK on every merge and attach it to a public GitHub Release, and the phone installs updates from there with Obtainium. TMY Fitness made the same choice first (its ADR 0003).

## Considered Options

- **Keep the installable web app**: rejected, because the browser can drop queued Services and Odometer Readings.
- **Capacitor app that loads the screens from the NAS**: rejected. It would update itself, but opening offline would depend on the browser cache again.
- **Rewrite in Kotlin**: rejected, because it means a second app to maintain for no gain over the existing screens.
- **Server address built into the APK**: rejected. The APK would then be private data and could not be built or published from this public repository.

## Consequences

- Every change to the screens needs a new APK installed on the phone; there is no silent update any more.
- The server and the app agree on an API version (`src/shared/api-version.ts`). When they differ, the app keeps its queue, stops sending, and asks for the app or the server to be updated. Bump the version whenever a change to `/api` would break an older app.
- The server accepts requests from the Android app's own origin (CORS), since the screens no longer come from the server.
- The signing key is kept as a GitHub secret and in the encrypted NAS backup. Losing it means reinstalling the app, which deletes anything not yet sent.
- The Android app ID `com.tmycode.tmy_garage` can never change without a reinstall.
