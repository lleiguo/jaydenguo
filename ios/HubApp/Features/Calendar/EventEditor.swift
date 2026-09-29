import HubAPI
import HubKit
import SwiftUI

/// Add or edit an event made in the hub, one-off or repeating (ICAL-6,
/// CAL-5). Times are in the home time zone.
struct EventEditor: View {
    enum Target: Identifiable {
        case new(date: String)
        case existing(CalendarEvent)

        var id: String {
            switch self {
            case .new(let date): "new:\(date)"
            case .existing(let e): e.id
            }
        }
    }

    let target: Target
    @Bindable var store: CalendarStore
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var category: EventCategory = .other
    @State private var optional = false
    @State private var owners: Set<String> = []
    @State private var allDay = false
    @State private var start = Date.now
    @State private var end = Date.now.addingTimeInterval(3600)
    @State private var location = ""
    @State private var notes = ""
    @State private var repeats = false
    @State private var weekdays: Set<Int> = []
    @State private var intervalWeeks = 1
    @State private var hasEnd = false
    @State private var until = Date.now.addingTimeInterval(90 * 86_400)
    @State private var seriesId: String?
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDeleteSeries = false
    @State private var loaded = false

    private var homeTime: HomeTime { store.homeTime }
    private var isNew: Bool { if case .new = target { true } else { false } }
    /// All-day dates are UTC midnights (the stored form); timed ones use the home zone.
    private var pickerZone: TimeZone { allDay ? TimeZone(identifier: "UTC")! : homeTime.timeZone }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                    Picker("Category", selection: $category) {
                        ForEach(EventCategory.allCases, id: \.self) { c in
                            Label(c.label, systemImage: c.symbol).tag(c)
                        }
                    }
                    Toggle("Optional (never clashes)", isOn: $optional)
                }
                if store.people.count > 1 {
                    Section("Whose event") {
                        ForEach(store.people, id: \.id) { p in
                            Toggle(p.name, isOn: Binding(
                                get: { owners.contains(p.id) },
                                set: { on in if on { owners.insert(p.id) } else if owners.count > 1 { owners.remove(p.id) } }
                            ))
                        }
                    }
                }
                Section {
                    Toggle("All day", isOn: $allDay)
                    DatePicker(repeats ? "First day" : "Starts", selection: $start, displayedComponents: allDay ? .date : [.date, .hourAndMinute])
                    DatePicker("Ends", selection: $end, in: start..., displayedComponents: allDay ? .date : [.date, .hourAndMinute])
                } footer: {
                    if homeTime.differs() && !allDay { Text("Times are in \(homeTime.timeZone.identifier).") }
                }
                .environment(\.timeZone, pickerZone)
                if isNew || seriesId != nil {
                    Section("Repeat") {
                        Toggle("Repeats weekly", isOn: $repeats).disabled(seriesId != nil)
                        if repeats {
                            WeekdayPicker(selection: $weekdays)
                            Stepper(intervalWeeks == 1 ? "Every week" : "Every \(intervalWeeks) weeks", value: $intervalWeeks, in: 1...52)
                            Toggle("Ends", isOn: $hasEnd)
                            if hasEnd {
                                DatePicker("Last day", selection: $until, in: start..., displayedComponents: .date)
                                    .environment(\.timeZone, homeTime.timeZone)
                            }
                        }
                    }
                }
                Section {
                    TextField("Place", text: $location)
                    TextField("Notes", text: $notes, axis: .vertical).lineLimit(2...6)
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
                if seriesId != nil {
                    Section {
                        Button("Delete the whole series", role: .destructive) { confirmDeleteSeries = true }
                    }
                }
            }
            .navigationTitle(isNew ? "New event" : seriesId != nil ? "Edit series" : "Edit event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(saving || title.trimmingCharacters(in: .whitespaces).isEmpty || (repeats && weekdays.isEmpty))
                }
            }
            .confirmationDialog("Delete every event in this series?", isPresented: $confirmDeleteSeries, titleVisibility: .visible) {
                Button("Delete series", role: .destructive) { Task { await deleteSeries() } }
            }
            .task { await fill() }
        }
    }

    // MARK: Filling and saving

    private func fill() async {
        guard !loaded else { return }
        loaded = true
        let primary = store.people.first { $0.isPrimary }?.id
        switch target {
        case .new(let date):
            let base = homeTime.startOfDay(date) ?? .now
            start = base.addingTimeInterval(17 * 3600)
            end = start.addingTimeInterval(3600)
            owners = primary.map { [$0] } ?? []
            weekdays = [CalendarDates.weekday(date)]
        case .existing(let e):
            title = e.title
            category = e.category
            optional = e.attendance == .optional
            owners = Set(e.owners)
            allDay = e.allDay
            start = e.startDate ?? .now
            end = e.allDay ? (e.endDate ?? start).addingTimeInterval(-86_400) : (e.endDate ?? start)
            location = e.locationName ?? ""
            notes = e.notes ?? ""
            if let id = e.seriesId, let s = try? await model.client.api.getSeries(path: .init(id: id)).ok.body.json {
                seriesId = id
                repeats = true
                weekdays = Set(s.weekdays.map { Int($0) })
                intervalWeeks = Int(s.intervalWeeks)
                if let last = s.untilDate, let d = homeTime.startOfDay(last) {
                    hasEnd = true
                    until = d
                }
                if let first = homeTime.startOfDay(s.startDate), let t = timeMinutes(s.startTime) {
                    start = first.addingTimeInterval(t * 60)
                    end = start.addingTimeInterval(s.durationMin * 60)
                }
            }
        }
    }

    private var ownerIds: [String]? { owners.isEmpty ? nil : Array(owners) }
    private var cleanNotes: String? { notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : notes }
    private var cleanLocation: String? { location.trimmingCharacters(in: .whitespaces).isEmpty ? nil : location }

    /// An all-day event covers whole dates: end is the midnight after its last day.
    private var span: (start: Date, end: Date) {
        if allDay {
            let first = CalendarDates.date(CalendarDates.string(start)) ?? start
            let last = CalendarDates.date(CalendarDates.string(max(end, start))) ?? first
            return (first, last.addingTimeInterval(86_400))
        }
        return (start, max(end, start))
    }

    private func save() async {
        saving = true
        defer { saving = false }
        error = nil
        do {
            if repeats {
                try await saveSeries()
            } else {
                try await saveEvent()
            }
            await model.dataChanged()
            await store.reload()
            dismiss()
        } catch {
            self.error = HubError.from(error)?.message ?? "Couldn't save. Check your connection and try again."
        }
    }

    private func saveEvent() async throws {
        typealias Body = Operations.CreateEvent.Input.Body.JsonPayload
        let body = Body(
            title: title,
            category: .init(rawValue: category.rawValue)!,
            attendance: optional ? .optional : .required,
            ownerIds: ownerIds,
            start: span.start,
            end: span.end,
            allDay: allDay,
            notes: cleanNotes,
            locationName: cleanLocation
        )
        switch target {
        case .new:
            _ = try await model.client.api.createEvent(body: .json(body)).created
            model.show("Added.")
        case .existing(let e):
            let update = Operations.UpdateEvent.Input.Body.JsonPayload(
                title: body.title, category: .init(rawValue: category.rawValue)!, attendance: optional ? .optional : .required,
                ownerIds: body.ownerIds, start: body.start, end: body.end, allDay: body.allDay, notes: body.notes, locationName: body.locationName
            )
            _ = try await model.client.api.updateEvent(path: .init(id: e.id), body: .json(update)).noContent
            model.show("Saved.")
        }
    }

    private func saveSeries() async throws {
        let firstDay = allDay ? CalendarDates.string(start) : homeTime.localDate(start)
        let minutes = Int(max(1, span.end.timeIntervalSince(span.start) / 60))
        let lastDay = hasEnd ? homeTime.localDate(until) : nil
        let startTime = allDay ? "00:00" : hhmm(start)
        if let seriesId {
            let body = Operations.UpdateSeries.Input.Body.JsonPayload(
                title: title, category: .init(rawValue: category.rawValue)!, attendance: optional ? .optional : .required,
                ownerIds: ownerIds, notes: cleanNotes, locationName: cleanLocation, allDay: allDay, startDate: firstDay,
                untilDate: lastDay, startTime: startTime, durationMin: minutes, intervalWeeks: intervalWeeks,
                weekdays: weekdays.sorted(), timeZone: homeTime.timeZone.identifier
            )
            _ = try await model.client.api.updateSeries(path: .init(id: seriesId), body: .json(body)).noContent
            model.show("Series saved.")
        } else {
            let body = Operations.CreateSeries.Input.Body.JsonPayload(
                title: title, category: .init(rawValue: category.rawValue)!, attendance: optional ? .optional : .required,
                ownerIds: ownerIds, notes: cleanNotes, locationName: cleanLocation, allDay: allDay, startDate: firstDay,
                untilDate: lastDay, startTime: startTime, durationMin: minutes, intervalWeeks: intervalWeeks,
                weekdays: weekdays.sorted(), timeZone: homeTime.timeZone.identifier
            )
            _ = try await model.client.api.createSeries(body: .json(body)).created
            model.show("Repeating event added.")
        }
    }

    private func deleteSeries() async {
        guard let seriesId else { return }
        _ = try? await model.client.api.deleteSeries(path: .init(id: seriesId))
        model.show("Series deleted.")
        await model.dataChanged()
        await store.reload()
        dismiss()
    }

    private func hhmm(_ date: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = homeTime.timeZone
        let c = cal.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    private func timeMinutes(_ hhmm: String) -> Double? {
        let p = hhmm.split(separator: ":").compactMap { Double($0) }
        return p.count == 2 ? p[0] * 60 + p[1] : nil
    }
}

/// Weekday chips, Monday first; the API numbers Sunday 0.
struct WeekdayPicker: View {
    @Binding var selection: Set<Int>
    private let order = [1, 2, 3, 4, 5, 6, 0]

    var body: some View {
        HStack {
            ForEach(order, id: \.self) { day in
                let on = selection.contains(day)
                Button {
                    if on { selection.remove(day) } else { selection.insert(day) }
                } label: {
                    Text(Calendar.current.veryShortWeekdaySymbols[day])
                        .font(.subheadline.weight(.medium))
                        .frame(width: 34, height: 34)
                        .background(on ? Color.accentColor : Color.secondary.opacity(0.15), in: Circle())
                        .foregroundStyle(on ? .white : .primary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Calendar.current.weekdaySymbols[day])
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .frame(maxWidth: .infinity)
    }
}
