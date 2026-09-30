import HubAPI
import HubKit
import SwiftUI

/// Identifies an event for sheets.
struct EventRef: Identifiable, Hashable {
    let id: String
}

/// The calendar (intent 0004, ICAL-1..7): agenda by default, and day, week
/// and month views, with people chips, filters and live updates.
struct CalendarScreen: View {
    @Environment(CalendarStore.self) private var store

    var body: some View {
        CalendarContent(store: store)
            .navigationTitle("Calendar")
    }
}

private struct CalendarContent: View {
    @Environment(AppModel.self) private var model
    @Bindable var store: CalendarStore
    @State private var selected: EventRef?
    @State private var editing: EventEditor.Target?
    @State private var showFilters = false

    var body: some View {
        VStack(spacing: 8) {
            Picker("View", selection: $store.mode) {
                ForEach(CalendarStore.Mode.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            PeopleChips(people: store.people, hidden: $store.filters.hiddenPeople)

            if let error = store.error, store.index == nil {
                ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(error))
            } else if store.index == nil {
                ProgressView().frame(maxHeight: .infinity)
            } else {
                switch store.mode {
                case .agenda: AgendaView(store: store, selected: $selected)
                case .day: TimeGridView(store: store, days: [store.anchor], selected: $selected)
                case .week: TimeGridView(store: store, days: CalendarDates.days(from: CalendarDates.weekStart(store.anchor), count: 7), selected: $selected)
                case .month: MonthView(store: store)
                }
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarLeading) {
                if store.mode != .agenda {
                    Button { step(-1) } label: { Image(systemName: "chevron.left") }
                        .accessibilityLabel("Previous")
                    Button { step(1) } label: { Image(systemName: "chevron.right") }
                        .accessibilityLabel("Next")
                }
                Button("Today") { store.anchor = store.today }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Button { showFilters = true } label: { Label("Filters", systemImage: "line.3.horizontal.decrease.circle") }
                    Button {
                        Task { await store.refreshAllSources() }
                    } label: {
                        Label("Refresh all sources", systemImage: "arrow.clockwise")
                    }
                    .disabled(store.isRefreshingSources)
                } label: {
                    Image(systemName: store.filters.isFiltering ? "line.3.horizontal.decrease.circle.fill" : "ellipsis.circle")
                }
                .accessibilityLabel("Calendar options")
                Button { editing = .new(date: store.anchor) } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Add event")
            }
        }
        .overlay(alignment: .top) {
            if store.isRefreshingSources {
                ProgressView("Refreshing sources…")
                    .padding(10)
                    .background(.thickMaterial, in: Capsule())
                    .padding(.top, 4)
            }
        }
        .task(id: store.anchor) { await store.ensureLoaded() }
        .onChange(of: model.changes) { Task { await store.reload() } }
        .onChange(of: model.pendingRoute) { openRoute() }
        .onAppear { openRoute() }
        .sheet(item: $selected) { ref in
            EventSheet(store: store, eventId: ref.id, edit: { event in
                selected = nil
                editing = .existing(event)
            })
        }
        .sheet(item: $editing) { target in
            EventEditor(target: target, store: store)
        }
        .sheet(isPresented: $showFilters) {
            FilterSheet(store: store)
        }
    }

    private func step(_ direction: Int) {
        switch store.mode {
        case .agenda: break
        case .day: store.anchor = CalendarDates.add(days: direction, to: store.anchor)
        case .week: store.anchor = CalendarDates.add(days: 7 * direction, to: store.anchor)
        case .month: store.anchor = CalendarDates.add(months: direction, to: CalendarDates.monthStart(store.anchor))
        }
    }

    private func openRoute() {
        switch model.pendingRoute {
        case .event(let id):
            selected = EventRef(id: id)
            model.pendingRoute = nil
        case .calendar(let date):
            if let date { store.anchor = date; store.mode = .day }
            model.pendingRoute = nil
        default:
            break
        }
    }
}

/// Agenda (the default, ICAL-1): day by day from now, with swipe actions
/// (ICAL-5). What's already over stays hidden until "Show earlier".
struct AgendaView: View {
    @Bindable var store: CalendarStore
    @Binding var selected: EventRef?
    @State private var confirmSkip: CalendarEvent?

