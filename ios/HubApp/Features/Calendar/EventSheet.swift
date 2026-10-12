import HubAPI
import HubKit
import SwiftUI

/// Event detail (ICAL-7, CAL-4) with every non-drag action (NFR-9): Move
/// to…, skip, accept a clash, attendance, whose event, back to the source's
/// time, edit and delete.
struct EventSheet: View {
    @Bindable var store: CalendarStore
    let eventId: String
    /// Closes this sheet and any sheet on top of it ("Move to…").
    let close: () -> Void
    let edit: (CalendarEvent) -> Void
    @Environment(\.openURL) private var openURL
    @State private var moving: Bool
    @State private var confirmDelete = false

    init(store: CalendarStore, eventId: String, startMoving: Bool = false, close: @escaping () -> Void, edit: @escaping (CalendarEvent) -> Void) {
        self.store = store
        self.eventId = eventId
        self.close = close
        self.edit = edit
        _moving = State(initialValue: startMoving)
    }

    var body: some View {
        NavigationStack {
            Group {
                if let e = store.event(eventId) {
                    details(e)
                } else {
                    ContentUnavailableView("This event isn't in the loaded weeks", systemImage: "calendar.badge.exclamationmark")
                }
            }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { close() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func details(_ e: CalendarEvent) -> some View {
        let clashes = store.clashes(of: e)
        return Form {
            Section {
                Label(e.category.label, systemImage: e.category.symbol).foregroundStyle(e.category.color, .primary)
                Text(when(e)).font(.headline)
                if e.schoolClosed { Label("School is closed this day", systemImage: "xmark.octagon") }
                if let place = e.locationName { Label(place, systemImage: "mappin.and.ellipse") }
                if let notes = e.notes, !notes.isEmpty { Text(notes) }
                if e.beingAdded == true {
                    // Cookie added it; the worker writes it to the family's Google Calendar (intent 0008, GCW-4).
                    Label("Being added to the family calendar", systemImage: "arrow.triangle.2.circlepath")
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("eventBeingAdded")
                }
                if e.isCancelled { Label("Cancelled by the source", systemImage: "xmark.circle").foregroundStyle(.warning) }
                if e.isSkipped { Label("Skipped: he won't go", systemImage: "forward.end").foregroundStyle(.warning) }
            }

            Section {
                if e.status == .active {
                    Button { moving = true } label: { Label("Move to…", systemImage: "calendar.badge.clock") }
                }
                Button {
                    run { await store.setSkipped(e, !e.isSkipped) }
                } label: {
                    Label(e.isSkipped ? "Don't skip" : "Skip this one", systemImage: "forward.end")
                }
                if e.repeats == true {
                    Button {
                        run { await store.setSkippedRepeats(e, !e.isSkipped) }
                    } label: {
                        Label(e.isSkipped ? "Don't skip any repeats" : "Skip every repeat", systemImage: "repeat")
                    }
                }
                if !e.isFromSource {
                    Button { edit(e) } label: { Label(e.seriesId != nil ? "Edit series" : "Edit", systemImage: "pencil") }
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
                }
            }
            if let o = e.override, o.moved {
                Section("Moved") {
                    Text("You moved this. The source had it \(store.homeTime.range(o.originalStart, o.originalEnd)).")
                    if o.sourceChangedAt != nil {
                        Label("The source changed since you moved this.", systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.warning)
                        if let snap = o.snapshot {
                            Text("When you moved it, the source had \(store.homeTime.range(snap.start, snap.end)).").font(.caption)
                        }
                    }
                    Button("Use the source's time") { run { await store.useSourceTime(e) } }
                }
            }

            if !clashes.isEmpty {
                Section {
                    ForEach(clashes) { c in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(c.other.map { "\($0.title), \(when($0))" } ?? "Another event")
                            Text("Overlaps \(Int(c.clash.overlapMin)) min\(c.clash.acceptedId != nil ? " · accepted" : "")")
                                .font(.caption).foregroundStyle(.secondary)
                            if c.clash.acceptedId == nil {
                                Button("Accept clash") { run { await store.accept(c.clash) } }
                            } else {
                                Button("Un-accept") { run { await store.unaccept(c.clash) } }
                            }
                        }
                    }
                } header: {
                    Label("Clashes", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                }
            }

            Section("Whose and who goes") {
                Toggle("Optional (never clashes)", isOn: Binding(
                    get: { e.attendance == .optional },
                    set: { optional in run(dismissing: false) { await store.setAttendance(e, optional: optional) } }
                ))
                if store.people.count > 1 {
                    ForEach(store.people, id: \.id) { person in
                        let on = e.owners.contains(person.id)
                        Toggle(person.name, isOn: Binding(
                            get: { on },
                            set: { newValue in
                                let owners = newValue ? e.owners + [person.id] : e.owners.filter { $0 != person.id }
                                run(dismissing: false) { await store.setOwners(e, owners) }
                            }
                        ))
                        // Someone always owns it.
                        .disabled(on && e.owners.count == 1)
                    }
                }
            }

            Section("Where it's from") {
                if let source = e.source {
                    LabeledContent("Source", value: source.name)
                    if let synced = e.lastSyncedAt.flatMap(HomeTime.parse) {
                        LabeledContent("Last synced", value: synced.formatted(date: .abbreviated, time: .shortened))
                    }
                } else {
                    Text(e.seriesId != nil ? "A repeating event added in the hub." : "Added in the hub.")
                }
                if let link = e.sourceUrl.flatMap(URL.init(string:)), link.scheme == "https" {
                    Button("Open at the source") { openURL(link) }
                }
            }
        }
        .navigationTitle(e.title)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $moving) {
            MoveSheet(event: e, homeTime: store.homeTime) { span in
                run { await store.move(e, to: span) }
            }
        }
        .confirmationDialog("Delete \(e.title)?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { run { await store.delete(e) } }
        } message: {
            Text("It can be restored from Deleted on the website.")
        }
    }

    private func when(_ e: CalendarEvent) -> String {
        if e.allDay {
            let d = e.allDayDates
            let last = CalendarDates.add(days: -1, to: d.lastExclusive)
            return last == d.first ? "\(store.homeTime.dayTitle(d.first)), all day"
                : "\(store.homeTime.dayTitle(d.first)) – \(store.homeTime.dayTitle(last))"
        }
        guard let s = e.startDate else { return e.start }
        return "\(store.homeTime.dayTitle(store.homeTime.localDate(s))), \(store.homeTime.range(e.start, e.end))"
    }

    /// Runs an action; most close the sheet first, so the undo banner is
    /// in view. Closing comes first: a sheet asked to close while the one
    /// on top of it ("Move to…") is still closing stays open.
    private func run(dismissing: Bool = true, _ work: @escaping () async -> Void) {
        if dismissing { close() }
        Task { await work() }
    }
}

/// "Move to…" (CON-3, NFR-9): a new date and start time in the home time
/// zone; the length stays the same.
struct MoveSheet: View {
    let event: CalendarEvent
    let homeTime: HomeTime
    let move: ((start: Date, end: Date)) -> Void
    @State private var start: Date
    @Environment(\.dismiss) private var dismiss

    init(event: CalendarEvent, homeTime: HomeTime, move: @escaping ((start: Date, end: Date)) -> Void) {
        self.event = event
        self.homeTime = homeTime
        self.move = move
        // All-day events pick a date; the picker shows it in UTC, the stored form.
        _start = State(initialValue: event.startDate ?? .now)
    }

    var body: some View {
        NavigationStack {
            Form {
                if event.allDay {
                    DatePicker("New date", selection: $start, displayedComponents: .date)
                        .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                } else {
                    DatePicker("New start", selection: $start)
                        .environment(\.timeZone, homeTime.timeZone)
                    if homeTime.differs() {
                        Text("Times are in \(homeTime.timeZone.identifier).").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Move to…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Move") {
                        let span = event.allDay
                            ? EventMove.allDay(event, to: CalendarDates.string(start))
                            : EventMove.starting(event, at: start)
                        if let span { move(span) }
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
