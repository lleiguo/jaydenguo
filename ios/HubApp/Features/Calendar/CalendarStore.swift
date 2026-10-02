import Foundation
import HubAPI
import HubKit
import Observation

/// The calendar's data and actions (intent 0004, ICAL-1..7). The server
/// decides clashes; after every action the store reloads and shows the
/// server's undo for 10 seconds (CON-3).
@MainActor @Observable
final class CalendarStore {
    enum Mode: String, CaseIterable, Identifiable {
        case agenda = "Agenda", day = "Day", week = "Week", month = "Month"
        var id: String { rawValue }
    }

    private(set) var index: CalendarIndex?
    private(set) var error: String?
    var mode: Mode = .agenda
    /// The home date the day, week and month views show.
    var anchor: String
    var filters: CalendarFilters {
        didSet {
            Self.saveFilters(filters)
            if let index { model.saveWidgets(index, filters: filters) }
        }
    }
    /// The school block opened to show its classes (SCH-1), by block id,
    /// for this visit. One at a time: opening another folds this one.
    var expandedSchool: String?
    /// The agenda hides what's already over unless asked, for this visit.
    var showPast = false

    private let model: AppModel
    private var loaded: (from: String, to: String)?

    init(model: AppModel) {
        self.model = model
        anchor = model.homeTime.localDate(.now)
        filters = Self.loadFilters()
    }

    var homeTime: HomeTime { model.homeTime }
    var isRefreshingSources: Bool { model.refreshing.contains("all") }
    var today: String { homeTime.localDate(.now) }
    var shown: [CalendarEvent] { index?.shown(filters) ?? [] }
    var people: [Person] { index?.payload.people ?? [] }
    var closures: Set<String> { Set(index?.payload.closures ?? []) }

    var sources: [(id: String, name: String)] {
        var seen: [String: String] = [:]
        for e in index?.payload.events ?? [] { if let s = e.source { seen[s.id] = s.name } }
        return seen.map { ($0.key, $0.value) }.sorted { $0.name < $1.name }
    }

    // MARK: Loading

    /// Loads a window around the anchor: from the Monday a week before, ten
    /// weeks on. Reloads when the anchor leaves the window.
    func ensureLoaded() async {
        let from = CalendarDates.add(days: -7, to: CalendarDates.weekStart(min(anchor, today)))
        let wanted = CalendarDates.add(days: 70, to: CalendarDates.weekStart(max(anchor, today)))
        if let loaded, loaded.from <= from, wanted <= loaded.to, index != nil { return }
        await load(from: from, to: max(wanted, CalendarDates.add(days: 42, to: from)))
    }

    func reload() async {
        guard let loaded else { return await ensureLoaded() }
        await load(from: loaded.from, to: loaded.to)
    }

    private func load(from: String, to: String) async {
        guard let start = homeTime.startOfDay(from), let end = homeTime.startOfDay(to) else { return }
        do {
            let payload = try await model.client.api.listEvents(query: .init(from: start, to: end)).ok.body.json
            let index = CalendarIndex(payload)
            self.index = index
            loaded = (from, to)
            error = nil
            model.saveWidgets(index, filters: filters)
        } catch {
            if index == nil { self.error = "Couldn't load the calendar. Pull to try again." }
        }
    }

    // MARK: What a day shows

    struct DayItems {
        var allDay: [CalendarEvent]
        var timed: [CalendarEvent]
        /// Days with two or more classes fold them into one block per
        /// child (SCH-1).
        var school: [SchoolBlock] = []
        /// The block that's open here: its classes are among `timed`.
        var openSchool: SchoolBlock?

        var isEmpty: Bool { allDay.isEmpty && timed.isEmpty && school.isEmpty }
    }

    func items(on date: String) -> DayItems {
        let (allDay, timed) = DayLayout.events(on: date, from: shown, homeTime: homeTime)
        let all = SchoolBlock.blocks(timed, homeTime: homeTime).filter { $0.date == date }
        let blocks = all.filter { $0.id != expandedSchool }
        let folded = Set(blocks.flatMap { $0.classes.map(\.id) })
        return DayItems(
            allDay: allDay,
            timed: timed.filter { !folded.contains($0.id) },
            school: blocks,
            openSchool: all.first { $0.id == expandedSchool }
        )
    }

    /// Over already: timed events that have ended, all-day ones from
    /// earlier days.
    func isPast(_ e: CalendarEvent, now: Date = .now) -> Bool {
        if e.allDay { return e.allDayDates.lastExclusive <= homeTime.localDate(now) }
        return (e.endDate ?? .distantFuture) <= now
    }

    func isPast(_ block: SchoolBlock, now: Date = .now) -> Bool {
        (HomeTime.parse(block.end) ?? .distantFuture) <= now
    }

