import Foundation

/// What "Delete?" says before an event is deleted (intent 0022, DEL-2,
/// DEL-4, D-1). The website says the same (`src/domain/delete-confirm.ts`).
public enum DeleteConfirm {
    public static let householdKinds = ["google_calendar"]

    public static func isHousehold(kind: String?) -> Bool {
        kind.map(householdKinds.contains) ?? false
    }

    /// The question, then the line under it (nil for an event added here).
    public static func text(title: String, sourceName: String?, sourceKind: String?, householdOn: Bool) -> (title: String, message: String?) {
        let ask = "Delete “\(title)”?"
        guard let name = sourceName, let kind = sourceKind else { return (ask, nil) }
        if isHousehold(kind: kind) {
            return (ask, householdOn
                ? "It goes from the family's Google Calendar too."
                : "It stays in the family's Google Calendar. Restore it from Settings → Deleted.")
        }
        let tennis = kind.hasPrefix("tennis") ? " This doesn't withdraw the entry." : ""
        return (ask, "It stays deleted when \(name) syncs.\(tennis) Restore it from Settings → Deleted.")
    }
}

extension CalendarEvent {
    public func deleteConfirm(householdOn: Bool) -> (title: String, message: String?) {
        DeleteConfirm.text(title: title, sourceName: source?.name, sourceKind: source?.kind, householdOn: householdOn)
    }
}
