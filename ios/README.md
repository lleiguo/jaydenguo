# Hub for iPhone

The native app for jaydenguo.com (intent
[0004](../intent/0004-ios-app/)). SwiftUI, iOS 18+, iPhone only. It's a
thin client: everything it shows comes from `/api/v1`, and the server
decides clashes, predictions and forecasts.

```
ios/
├── project.yml        XcodeGen spec (the .xcodeproj is generated, not committed)
├── HubKit/            Swift package: everything that isn't a view
│   ├── Sources/HubAPI/   client generated from ../../openapi.json (a symlink)
│   ├── Sources/HubKit/   sign-in, token storage, API client, time, routes, lock rules
│   └── Tests/            Swift Testing; Fixtures/ are recorded API responses
├── HubApp/            the app: App/ (model, lock, tabs) and Features/<screen>
└── HubAppUITests/     XCUITest against a local server
```

## Set up

1. Xcode (current release) and XcodeGen: `brew install xcodegen`.
2. If `xcode-select -p` shows the command line tools, point it at Xcode
   (`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`), or
   prefix commands with
   `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
3. `cd ios && xcodegen && open JaydenHub.xcodeproj`. The first build asks
   to trust the OpenAPI generator plugin: choose **Trust & Enable**.

## Run on your iPhone

Signing comes from `Signing.xcconfig`, which includes a git-ignored
`Local.xcconfig`. Create it with your team ID (Xcode shows it once a
project picks the team in Signing & Capabilities):

```
DEVELOPMENT_TEAM = ABCDE12345
HUB_BUNDLE_SUFFIX = .dev
HUB_APP_ENTITLEMENTS[sdk=iphoneos*] = HubApp/HubApp-NoPush.entitlements
```

Keep `.dev` on a free Personal Team: its builds stop opening after 7 days
and it can't use `com.jaydenguo.hub`, which belongs to the paid team
(TestFlight). A Personal Team can't sign push notifications either, so the
last line leaves them out of phone builds (Simulator builds keep them).
With the paid team, drop the suffix and that line. Then, with the phone
plugged in and Developer Mode on:

```bash
cd ios && xcodegen && xcodebuild -project JaydenHub.xcodeproj -scheme HubApp -destination 'platform=iOS,name=<your iPhone>' -derivedDataPath build/device -allowProvisioningUpdates -skipPackagePluginValidation build
xcrun devicectl device install app --device '<your iPhone>' build/device/Build/Products/Debug-iphoneos/HubApp.app
```

The first launch needs Settings → General → VPN & Device Management →
trust the developer. Device builds talk to jaydenguo.com.

## Test

```bash
cd ios/HubKit && swift test
```

UI tests need a local development server on port 3200, with a database
that holds only the made-up seed data:

```bash
createdb -h localhost -p 5433 -U hub hub_fixtures
DATABASE_URL=postgres://hub:hub@localhost:5433/hub_fixtures pnpm db:migrate
export MEDIA_DIR=~/.cache/jaydenguo/media-fixtures   # the sample review's video
DATABASE_URL=postgres://hub:hub@localhost:5433/hub_fixtures pnpm seed
DATABASE_URL=postgres://hub:hub@localhost:5433/hub_fixtures APP_URL=http://localhost:3200 ASSISTANT_LLM=fake pnpm dev --port 3200
```

`ASSISTANT_LLM=fake` gives Cookie a stand-in model (intent 0007), so the
chat tests don't call Vertex AI. Her voice tests never use the
microphone: they start the app with `-HubCookieClip <base64>` (debug
builds only), which makes the recorder hand over that clip, a made-up
voice from `tests/fixtures/assistant/question.m4a`. Likewise `-HubCookiePicture
<base64>` makes "Choose Photos" hand over a made-up screenshot from
`tests/fixtures/assistant/shared/` (intent 0019), since the system Photos
picker runs in another process. The test server's address reaches the
tests as `TEST_RUNNER_HUB_TEST_SERVER=http://localhost:<port>` on the
`xcodebuild test` line (default 3200). `AskCookieShareTests` shares a picture from Photos
to "Ask Cookie": add it first with `xcrun simctl addmedia booted
tests/fixtures/assistant/shared/practice.jpg`.

`pnpm seed` puts the sample email suggestions back, so the tests that use
them up can run again; re-run it between full test runs.

Then:

```bash
cd ios && xcodebuild -project JaydenHub.xcodeproj -scheme HubApp -destination 'platform=iOS Simulator,name=iPhone 17' -skipPackagePluginValidation test
```

The tests get a device token from `/auth/dev?client=ios` (development
servers only) and launch the app with `-HubBaseURL`, `-HubUITestToken`
and `-HubNoLock`. Debug builds honour these, release builds ignore them.

## When the API changes

`pnpm openapi` rewrites `openapi.json`, and HubAPI regenerates on the next
build. To refresh the decoding fixtures, run the server above and:

```bash
pnpm tsx scripts/record-api-fixtures.ts http://localhost:3200
```

The recorder replaces the signed-in email and the primary person's name.
It fails if anything personal is left.

## Release (TestFlight)

The paid Apple Developer team signs it (plan O-1, O-2); `Local.xcconfig`
holds its team ID with no `.dev` suffix.

**First time only**

1. App Store Connect → **Apps** → **+** → New App: iOS, name "Cookie" (or any
   name not about the family: AUTH-3), bundle ID `com.jaydenguo.hub`, SKU
   `hub`. Don't fill in the store listing: the app is never published
   (INFR-4).
2. **Users and Access**: add the other parent's Apple ID with the
   Developer or Marketing role, then TestFlight → **Internal Testing** → a
   group with both of you.
3. App Store Connect → the app → **App Privacy**: "Data not collected" (the
   app sends data only to your own site). That still holds with Cookie: a
   recording goes to your own site and isn't kept.

**Each release**

1. Bump `CURRENT_PROJECT_VERSION` in `project.yml` (and
   `MARKETING_VERSION` for a new version), run `xcodegen`.
2. Run HubKit's tests and the UI tests (above).
3. Xcode → Product → Archive → Distribute App → **TestFlight Internal
   Only**. Push switches to production automatically in the archive.
4. TestFlight builds expire after 90 days: **release at least every 60
   days** (N-5). A calendar reminder works.

To make old builds update, set `MIN_APP_VERSION` on the web service. They
get a "please update" screen.

## Push notifications

They need the APNs key in Secret Manager and `apns_key_id` /
`apns_team_id` in Terraform: see "iPhone push notifications" in
[infra/README.md](../infra/README.md), which also covers rotating the key.
Until then the worker only logs them. Development builds use Apple's
sandbox and TestFlight builds production; each phone registers whichever
it is.

To check they arrive, run the worker job `push:test` (or `push:test
<email>` for one parent's phones): the phone shows "Test notification",
and the worker logs `notified … sent: 1` per phone, or "push not sent (no
APNs key)" while the key is missing.

## Lost phone

On the website, Settings → **Sign out everywhere** ends every session
within a minute, the phone's included, and stops its notifications. The
app then wipes its data the next time it reaches the server. Face ID (on by
default) keeps the app closed meanwhile.
