# Security review: the iPhone app and its backend routes (N8.4, 2026-09-30)

Plan N8.4, spec SEC-1..5 and API-1..6. A manual read of `ios/` (the app, the
widgets, the notification and share extensions, HubKit) and of the backend
routes added for the app, on top of [0001's review](../0001-jayden-hub/security-review.md),
which still covers the website. Each area below was read in the code; the
tests named are the ones that prove it.

## Findings

| Area | What was checked | Result |
|---|---|---|
| Sign-in (API-1) | The app opens Google sign-in through the site in an ephemeral `ASWebAuthenticationSession`, so no Google cookies stay on the phone. The code that comes back to `jaydenguohub://auth` is single use, lasts 60 s and is bound to the app's PKCE challenge; a wrong verifier, a reused or expired code, or an account not on the allow-list gets 401 and creates nothing (`tests/integration/device-auth.test.ts`). | OK |
| Bearer tokens (API-2) | `/api/v1` takes `Authorization: Bearer`; tokens are `sessions` rows keyed by an HMAC like cookies, listed under Sessions and ended by "Sign out everywhere". Bearer requests skip the Origin check (browsers never send the header by themselves). Pages never accept bearer tokens. The route-list e2e test, built from Next's manifest, proves every route (including this milestone's `devices/current` and `notifications/{id}`) refuses anonymous requests. Firebase Hosting forwards the header (SP-N1). | OK |
| Token on the phone (SEC-1) | Keychain only, `AfterFirstUnlockThisDeviceOnly` (never synced or backed up), in the app group so the notification extension, share extension and Shortcuts can call the API. Moved there once from the app's own group, deleting every copy first so signing out can't leave one behind. Never logged: the app, HubKit and the extensions have no `print`, `NSLog` or `Logger` calls. | OK |
| Development switches | `-HubBaseURL`, `HUB_BASE_URL`, `-HubUITestToken` and `-HubNoLock` only work in `DEBUG` builds; a TestFlight build always talks to `https://jaydenguo.com`. | OK |
| Sign out wipes (SEC-3) | Sign out (or a 401) deletes the token and the offline cache and redraws the widgets empty. The server ends the session, and a device row is only ever sent to through a live session, so pushes stop at once. | OK |
| Offline copy (OFF-3) | App-group files with "complete until first unlock" protection (widgets read them while locked), excluded from backups. The video clip is a separate temporary file with complete protection, deleted when the screen closes and at the next launch if the app was killed. | OK |
| Links from the API | Every link the app opens from server data (event sources, tournament and draw pages, the entry form, Commit Swimming, Veracross, the email, the Photos picker) is checked to be `https` first, so a feed can't make the app open another app's URL scheme. | OK |
| Incoming links | `jaydenguohub://open/...` only navigates (the `Route` parser), never acts; any app or web page can open it, so it carries no actions or tokens. A notification's target goes through the same parser. | OK |
| Push (PUSH-2, PUSH-6) | Apple carries `{alert: "Hub" / "New update", id, kind}` only; the text is fetched with the device token by the extension. The `.p8` key is a Secret Manager secret only the worker can read, registered with the log redactor, and the JWT too. Registration needs a device session and an APNs-shaped token and this app's bundle ID. Dead tokens are dropped. | OK |
| Share extension (EXT-3) | Sends only the shared link, sport, date and note to the hub with the device token. A Google Photos link isn't sent anywhere: it's handed to the app through the app group. | OK |
| Shortcuts (EXT-4) | Each intent requires the phone to be unlocked, so Siri can't read the schedule from a locked phone. | OK |
| Credentials (SEC-5) | Accounts uses secure fields; secrets are sent to the server and never read back or kept (UI test "a saved password is never shown"). | OK |
| Third parties (SEC-4) | Only Apple frameworks and Apple's swift-openapi packages (generator, runtime, URLSession transport). No analytics or crash SDKs. | OK |
| Backend routes | `PATCH /api/v1/videos/{id}`, `devices/current` (GET/POST/PATCH) and `notifications/{id}`: zod-validated input, session required, device-only where it matters (registering for pushes), integration-tested. A notification's text is household data like every other route's. | OK |

## Accepted risks (owner to confirm)

1. **Widgets show the schedule on the lock screen** (EXT-1). That's what they
   are for; anyone who doesn't want that can leave them off the lock screen.
   Their data is protected until the phone's first unlock after a restart.
2. **`NSAllowsLocalNetworking` is in every build's Info.plist,** because
   XcodeGen writes one plist for all configurations. Release builds can't
   point at another server, so it can't be used; it only lets development
   builds reach a local server.
3. **The app group holds the server address and a Google Photos hand-off**
   (no secrets). Only this app and its extensions can read it.
4. **TestFlight builds expire after 90 days** (N-5): the runbook in
   `ios/README.md` says to ship at least every 60 days.
