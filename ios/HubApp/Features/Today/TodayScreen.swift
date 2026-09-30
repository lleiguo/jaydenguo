import HubAPI
import HubKit
import SwiftUI

/// Today (intent 0004, APP-2): one scroll with the closure banner, what's
/// next, today's events for the chosen people, the week's clashes, school,
/// the next match and meet, and what's waiting on the owner.
struct TodayScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(CalendarStore.self) private var calendar
    @Environment(\.openURL) private var openURL
    @State private var state: Loadable<Components.Schemas.TodayView> = .loading
    @State private var selected: EventRef?

    private var homeTime: HomeTime { model.homeTime }

    var body: some View {
        @Bindable var calendar = calendar
        LoadableView(state: state) { today in
            List {
                if today.people.count > 1 {
                    PeopleChips(people: today.people, hidden: $calendar.filters.hiddenPeople)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                if today.closures.contains(today.date) {
                    Label("School is closed today", systemImage: "xmark.octagon.fill")
                        .font(.headline)
                        .listRowBackground(Color.secondary.opacity(0.15))
                }
                let events = today.events.filter { calendar.filters.isVisible($0) }
                if let next = nextUp(events) { nextUpSection(next) }
                eventsSection(today, events)
                clashesSection(today)
                schoolSection(today)
                tennisSection(today)
                meetSection(today)
                waitingSection(today)
            }
            .accessibilityIdentifier("todayList")
        }
        .navigationTitle("Today")
        .task { await refresh() }
        .refreshable { await refresh() }
        .onChange(of: model.changes) { Task { await refresh() } }
        .sheet(item: $selected) { ref in
            EventSheet(store: calendar, eventId: ref.id, edit: { _ in selected = nil })
        }
    }

    private func refresh() async {
        let next = await load { try await model.client.api.getToday().ok.body.json }
        if case .failed = next, state.value != nil { return }
        state = next
        await calendar.ensureLoaded()
    }

    // MARK: Sections

    /// The next thing today that hasn't finished: timed, and not skipped.
    private func nextUp(_ events: [CalendarEvent]) -> CalendarEvent? {
        events
            .filter { !$0.allDay && !$0.isSkipped && !$0.isCancelled && ($0.endDate ?? .distantPast) > .now }
            .min { ($0.startDate ?? .distantFuture) < ($1.startDate ?? .distantFuture) }
    }

    private func nextUpSection(_ e: CalendarEvent) -> some View {
        Section("Next up") {
            Button { selected = EventRef(id: e.id) } label: {
                HStack(spacing: 12) {
                    Image(systemName: e.category.symbol)
                        .font(.title2)
                        .foregroundStyle(e.category.color)
                        .frame(width: 36)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(e.title).font(.headline)
                        TimelineView(.periodic(from: .now, by: 30)) { context in
                            Text(countdown(to: e, now: context.date))
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        if let place = e.locationName { Text(place).font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("nextUp")
        }
    }

    private func countdown(to e: CalendarEvent, now: Date) -> String {
        guard let start = e.startDate, let end = e.endDate else { return "" }
        if start <= now { return "Now, until \(homeTime.time(end))" }
        let minutes = Int(start.timeIntervalSince(now) / 60)
        let wait = minutes < 60 ? "\(max(minutes, 1)) min" : "\(minutes / 60) h \(minutes % 60) min"
        return "In \(wait), at \(homeTime.time(start))"
    }

    private func eventsSection(_ today: Components.Schemas.TodayView, _ events: [CalendarEvent]) -> some View {
        Section(homeTime.dayTitle(today.date)) {
            if events.isEmpty {
                Text(today.events.isEmpty ? "Nothing on today." : "Nothing on for the people shown.")
                    .foregroundStyle(.secondary)
            }
            ForEach(events, id: \.id) { e in
                Button { selected = EventRef(id: e.id) } label: {
                    CalendarEventRow(event: e, homeTime: homeTime, mark: calendar.mark(e), owners: calendar.ownerNames(e))
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func clashesSection(_ today: Components.Schemas.TodayView) -> some View {
        let open = today.clashes.filter { $0.acceptedId == nil }
        if !open.isEmpty {
            Section("Clashes in the next 7 days") {
                ForEach(open, id: \.a) { c in
                    Button { selected = EventRef(id: c.eventA.id) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Label("\(c.eventA.title) and \(c.eventB.title)", systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                            Text("\(dayAndTime(c.eventA)) · overlaps \(Int(c.overlapMin)) min")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private func schoolSection(_ today: Components.Schemas.TodayView) -> some View {
        if let school = today.schoolDay {
            Section(school.today ? "Today at school" : "Next school day · \(homeTime.dayTitle(school.date))") {
                ForEach(school.periods, id: \.id) { p in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.title)
                        Text([homeTime.range(p.start, p.end), p.room, p.teachers].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Button("School page") { model.go(.school) }
            }
        }
    }

    @ViewBuilder
    private func tennisSection(_ today: Components.Schemas.TodayView) -> some View {
        if let match = today.nextMatches.first {
            Section("Next match") {
                Button { model.selectedTab = .tennis } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Label(match.tournament.name, systemImage: "tennisball.fill").font(.headline)
                        if let next = match.draw.next?.value1 {
                            Text([next.round, next.opponent.map { "vs \($0.name)" }, [next.date, next.time].compactMap { $0 }.joined(separator: " ")]
                                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.subheadline)
                        }
                        if let p = match.prediction {
                            Text("Win chance \(Int((p.probability * 100).rounded()))% · \(p.confidence.rawValue) confidence · estimate")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func meetSection(_ today: Components.Schemas.TodayView) -> some View {
        if let meet = today.nextMeet {
            Section("Next swim meet") {
                Button { model.selectedTab = .swimming } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Label(meet.name, systemImage: "figure.pool.swim").font(.headline)
                        Text([meet.startDate == meet.endDate ? meet.startDate : "\(meet.startDate) – \(meet.endDate)", meet.venue]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.subheadline)
                        if let session = meet.sessions.first {
                            Text("First session \(session.date) at \(session.time) · \(meet.entries.count) events entered")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func waitingSection(_ today: Components.Schemas.TodayView) -> some View {
        let w = today.waiting
        if !w.entries.isEmpty || w.suggestions > 0 || !w.failingSources.isEmpty {
            Section("Waiting on you") {
                ForEach(w.entries, id: \.id) { entry in
                    Button {
                        if let url = URL(string: entry.entryUrl ?? entry.tournamentUrl), url.scheme == "https" { openURL(url) }
                    } label: {
                        Label {
                            VStack(alignment: .leading) {
                                Text(entry.status == "payment_needed" ? "Pay for \(entry.tournamentName)" : "Enter \(entry.tournamentName)")
                                Text("\(entry.startDate) · \(entry.eventName)").font(.caption).foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: "tennisball")
                        }
                    }
                }
                if w.suggestions > 0 {
                    Button { model.go(.suggestions) } label: {
                        Label("\(Int(w.suggestions)) email suggestion\(w.suggestions == 1 ? "" : "s") to review", systemImage: "envelope.badge")
                    }
                }
                ForEach(w.failingSources, id: \.id) { source in
                    Button { model.go(.sources) } label: {
                        Label("\(source.name) isn't syncing (\(Int(source.consecutiveFailures)) tries)", systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                            .foregroundStyle(.red)
                    }
                }
            }
        }
    }

    private func dayAndTime(_ e: CalendarEvent) -> String {
        guard let s = e.startDate else { return e.start }
        return "\(homeTime.dayTitle(homeTime.localDate(s))), \(e.allDay ? "all day" : homeTime.time(e.start))"
    }
}
