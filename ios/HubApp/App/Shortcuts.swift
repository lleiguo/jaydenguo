import AppIntents
import HubKit

/// Shortcuts and Siri (intent 0004, EXT-4). Each asks for the phone to be
/// unlocked first: the answers are the family's schedule.

/// The next few days, fetched fresh, or the offline copy when that fails.
private func schedule() async -> WidgetSnapshot? {
    let cache = ResponseCache.shared(appGroup: ResponseCache.bundleAppGroup)
    let client = SharedClient.make(deviceName: "shortcut", cache: cache)
    guard client.isSignedIn else { return nil }
    let tz = (try? await client.api.getSettings().ok.body.json.homeTimeZone) ?? TimeZone.current.identifier
    let home = HomeTime(identifier: tz)
    let today = home.localDate(.now)
    if let from = home.startOfDay(today), let to = home.startOfDay(CalendarDates.add(days: 4, to: today)),
       let payload = try? await client.api.listEvents(query: .init(from: from, to: to)).ok.body.json {
        let filters = await MainActor.run { CalendarStore.loadFilters() }
        return WidgetSnapshot.build(from: CalendarIndex(payload), filters: filters, homeTime: home)
    }
    return WidgetSnapshot.load(from: cache)
}

private let signedOut = "Open Hub and sign in first."

struct WhatsNextIntent: AppIntent {
    static let title: LocalizedStringResource = "What's next"
    static let description = IntentDescription("The next event on the family calendar.")
    static let authenticationPolicy = IntentAuthenticationPolicy.requiresAuthentication

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let s = await schedule() else { return .result(dialog: "\(signedOut)") }
        return .result(dialog: "\(s.spokenNext(at: .now))")
    }
}

struct TodayScheduleIntent: AppIntent {
    static let title: LocalizedStringResource = "Today's schedule"
    static let description = IntentDescription("The rest of today on the family calendar.")
    static let authenticationPolicy = IntentAuthenticationPolicy.requiresAuthentication

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let s = await schedule() else { return .result(dialog: "\(signedOut)") }
        return .result(dialog: "\(s.spokenToday(at: .now))")
    }
}

/// Starts every source's sync (SYNC-2); the app shows the results.
struct RefreshAllIntent: AppIntent {
    static let title: LocalizedStringResource = "Refresh all sources"
    static let description = IntentDescription("Fetch the latest from every calendar and site the hub reads.")
    static let authenticationPolicy = IntentAuthenticationPolicy.requiresAuthentication

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let client = SharedClient.make(deviceName: "shortcut")
        guard client.isSignedIn else { return .result(dialog: "\(signedOut)") }
        guard let sources = try? await client.api.listSources().ok.body.json.sources else {
            return .result(dialog: "Couldn't reach the hub. Try again in a moment.")
        }
        let now = Date.now
        let due = sources.filter { s in
            s.enabled && !s.running && !(s.nextRefreshAt.flatMap(HomeTime.parse).map { $0 > now } ?? false)
        }
        var started = 0
        for s in due where (try? await client.api.refreshSource(path: .init(id: s.id)).accepted) != nil { started += 1 }
        let recent = sources.filter(\.enabled).count - due.count
        let rest = recent > 0 ? " \(recent) synced within the hour and were left alone." : ""
        return .result(dialog: started == 0 && recent > 0
            ? "Everything synced within the hour, so nothing was refreshed."
            : "Refreshing \(started) source\(started == 1 ? "" : "s"). Changes show in Hub in a minute or two.\(rest)")
    }
}

/// The phrases Siri and Spotlight offer. They say "Hub", never a name
/// (AUTH-3).
struct HubShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: WhatsNextIntent(), phrases: ["What's next in \(.applicationName)", "\(.applicationName) what's next"],
                    shortTitle: "What's next", systemImageName: "clock")
        AppShortcut(intent: TodayScheduleIntent(), phrases: ["Today's schedule in \(.applicationName)", "\(.applicationName) today"],
                    shortTitle: "Today's schedule", systemImageName: "calendar")
        AppShortcut(intent: RefreshAllIntent(), phrases: ["Refresh \(.applicationName)", "Refresh all sources in \(.applicationName)"],
                    shortTitle: "Refresh all", systemImageName: "arrow.triangle.2.circlepath")
    }
}
