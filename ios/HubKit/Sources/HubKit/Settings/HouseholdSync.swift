import Foundation
import HubAPI

/// Two-way sync with the household Google Calendar (intent 0020, TWO-9,
/// TWSEC-2): the switch, a dry run's list, a held run and the last run, as
/// the website's Settings shows them.
public typealias HouseholdSync = Components.Schemas.HouseholdSyncResponse
public typealias HouseholdMode = HouseholdSync.ModePayload
public typealias HouseholdPlan = Components.Schemas.PlanSummary
public typealias HouseholdPlanLine = Components.Schemas.PlanLine

extension HouseholdMode {
    /// In the order the switch shows them.
    public static let ordered: [HouseholdMode] = [.off, .dryRun, .on]

    public var label: String {
        switch self {
        case .off: "Off"
        case .dryRun: "Dry run"
        case .on: "On"
        }
    }

    /// What the app says once the switch is saved.
    public var savedMessage: String {
        switch self {
        case .off: "Off. Nothing more is written; what was written stays."
        case .dryRun: "Dry run: the list fills in about a minute. Nothing is written."
        case .on: "On. The first run waits for you to check it."
        }
    }
}

extension HouseholdSync {
    /// The calendar it writes to: the chosen one, or the only one there is.
    public var chosenSource: SourcesPayloadPayload? {
        if let sourceId { return sources.first { $0.id == sourceId } }
        return sources.count == 1 ? sources.first : nil
    }

    /// "12 added, 3 changed, …" for the last run.
    public var lastSummary: String? {
        guard let l = last else { return nil }
        return "\(Int(l.created)) added, \(Int(l.updated)) changed, \(Int(l.linked)) matched, "
            + "\(Int(l.deleted)) deleted, \(Int(l.fromGoogle ?? 0)) from Google"
    }
}

extension HouseholdPlan {
    /// The non-empty parts of a plan, with the website's headings.
    public var sections: [(heading: String, lines: [HouseholdPlanLine])] {
        [
            ("Add", create),
            ("Change", update),
            ("Match to an event already there", link),
            ("Delete", remove),
            ("Leave, no longer matched", unlink),
        ].filter { !$0.1.isEmpty }
    }

    public var isEmpty: Bool { sections.isEmpty }

    /// A plan holds at most 50 lines per part; a full part may have more.
    public static func count(_ lines: [HouseholdPlanLine]) -> String {
        lines.count >= 50 ? "\(lines.count) or more" : "\(lines.count)"
    }
}

/// Who made a change read back from the household Google Calendar
/// (BACK-3): an override's `createdBy`. Matches `GOOGLE_ACTOR` on the server.
public let googleActor = "Google Calendar"

extension CalendarEvent.OverridePayload {
    /// The move came from Google Calendar, not from a drag here (BACK-3, BACK-5).
    public var changedInGoogle: Bool { createdBy == googleActor }
}