    /// The agenda's day: everything, or only what isn't over yet.
    func upcomingItems(on date: String, now: Date = .now) -> DayItems {
        var items = items(on: date)
        guard !showPast else { return items }
        items.allDay.removeAll { isPast($0, now: now) }
        items.timed.removeAll { isPast($0, now: now) }
        items.school.removeAll { isPast($0, now: now) }
        if let open = items.openSchool, isPast(open, now: now) { items.openSchool = nil }
        return items
    }

    func mark(_ e: CalendarEvent) -> ClashMark { index?.mark(for: [e.id], filters: filters) ?? .none }
    func mark(_ block: SchoolBlock) -> ClashMark { index?.mark(for: block.classes.map(\.id), filters: filters) ?? .none }
    func clashes(of e: CalendarEvent) -> [CalendarIndex.ClashWith] { index?.clashes(of: e.id) ?? [] }
    func ownerNames(_ e: CalendarEvent) -> String? { index?.ownerNames(e) }
    func ownerNames(_ block: SchoolBlock) -> String? { index?.ownerNames(block.owners) }
    func event(_ id: String) -> CalendarEvent? { index?.byId[id] }

    // MARK: Actions

    /// Runs an action, shows its message and undo, then reloads.
    private func act(_ message: String, _ work: () async throws -> Undo?) async {
        do {
            let undo = try await work()
            model.show(message, undo: undo)
        } catch {
            model.show(HubError.from(error)?.message ?? "That didn't work. Check your connection and try again.")
        }
        await model.dataChanged()
        await reload()
    }

    func move(_ e: CalendarEvent, to span: (start: Date, end: Date)) async {
        await act("Moved.") {
            try await model.client.api.moveEvent(path: .init(id: e.id), body: .json(.init(start: span.start, end: span.end))).ok.body.json.undo
        }
    }

    func setSkipped(_ e: CalendarEvent, _ skip: Bool) async {
        await act(skip ? "Skipped." : "Not skipped any more.") {
            try await model.client.api.skipEvent(path: .init(id: e.id), body: .json(.init(skip: skip))).ok.body.json.undo
        }
    }

    /// Skips (or un-skips) every occurrence still to come (CON-4).
    func setSkippedRepeats(_ e: CalendarEvent, _ skip: Bool) async {
        await act(skip ? "Skipped every repeat." : "Repeats not skipped any more.") {
            let answer = try await model.client.api.skipRepeats(path: .init(id: e.id), body: .json(.init(skip: skip))).ok.body.json
            return answer.undo
        }
    }

    func setAttendance(_ e: CalendarEvent, optional: Bool) async {
        await act(optional ? "Marked optional; it won't clash." : "Marked required.") {
            try await model.client.api.setAttendance(
                path: .init(id: e.id), body: .json(.init(attendance: optional ? .optional : .required))
            ).ok.body.json.undo
        }
    }

    func setOwners(_ e: CalendarEvent, _ ownerIds: [String]) async {
        let names = people.filter { ownerIds.contains($0.id) }.map(\.name).joined(separator: ", ")
        await act("Now \(names)'s.") {
            try await model.client.api.setOwners(path: .init(id: e.id), body: .json(.init(ownerIds: ownerIds))).ok.body.json.undo
        }
    }

    func accept(_ clash: CalendarClash) async {
        await act("Clash accepted.") {
            try await model.client.api.acceptClash(body: .json(.init(a: clash.a, b: clash.b))).ok.body.json.undo
        }
    }

    func unaccept(_ clash: CalendarClash) async {
        guard let id = clash.acceptedId else { return }
        await act("Clash no longer accepted.") {
            _ = try await model.client.api.undoAcceptClash(path: .init(id: id)).noContent
            return nil
        }
    }

    func useSourceTime(_ e: CalendarEvent) async {
        await act("Back to the source's time.") {
            _ = try await model.client.api.resetEvent(path: .init(id: e.id)).noContent
            return nil
        }
    }

    func delete(_ e: CalendarEvent) async {
        await act("Deleted.") {
            try await model.client.api.deleteEvent(path: .init(id: e.id)).ok.body.json.undo
        }
    }

    /// Syncs every source (SYNC-2); the calendar reloads as each lands.
    func refreshAllSources() async {
        await model.refreshAllSources()
        await reload()
    }

    // MARK: Saved filters

    private static let filtersKey = "calendarFilters.v1"

    static func loadFilters() -> CalendarFilters {
        guard let data = UserDefaults.standard.data(forKey: filtersKey),
              let f = try? JSONDecoder().decode(CalendarFilters.self, from: data)
        else { return CalendarFilters() }
        return f
    }

    private static func saveFilters(_ f: CalendarFilters) {
        if let data = try? JSONEncoder().encode(f) { UserDefaults.standard.set(data, forKey: filtersKey) }
    }
}
