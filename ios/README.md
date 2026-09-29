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
```

Keep `.dev` on a free Personal Team: its builds stop opening after 7 days
and it can't use `com.jaydenguo.hub`, which belongs to the paid team
(TestFlight). With the paid team, drop the suffix. Then, with the phone
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
DATABASE_URL=postgres://hub:hub@localhost:5433/hub_fixtures pnpm seed
DATABASE_URL=postgres://hub:hub@localhost:5433/hub_fixtures APP_URL=http://localhost:3200 pnpm dev --port 3200
```

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

Needs the Apple Developer account (plan O-1, O-2):

1. Set `DEVELOPMENT_TEAM` in `project.yml`, run `xcodegen`, and bump
   `CURRENT_PROJECT_VERSION` (and `MARKETING_VERSION` for a new version).
2. Run the UI tests.
3. Xcode → Product → Archive → Distribute App → TestFlight (internal only).
4. TestFlight builds expire after 90 days: release at least every 60.

To make old builds update, set `MIN_APP_VERSION` on the web service. They
get a "please update" screen.

## Lost phone

On the website, Settings → **Sign out everywhere** ends every session
within a minute, the phone's included. The app then wipes its data the
next time it reaches the server.