    var body: some View {
        let start = store.showPast ? min(store.anchor, CalendarDates.add(days: -7, to: store.today)) : store.today
        let days = CalendarDates.days(from: start, count: 60)
        let now = Date.now
        ScrollViewReader { proxy in
            List {
                Section {
                    Button {
                        withAnimation { store.showPast.toggle() }
                    } label: {
                        Label(
                            store.showPast ? "Hide what's over" : "Show earlier",
                            systemImage: store.showPast ? "chevron.down" : "chevron.up"
                        )
                        .font(.subheadline)
                    }
                    .accessibilityIdentifier("agenda-show-earlier")
                }
                ForEach(days, id: \.self) { date in
                    let items = store.upcomingItems(on: date, now: now)
                    if date == store.today || !items.isEmpty {
                        Section {
                            if store.closures.contains(date) {
                                Label("School closed", systemImage: "xmark.octagon.fill").foregroundStyle(.secondary)
                            }
                            if items.isEmpty {
                                Text(store.showPast || store.items(on: date).isEmpty ? "Nothing on." : "Nothing else today.")
                                    .foregroundStyle(.secondary)
                            }
                            ForEach(items.allDay, id: \.id) { row($0, now: now) }
                            if let block = items.school {
                                SchoolBlockRow(block: block, homeTime: store.homeTime, mark: store.mark(block)) {
                                    store.expandedSchoolDays.insert(block.date)
                                }
                            }
                            ForEach(items.timed, id: \.id) { row($0, now: now) }
                        } header: {
                            Text(dayHeader(date)).foregroundStyle(date == store.today ? Color.accentColor : .secondary)
                        }
                        .id(date)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .accessibilityIdentifier("agenda")
            .refreshable {
                await store.reload()
                // Pulling also asks the sources for news (SYNC-2); the
                // calendar reloads as each one lands.
                Task { await store.refreshAllSources() }
            }
            .onChange(of: store.anchor) { _, date in withAnimation { proxy.scrollTo(date, anchor: .top) } }
            .onChange(of: store.showPast) { _, _ in proxy.scrollTo(store.today, anchor: .top) }
        }
        .confirmationDialog(
            "Skip which?",
            isPresented: Binding(get: { confirmSkip != nil }, set: { if !$0 { confirmSkip = nil } }),
            titleVisibility: .hidden,
            presenting: confirmSkip
        ) { e in
            Button("Skip this one") { Task { await store.setSkipped(e, true) } }
            Button("Skip every repeat") { Task { await store.setSkippedRepeats(e, true) } }
        }
    }

    private func dayHeader(_ date: String) -> String {
        let title = store.homeTime.dayTitle(date)
        if date == store.today { return "Today · \(title)" }
        if date == CalendarDates.add(days: 1, to: store.today) { return "Tomorrow · \(title)" }
        return title
    }

    private func row(_ e: CalendarEvent, now: Date) -> some View {
        Button { selected = EventRef(id: e.id) } label: {
            CalendarEventRow(event: e, homeTime: store.homeTime, mark: store.mark(e), owners: store.ownerNames(e))
                .opacity(store.isPast(e, now: now) ? 0.5 : 1)
        }
        .buttonStyle(.plain)
        .listRowBackground(store.mark(e) == .clash ? Color.red.opacity(0.08) : nil)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button {
                if e.repeats == true && !e.isSkipped {
                    confirmSkip = e
                } else {
                    Task { await store.setSkipped(e, !e.isSkipped) }
                }
            } label: {
                Label(e.isSkipped ? "Don't skip" : "Skip", systemImage: e.isSkipped ? "arrow.uturn.backward" : "forward.end")
            }
            .tint(.orange)
            if e.status == .active {
                Button { selected = EventRef(id: e.id) } label: { Label("Move", systemImage: "calendar.badge.clock") }
                    .tint(.blue)
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if let open = store.clashes(of: e).first(where: { $0.clash.acceptedId == nil }) {
                Button { Task { await store.accept(open.clash) } } label: {
                    Label("Accept clash", systemImage: "checkmark.circle")
                }
                .tint(.green)
            }
            Button {
                Task { await store.setAttendance(e, optional: e.attendance == .required) }
            } label: {
                Label(e.attendance == .required ? "Optional" : "Required", systemImage: "person.crop.circle.badge.questionmark")
            }
            .tint(.purple)
        }
    }
}

/// A folded school day (SCH-1): tap to see each class.
struct SchoolBlockRow: View {
    let block: SchoolBlock
    let homeTime: HomeTime
    let mark: ClashMark
    let expand: () -> Void

    var body: some View {
        Button(action: expand) {
            HStack(spacing: 12) {
                Text(homeTime.time(block.start))
                    .font(.subheadline.monospacedDigit())
                    .frame(width: 70, alignment: .leading)
                RoundedRectangle(cornerRadius: 2).fill(EventCategory.schoolClass.color).frame(width: 4)
                VStack(alignment: .leading) {
                    HStack {
                        Label("School", systemImage: EventCategory.schoolClass.symbol)
                        ClashSymbol(mark: mark)
                    }
                    Text("\(homeTime.range(block.start, block.end)) · \(block.classes.count) classes")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.down").foregroundStyle(.tertiary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityHint("Shows each class")
    }
}

/// Categories and sources to show (CAL-3).
struct FilterSheet: View {
    @Bindable var store: CalendarStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Categories") {
                    ForEach(EventCategory.allCases, id: \.self) { c in
                        Toggle(isOn: binding(\.hiddenCategories, c.rawValue)) {
                            Label(c.label, systemImage: c.symbol).foregroundStyle(c.color, .primary)
                        }
                    }
                }
                if !store.sources.isEmpty {
                    Section("Sources") {
                        ForEach(store.sources, id: \.id) { s in
                            Toggle(s.name, isOn: binding(\.hiddenSources, s.id))
                        }
                    }
                }
                Section {
                    Button("Show everything") { store.filters = CalendarFilters() }
                }
            }
            .navigationTitle("Filters")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    /// A toggle that's on while the item isn't hidden.
    private func binding(_ keyPath: WritableKeyPath<CalendarFilters, Set<String>>, _ id: String) -> Binding<Bool> {
        Binding(
            get: { !store.filters[keyPath: keyPath].contains(id) },
            set: { on in
                if on { store.filters[keyPath: keyPath].remove(id) } else { store.filters[keyPath: keyPath].insert(id) }
            }
        )
    }
}
